import { ToolCall, ToolDefinition } from "../../types";

/** Provider-specific configuration for LLM API calls */
export interface ProviderConfig {
  /** Base URL for the chat completions endpoint */
  baseUrl: string;
  /** API key for Authorization header */
  apiKey: string;
  /** Extra headers (e.g. OpenRouter's HTTP-Referer, X-Title) */
  headers: Record<string, string>;
  /** Provider identifier for logging and metrics */
  providerId: "openrouter";
}

export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "low" | "high" | "auto" };
    };

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | ContentPart[];
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
  name?: string; // for tool role
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface CompletionRequest {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  max_tokens?: number;
  model?: string;
  stop?: string[];
  signal?: AbortSignal;
  response_format?: { type: "json_object" };
}

/** Token usage data returned by OpenRouter in every response */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Cost in USD charged by OpenRouter (returned directly in response) */
  cost?: number;
  /** Number of prompt tokens served from cache (prefix caching) */
  cached_tokens?: number;
}

export interface CompletionResponse {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
  usage?: TokenUsage;
  /** Provider that actually served this request (may differ from requested after failover) */
  actualProviderId?: ProviderConfig["providerId"];
  /** Model that actually served this request (may differ from requested after failover) */
  actualModel?: string;
}
