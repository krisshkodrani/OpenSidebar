import { ToolCall, ToolName } from "../types";
import { logger } from "../utils";

interface PartialToolCall {
    id: string;
    name: string;
    arguments: string;
}

/**
 * Parses an OpenAI-compatible SSE stream, invoking onTextDelta for each
 * content token and accumulating tool calls across chunks.
 *
 * Returns the final assembled content and tool_calls array.
 */
export async function parseSSEStream(
    body: ReadableStream<Uint8Array>,
    onTextDelta: (delta: string) => void,
    signal?: AbortSignal,
): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();

    let buffer = "";
    let content = "";
    const partialToolCalls = new Map<number, PartialToolCall>();

    try {
    let readerDone = false;
    while (!readerDone) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const { done, value } = await reader.read();
        if (done) { readerDone = true; break; }

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
                    if (tc.function?.arguments) partial.arguments += tc.function.arguments;
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
            toolCalls.push({
                id: partial.id,
                type: "function",
                function: {
                    name: partial.name as ToolName,
                    arguments: partial.arguments,
                },
            });
        }
    }

    return {
        content: content || null,
        tool_calls: toolCalls,
    };
}
