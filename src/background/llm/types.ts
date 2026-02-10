import { ToolCall, ToolDefinition } from "../../types";

export interface LLMMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
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
}

export interface CompletionResponse {
    role: "assistant";
    content: string | null;
    tool_calls?: ToolCall[];
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
