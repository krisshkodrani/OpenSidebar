import type { PartialProgressHandoff } from "../../types";

const LABELS = {
  max_turns: "Turn limit reached",
  timeout: "Time limit reached",
  tool_error: "Tool execution failed",
  provider_error: "Model provider failed",
  manual_stop: "Stopped by user",
  escalation_failed: "Escalation failed",
} satisfies Record<PartialProgressHandoff["reason"], string>;

export function partialHandoffTerminationReason(
  handoff: Pick<PartialProgressHandoff, "reason" | "turnsUsed" | "maxTurns">,
): string {
  return `${LABELS[handoff.reason]} (${handoff.turnsUsed}/${handoff.maxTurns})`;
}
