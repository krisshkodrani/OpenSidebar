import { describe, expect, it } from "vitest";
import { partialHandoffTerminationReason } from "../../src/background/orchestrator/partial-handoff-reason";

describe("partial handoff termination reason", () => {
  it.each([
    ["max_turns", "Turn limit reached"],
    ["timeout", "Time limit reached"],
    ["tool_error", "Tool execution failed"],
    ["provider_error", "Model provider failed"],
    ["manual_stop", "Stopped by user"],
    ["escalation_failed", "Escalation failed"],
  ] as const)("preserves %s attribution", (reason, label) => {
    expect(partialHandoffTerminationReason({ reason, turnsUsed: 7, maxTurns: 28 }))
      .toBe(`${label} (7/28)`);
  });
});
