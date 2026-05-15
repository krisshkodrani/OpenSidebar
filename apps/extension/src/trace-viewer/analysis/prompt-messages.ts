import type {
  TraceEntry,
  TraceLLMMessage,
  TraceSession,
} from "../../types/traces";

export type PromptMessageRole =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | "unknown";

export interface PromptMessageView {
  id: string;
  sessionId: string;
  turnNumber: number;
  timestamp?: number;
  role: PromptMessageRole;
  source?: string;
  model?: string;
  content: string | null;
  toolCallId?: string;
  toolCalls?: { id: string; name: string; arguments: string }[];
}

export interface PromptExtractionResult {
  messages: PromptMessageView[];
  totalTurns: number;
  turnsWithMessages: number;
  unavailableTurnNumbers: number[];
  unavailableReason?:
    | "no_entries"
    | "no_prompt_events"
    | "redacted"
    | "unsupported_schema";
  diagnostics: string[];
}

function normalizeRole(role: TraceLLMMessage["role"] | string): PromptMessageRole {
  switch (role) {
    case "system":
    case "user":
    case "assistant":
    case "tool":
      return role;
    default:
      return "unknown";
  }
}

export function extractPromptMessages(
  session: TraceSession,
  entries: TraceEntry[],
): PromptExtractionResult {
  if (entries.length === 0) {
    return {
      messages: [],
      totalTurns: 0,
      turnsWithMessages: 0,
      unavailableTurnNumbers: [],
      unavailableReason: "no_entries",
      diagnostics: ["No trace entries were loaded for this session."],
    };
  }

  const messages: PromptMessageView[] = [];
  const unavailableTurnNumbers: number[] = [];

  for (const entry of entries) {
    const turnNumber = entry.turnNumber;
    const turnMessages = entry.llmRequest?.messages;
    if (!turnMessages || turnMessages.length === 0) {
      unavailableTurnNumbers.push(turnNumber);
      continue;
    }

    turnMessages.forEach((message, messageIndex) => {
      const role = normalizeRole(message.role);
      messages.push({
        id: `${entry.sessionId ?? session.sessionId}:${turnNumber}:${messageIndex}:${role}`,
        sessionId: entry.sessionId ?? session.sessionId,
        turnNumber,
        timestamp: entry.timestamp,
        role,
        source: entry.llmRequest?.modelTier ?? "request",
        model: entry.llmRequest?.model,
        content: message.content,
        toolCallId: message.tool_call_id,
        toolCalls: message.tool_calls?.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.function?.name ?? "unknown",
          arguments: toolCall.function?.arguments ?? "",
        })),
      });
    });
  }

  const turnsWithMessages = entries.length - unavailableTurnNumbers.length;
  return {
    messages,
    totalTurns: entries.length,
    turnsWithMessages,
    unavailableTurnNumbers,
    unavailableReason: messages.length === 0 ? "no_prompt_events" : undefined,
    diagnostics:
      unavailableTurnNumbers.length > 0
        ? [
            `${turnsWithMessages} of ${entries.length} turns include prompt messages.`,
          ]
        : [],
  };
}
