const TERMINAL_COMPLETION_STATES = new Set([
  "completed",
  "partial",
  "failed",
  "stopped",
]);

/** Fixture-observed success outranks model self-assessment after settlement. */
export function hasSettledSuccessfulOutcome(input: {
  hasSuccessfulResult: boolean;
  completionStatus?: unknown;
  agentStatus?: unknown;
}): boolean {
  if (!input.hasSuccessfulResult) return false;
  return (
    TERMINAL_COMPLETION_STATES.has(String(input.completionStatus ?? "")) ||
    input.agentStatus === "IDLE"
  );
}
