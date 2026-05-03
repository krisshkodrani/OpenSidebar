import { AgentStep } from "../../types";
import { LLMMessage } from "../llm/types";

export const TURN_RETRY_DIAGNOSTIC_PREFIX =
  "[System] Your previous response contained raw JSON instead of a proper tool call.";

export function buildTurnRetryStep(args: {
  retryCount: number;
  maxRetries: number;
  fallbackModel?: string;
}): AgentStep {
  const label = args.fallbackModel
    ? `Retrying with fallback model (${args.retryCount}/${args.maxRetries})...`
    : `Retrying (${args.retryCount}/${args.maxRetries})...`;

  return {
    id: crypto.randomUUID(),
    type: "info",
    label,
    status: "running",
    timestamp: Date.now(),
  };
}

export function getTurnRetryBackoffMs(
  retryCount: number,
  backoffs: readonly number[],
  fallbackMs = 500,
): number {
  return backoffs[retryCount - 1] ?? fallbackMs;
}

export function buildHallucinationRetryMessage(): LLMMessage {
  return {
    role: "user",
    content:
      `${TURN_RETRY_DIAGNOSTIC_PREFIX} ` +
      "Use the tool_calls API to invoke tools. Do not emit JSON as text.",
  };
}

export function removeTurnRetryDiagnosticMessages(
  messages: LLMMessage[],
): LLMMessage[] {
  return messages.filter(
    (message) =>
      !(
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.startsWith(TURN_RETRY_DIAGNOSTIC_PREFIX)
      ),
  );
}
