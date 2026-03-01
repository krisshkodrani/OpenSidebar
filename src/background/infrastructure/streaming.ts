import { ToolCall, ToolName } from "../../types";
import { logger } from "../../utils";
import { TokenUsage } from "../llm/types";

interface PartialToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Parses an OpenAI-compatible SSE stream, invoking onTextDelta for each
 * content token and accumulating tool calls across chunks.
 *
 * Returns the final assembled content, tool_calls array, and usage (from the final chunk).
 */
export async function parseSSEStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<{
  content: string | null;
  tool_calls?: ToolCall[];
  usage?: TokenUsage;
}> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();

  let buffer = "";
  let content = "";
  let usage: TokenUsage | undefined;
  const partialToolCalls = new Map<number, PartialToolCall>();

  try {
    let readerDone = false;
    while (!readerDone) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) {
        readerDone = true;
        break;
      }

      buffer += value;

      // Split on newlines, keeping incomplete last line in buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(trimmed.slice(6));
        } catch {
          logger.debug("streaming", "Skipping malformed SSE JSON");
          continue;
        }

        // Capture usage from the final chunk (appears at top level, not in delta)
        if (parsed.usage) {
          usage = {
            prompt_tokens: parsed.usage.prompt_tokens ?? 0,
            completion_tokens: parsed.usage.completion_tokens ?? 0,
            total_tokens: parsed.usage.total_tokens ?? 0,
            cost: parsed.usage.cost,
            cached_tokens:
              parsed.usage.prompt_tokens_details?.cached_tokens ?? undefined,
          };
        }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        // Text content
        if (delta.content) {
          content += delta.content;
          onTextDelta(delta.content);
        }

        // Tool calls (streamed incrementally by index)
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx: number = tc.index;
            let partial = partialToolCalls.get(idx);

            if (!partial) {
              partial = { id: "", name: "", arguments: "" };
              partialToolCalls.set(idx, partial);
            }

            if (tc.id) partial.id = tc.id;
            if (tc.function?.name) partial.name = tc.function.name;
            if (tc.function?.arguments)
              partial.arguments += tc.function.arguments;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Build final tool_calls array
  let toolCalls: ToolCall[] | undefined;
  if (partialToolCalls.size > 0) {
    toolCalls = [];
    // Sort by index to preserve order
    const sorted = [...partialToolCalls.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, partial] of sorted) {
      let args = partial.arguments;
      // Validate assembled JSON arguments
      if (args && args.trim().length > 0) {
        try {
          JSON.parse(args);
        } catch {
          logger.warn(
            "streaming",
            "Invalid tool arguments after assembly, defaulting to {}",
            {
              toolName: partial.name,
              argsLen: args.length,
              argsTail: args.slice(-30),
            },
          );
          args = "{}";
        }
      } else {
        args = "{}";
      }
      toolCalls.push({
        id: partial.id,
        type: "function",
        function: {
          name: partial.name as ToolName,
          arguments: args,
        },
      });
    }
  }

  return {
    content: content || null,
    tool_calls: toolCalls,
    usage,
  };
}
