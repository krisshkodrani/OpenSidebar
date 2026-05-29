import { describe, expect, test } from "vitest";
import "../setup";
import { successfulTaskCompletionMessage } from "../../src/background/agent/agent-broadcast";
import { annotateCompletedPlanSubtasksForAcceptedDone } from "../../src/background/agent/agent-plan-progress";
import type { SubtaskSummary } from "../../src/types";

function subtask(
  status: SubtaskSummary["status"],
  result?: string,
): SubtaskSummary {
  return {
    description: `${status} subtask`,
    status,
    turnsUsed: 1,
    turnBudget: 3,
    ...(result ? { result } : {}),
  };
}

describe("completion status integrity", () => {
  test("accepted done only annotates result text for completed subtasks", () => {
    const subtasks = [
      subtask("completed"),
      subtask("running"),
      subtask("pending"),
    ];

    annotateCompletedPlanSubtasksForAcceptedDone({
      subtasks,
      summary: "Finished the completed work.",
    });

    expect(subtasks[0].result).toBe("Completed");
    expect(subtasks[1].result).toBeUndefined();
    expect(subtasks[2].result).toBeUndefined();
  });

  test("accepted done does not overwrite a pending final subtask with summary", () => {
    const subtasks = [
      subtask("completed", "First step done"),
      subtask("pending"),
    ];

    annotateCompletedPlanSubtasksForAcceptedDone({
      subtasks,
      summary: "Final task summary",
    });

    expect(subtasks[0].result).toBe("First step done");
    expect(subtasks[1].result).toBeUndefined();
  });

  test("successful task completion reports stale running and pending subtasks as stopped", () => {
    const message = successfulTaskCompletionMessage({
      taskId: "task-1",
      subtasks: [
        subtask("completed", "Done"),
        subtask("running"),
        subtask("pending"),
        subtask("skipped", "User skipped"),
        subtask("failed", "Failed"),
      ],
      turnCount: 5,
      totalTimeMs: 1234,
      summary: "Accepted done",
      urlHistory: ["https://example.test"],
    });

    expect(message?.payload.status).toBe("completed");
    expect(message?.payload.subtaskResults.map((r) => r.status)).toEqual([
      "completed",
      "stopped",
      "stopped",
      "skipped",
      "failed",
    ]);
    expect(message?.payload.subtaskResults[1].result).toBe("");
    expect(message?.payload.subtaskResults[2].result).toBe("");
  });
});
