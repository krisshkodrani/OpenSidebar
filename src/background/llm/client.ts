import { ToolCall } from "../../types";
import { logger } from "../../utils";
import { parseSSEStream } from "../streaming";
import { CompletionRequest, CompletionResponse, LLMToolCall } from "./types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Delay that can be cancelled via an AbortSignal. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((r) => setTimeout(r, ms));
  if (signal.aborted)
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Fast model tier — used for initial turns */
export const MODEL_FAST = "openai/gpt-4o-mini";
/** Smart model tier — used after escalation when stuck */
export const MODEL_SMART = "minimax/minimax-m2.5";

/** Strip <think>...</think> reasoning blocks from model output */
export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Returns how many trailing chars of `text` match a prefix of `tag`.
 * Used to avoid emitting/discarding a partial tag boundary during streaming.
 */
function partialTagLen(text: string, tag: string): number {
  const max = Math.min(tag.length - 1, text.length);
  for (let i = max; i >= 1; i--) {
    if (text.endsWith(tag.slice(0, i))) return i;
  }
  return 0;
}

/** Streaming filter that suppresses <think>...</think> blocks across chunk boundaries. */
function createThinkFilter(emit: (text: string) => void) {
  let buf = "";
  let inside = false;
  return {
    push(delta: string) {
      buf += delta;
      while (buf) {
        if (inside) {
          const idx = buf.indexOf("</think>");
          if (idx === -1) {
            const keep = partialTagLen(buf, "</think>");
            buf = keep > 0 ? buf.slice(-keep) : "";
            return;
          }
          buf = buf.slice(idx + "</think>".length);
          inside = false;
        } else {
          const idx = buf.indexOf("<think>");
          if (idx === -1) {
            const keep = partialTagLen(buf, "<think>");
            const safe = buf.length - keep;
            if (safe > 0) emit(buf.slice(0, safe));
            buf = keep > 0 ? buf.slice(-keep) : "";
            return;
          }
          if (idx > 0) emit(buf.slice(0, idx));
          buf = buf.slice(idx + "<think>".length);
          inside = true;
        }
      }
    },
    flush() {
      if (!inside && buf) {
        emit(buf);
        buf = "";
      }
    },
  };
}

/**
 * LLM Client for OpenSidebar
 * Handles communication with OpenRouter API, including streaming and retry logic
 */

export class LLMClient {
  private apiKey: string;
  private model: string;

  /**
   * Creates a new LLM client
   * @param apiKey - OpenRouter API key
   * @param model - Model ID to use (defaults to MODEL_FAST)
   */
  constructor(apiKey: string, model: string = MODEL_FAST) {
    this.apiKey = apiKey;
    this.model = model;
  }

  /** Get the currently active model ID */
  public getCurrentModel(): string {
    return this.model;
  }

  /** Switch the active model (e.g. for escalation). Mutates in place. */
  public switchModel(model: string): void {
    logger.info("agent", "Switching LLM model", {
      from: this.model,
      to: model,
    });
    this.model = model;
  }

