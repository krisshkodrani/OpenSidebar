import { describe, expect, test } from "vitest";
import { planTerminationMessage } from "../../src/background/agent/agent-broadcast";
import type { PartialProgressHandoff, SessionMetrics } from "../../src/types";

describe("plan termination reason", () => {
  test("an early failed escalation is not reported as a turn limit", () => {
    const message = planTerminationMessage({
      taskId: "task",
      subtasks: [{ description: "Choose a target", status: "pending", turnsUsed: 7, result: "" }],
      outcome: "max_turns",
      summary: "Escalation did not recover",
      turnCount: 7,
      maxTurns: 28,
      totalTimeMs: 1000,
      urlHistory: [],
      metrics: {} as SessionMetrics,
      partialHandoff: { reason: "escalation_failed", completed: [], evidence: [] } as unknown as PartialProgressHandoff,
    });
    expect(message?.type).toBe("TASK_COMPLETION");
    if (message?.type !== "TASK_COMPLETION") return;
    expect(message.payload.terminationReason).toBe("Escalation failed (7/28)");
  });
});
