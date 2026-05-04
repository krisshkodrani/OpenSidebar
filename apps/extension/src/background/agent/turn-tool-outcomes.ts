import { DomSnapshot, ToolCall, ToolName } from "../../types";
import { actionMemoryKey } from "./repeat-action-policy";

export interface TurnToolOutcomeRecord {
  toolCall: ToolCall;
  toolName: ToolName;
  args: Record<string, unknown>;
  argsKey: string;
  resultContent: string;
}

export function collectTurnToolOutcomeRecords(params: {
  toolCalls: ToolCall[];
  messages: Array<{
    role: string;
    tool_call_id?: string;
    content?: unknown;
  }>;
  snapshot: DomSnapshot | null | undefined;
}): TurnToolOutcomeRecord[] {
  return params.toolCalls.map((toolCall) => {
    const toolName = toolCall.function.name as ToolName;
    const rawArgsKey = toolCall.function.arguments.slice(0, 100);
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      args = {};
    }
    const toolResult = params.messages.find(
      (message) =>
        message.role === "tool" && message.tool_call_id === toolCall.id,
    );

    return {
      toolCall,
      toolName,
      args,
      argsKey: actionMemoryKey(toolName, args, rawArgsKey, params.snapshot),
      resultContent:
        typeof toolResult?.content === "string" ? toolResult.content : "",
    };
  });
}
