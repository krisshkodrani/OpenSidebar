import { describe, expect, test } from "vitest";
import {
  buildTaskCompletedEventPayload,
  classifyTaskOutcome,
  deriveCompletionStatus,
} from "../../src/background/orchestrator/task-outcome-policy";

describe("deriveCompletionStatus", () => {
  test("mirrors the orchestrator rollup rules", () => {
    expect(
      deriveCompletionStatus({
        completed: 3,
        failed: 0,
        penalizedSkipped: 0,
        hasUsefulHandoff: false,
      }),
    ).toBe("completed");
    expect(
      deriveCompletionStatus({
        completed: 3,
        failed: 0,
        penalizedSkipped: 0,
        hasUsefulHandoff: true,
      }),
    ).toBe("partial");
    expect(
      deriveCompletionStatus({
        completed: 1,
        failed: 2,
        penalizedSkipped: 0,
        hasUsefulHandoff: false,
      }),
    ).toBe("partial");
    expect(
      deriveCompletionStatus({
        completed: 0,
        failed: 2,
        penalizedSkipped: 0,
        hasUsefulHandoff: false,
      }),
    ).toBe("failed");
    expect(
      deriveCompletionStatus({
        completed: 2,
        failed: 0,
        penalizedSkipped: 1,
        hasUsefulHandoff: false,
      }),
    ).toBe("partial");
  });
});

describe("classifyTaskOutcome", () => {
  test("completed is success regardless of reason text", () => {
    expect(
      classifyTaskOutcome({
        completionStatus: "completed",
        terminationReason: null,
      }),
    ).toEqual({ success: true, classification: "completed" });
  });

  test("maps the orchestrator's own termination phrasings", () => {
    const cases: Array<[string, string]> = [
      ["Stopped by user during execution", "stopped_by_user"],
      ["Turn limit reached (30/30)", "max_turns"],
      ["Verification rejected the final state", "verification_failed"],
      ["Task budget exhausted before completion", "budget_exhausted"],
      ["Task contract incomplete: missing entities: price", "partial_contract"],
    ];
    for (const [reason, classification] of cases) {
      expect(
        classifyTaskOutcome({
          completionStatus: "failed",
          terminationReason: reason,
        }).classification,
      ).toBe(classification);
    }
  });

  test("unmatched reasons fall through to the honest buckets", () => {
    expect(
      classifyTaskOutcome({
        completionStatus: "partial",
        terminationReason: "something new",
      }).classification,
    ).toBe("partial_progress");
    expect(
      classifyTaskOutcome({
        completionStatus: "failed",
        terminationReason: null,
      }).classification,
    ).toBe("execution_error");
  });
});

describe("buildTaskCompletedEventPayload", () => {
  test("carries the classification alongside the raw counters", () => {
    const payload = buildTaskCompletedEventPayload({
      taskId: "task-1",
      completionStatus: "failed",
      completed: 0,
      failed: 2,
      skipped: 0,
      totalDurationMs: 1000,
      totalTokens: 500,
      totalCostUsd: 0.05,
      terminationReason: "Turn limit reached (30/30)",
    });
    expect(payload).toMatchObject({
      taskId: "task-1",
      completionStatus: "failed",
      success: false,
      classification: "max_turns",
      failed: 2,
      terminationReason: "Turn limit reached (30/30)",
    });
  });
});
