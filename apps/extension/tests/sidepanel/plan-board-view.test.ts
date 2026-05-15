import { describe, expect, test } from "vitest";
import "../setup";
import { buildRecoveryHint, derivePlanRows } from "../../src/sidepanel/plan-board-view";

describe("plan-board-view", () => {
  test("derivePlanRows maps task progress rows", () => {
    const rows = derivePlanRows(
      {
        taskId: "task-1",
        currentIndex: 0,
        totalTurnsUsed: 2,
        subtasks: [
          {
            nodeId: "node-1",
            description: "collect data",
            status: "running",
            turnsUsed: 2,
            turnBudget: 5,
            result: "navigated to source",
            workerStatus: "running",
            workerStatusDetail: "Using url:alpha (read)",
            parallelism: "independent",
            resourceSummary: "url:alpha (read)",
          },
        ],
      },
      null,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      description: "collect data",
      nodeId: "node-1",
      status: "running",
      turnsUsed: 2,
      turnBudget: 5,
      evidenceSnippet: "navigated to source",
      workerStatus: "running",
      workerStatusDetail: "Using url:alpha (read)",
      parallelism: "independent",
      resourceSummary: "url:alpha (read)",
    });
  });

  test("derivePlanRows maps completion rows when progress is absent", () => {
    const rows = derivePlanRows(null, {
      taskId: "task-2",
      status: "completed",
      totalTurnsUsed: 4,
      totalTimeMs: 1000,
      summary: "done",
      subtaskResults: [
        {
          description: "verify order",
          status: "completed",
          turnsUsed: 1,
          result: "order id visible",
        },
      ],
      urlHistory: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      description: "verify order",
      status: "completed",
      turnsUsed: 1,
      evidenceSnippet: "order id visible",
    });
  });

  test("derivePlanRows preserves skipped status from completion", () => {
    const rows = derivePlanRows(null, {
      taskId: "task-3",
      status: "partial",
      totalTurnsUsed: 2,
      totalTimeMs: 500,
      summary: "partial",
      subtaskResults: [
        {
          description: "optional branch",
          status: "skipped",
          turnsUsed: 0,
          result: "Skipped by user from Plan Board.",
        },
      ],
      urlHistory: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      description: "optional branch",
      status: "skipped",
      turnsUsed: 0,
      evidenceSnippet: "Skipped by user from Plan Board.",
    });
  });

  test("buildRecoveryHint includes task id and pending count", () => {
    const hint = buildRecoveryHint({
      workspaceId: "ws-1",
      taskId: "task-abc",
      totalSubtasks: 6,
      completedSubtasks: 3,
      pendingSubtasks: 3,
      recoveredAt: Date.now(),
    });
    expect(hint).toContain("task-abc");
    expect(hint).toContain("remaining 3 subtasks");
  });
});