  private get baseUrl() {
    return OPENROUTER_BASE_URL;
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries = 3,
    signal?: AbortSignal,
  ): Promise<Response> {
    const RETRYABLE = new Set([429, 502, 503, 504]);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const response = await fetch(url, { ...init, signal });
        if (response.ok || !RETRYABLE.has(response.status)) return response;
        // Retryable error
        const body = await response.text();
        lastError = new Error(`LLM API Error (${response.status}): ${body}`);
      } catch (e: any) {
        if (e.name === "AbortError") throw e; // Never retry aborts
        lastError = e; // Network error — retryable
      }
      if (attempt < maxRetries) {
        const delay =
          1000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 300);
        logger.warn(
          "agent",
          `LLM request failed, retrying ${attempt}/${maxRetries}`,
          { delay, error: lastError?.message },
        );
        await abortableDelay(delay, signal);
      }
    }
    throw lastError!;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (!this.apiKey) {
      throw new Error(
        "LLM API Key is missing. Please configure it in settings.",
      );
    }

    const payload = {
      model: request.model || this.model,
      messages: request.messages,
      tools: request.tools,
      tool_choice: request.tools?.length ? ("auto" as const) : undefined,
      temperature: request.temperature ?? 0.0, // Agentic needs low temp
      max_tokens: request.max_tokens,
      stop: request.stop,
    };

    logger.debug("agent", "LLM Request", {
      model: payload.model,
      msgCount: payload.messages.length,
      tools: payload.tools?.length,
    });

    try {
      const response = await this.fetchWithRetry(
        this.baseUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "HTTP-Referer": "https://github.com/OpenSidebar/OpenSidebar",
            "X-Title": "OpenSidebar",
          },
          body: JSON.stringify(payload),
        },
        3,
        request.signal,
      );

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 402) {
          const affordMatch = errorText.match(/can only afford (\d+)/);
          const affordable = affordMatch ? parseInt(affordMatch[1]) : 0;
          const err = new Error(
            affordable > 0
              ? `Insufficient credits (can afford ~${affordable} tokens). Add credits at openrouter.ai/credits.`
              : `Insufficient OpenRouter credits. Add credits at openrouter.ai/credits.`,
          );
          (err as any).status = 402;
          (err as any).affordable = affordable;
          throw err;
        }
        throw new Error(`LLM API Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const choice = data.choices[0];

      // Parse tool calls from provider format to internal ToolCall format
      const rawToolCalls = choice.message.tool_calls as
        | LLMToolCall[]
        | undefined;
      let parsedToolCalls: ToolCall[] = [];

      if (rawToolCalls) {
        parsedToolCalls = rawToolCalls.map((tc) => {
          // Return exactly what matches parameters of ToolCall interface
          // We validate that the name is a valid ToolName? Or just cast it.
          return {
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name as any, // Cast to ToolName
              arguments: tc.function.arguments,
            },
          };
        });
      }

      logger.debug("agent", "LLM Response", {
        finishReason: choice.finish_reason,
        contentLen: choice.message.content?.length,
        toolCalls: parsedToolCalls.length,
      });

      // Strip reasoning tokens (<think>...</think>) that some models emit inline
      const rawContent = choice.message.content;
      const cleanContent = rawContent
        ? stripThinkTags(rawContent) || null
        : null;

      return {
        role: "assistant",
        content: cleanContent,
        tool_calls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
        finish_reason: choice.finish_reason as any,
        usage: data.usage,
      };
    } catch (error: any) {
      logger.error("agent", "LLM Request Failed", { error: error.message });
      throw error;
    }
  }

  /**
   * Executes a streaming LLM completion request.
   * Handles SSE parsing, think tag filtering, and automatic retries.
   *
   * @param request - Completion request with messages, tools, and options
   * @param onTextDelta - Callback for each text chunk received
   * @returns Complete response with parsed tool calls and usage data
   */
  async completeStream(
    request: CompletionRequest,
    onTextDelta: (delta: string) => void,
  ): Promise<CompletionResponse> {
    if (!this.apiKey) {
      throw new Error(
        "LLM API Key is missing. Please configure it in settings.",
      );
    }

    const payload = {
      model: request.model || this.model,
      messages: request.messages,
      tools: request.tools,
      tool_choice: request.tools?.length ? ("auto" as const) : undefined,
      temperature: request.temperature ?? 0.0,
      max_tokens: request.max_tokens,
      stop: request.stop,
      stream: true,
    };

    logger.debug("agent", "LLM Stream Request", {
      model: payload.model,
      msgCount: payload.messages.length,
      tools: payload.tools?.length,
    });

    try {
      const response = await this.fetchWithRetry(
        this.baseUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "HTTP-Referer": "https://github.com/OpenSidebar/OpenSidebar",
            "X-Title": "OpenSidebar",
          },
          body: JSON.stringify(payload),
        },
        3,
        request.signal,
      );

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 402) {
          const affordMatch = errorText.match(/can only afford (\d+)/);
          const affordable = affordMatch ? parseInt(affordMatch[1]) : 0;
          const err = new Error(
            affordable > 0
              ? `Insufficient credits (can afford ~${affordable} tokens). Add credits at openrouter.ai/credits.`
              : `Insufficient OpenRouter credits. Add credits at openrouter.ai/credits.`,
          );
          (err as any).status = 402;
          (err as any).affordable = affordable;
          throw err;
        }
        throw new Error(`LLM API Error (${response.status}): ${errorText}`);
      }

      if (!response.body) {
        throw new Error("LLM response body is null — streaming not supported?");
      }

      // Wrap callback to suppress <think>...</think> reasoning blocks during streaming
      const thinkFilter = createThinkFilter(onTextDelta);
      const result = await parseSSEStream(
        response.body,
        thinkFilter.push,
        request.signal,
      );
      thinkFilter.flush();

      // Preserve raw content (with <think> blocks) for conversation history —
      // M2.5 reasoning chain continuity improves performance significantly.
      // The streaming thinkFilter already suppressed <think> from the UI deltas.

      logger.debug("agent", "LLM Stream Response", {
        contentLen: result.content?.length,
        toolCalls: result.tool_calls?.length ?? 0,
      });

      return {
        role: "assistant",
        content: result.content || null,
        tool_calls: result.tool_calls,
        finish_reason: result.tool_calls ? "tool_calls" : "stop",
        usage: result.usage,
      };
    } catch (error: any) {
      logger.error("agent", "LLM Stream Request Failed", {
        error: error.message,
      });
      throw error;
    }
  }
}
