import { ToolCall } from "../../types";
import { logger } from "../../utils";
import { parseSSEStream } from "../streaming";
import { CompletionRequest, CompletionResponse, LLMToolCall } from "./types";

const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1/chat/completions";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

// Default models
const MODEL_CEREBRAS = "gpt-oss-120b"; // OpenAI GPT OSS
const MODEL_OPENROUTER = "moonshotai/kimi-k2.5"; // MoonshotAI: Kimi K2.5

export class LLMClient {
  private apiKey: string;
  private provider: "cerebras" | "openrouter";
  private model: string;

  constructor(
    apiKey: string,
    provider: "cerebras" | "openrouter" = "cerebras",
    model?: string,
  ) {
    this.apiKey = apiKey;
    this.provider = provider;
    this.model =
      model || (provider === "cerebras" ? MODEL_CEREBRAS : MODEL_OPENROUTER);
  }

  private get baseUrl() {
    return this.provider === "cerebras"
      ? CEREBRAS_BASE_URL
      : OPENROUTER_BASE_URL;
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
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(this.provider === "openrouter"
            ? {
                "HTTP-Referer": "https://github.com/OpenSidebar/OpenSidebar",
                "X-Title": "OpenSidebar",
              }
            : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
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

      return {
        role: "assistant",
        content: choice.message.content,
        tool_calls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
        finish_reason: choice.finish_reason as any,
        usage: data.usage,
      };
    } catch (error: any) {
      logger.error("agent", "LLM Request Failed", { error: error.message });
      throw error;
    }
  }

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
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(this.provider === "openrouter"
            ? {
                "HTTP-Referer": "https://github.com/OpenSidebar/OpenSidebar",
                "X-Title": "OpenSidebar",
              }
            : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API Error (${response.status}): ${errorText}`);
      }

      if (!response.body) {
        throw new Error("LLM response body is null — streaming not supported?");
      }

      const result = await parseSSEStream(response.body, onTextDelta);

      logger.debug("agent", "LLM Stream Response", {
        contentLen: result.content?.length,
        toolCalls: result.tool_calls?.length ?? 0,
      });

      return {
        role: "assistant",
        content: result.content,
        tool_calls: result.tool_calls,
        finish_reason: result.tool_calls ? "tool_calls" : "stop",
        usage: undefined,
      };
    } catch (error: any) {
      logger.error("agent", "LLM Stream Request Failed", {
        error: error.message,
      });
      throw error;
    }
  }
}
