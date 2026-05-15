import { describe, expect, test } from "vitest";
import "../setup";
import {
  derivePlanStripViewModel,
  formatPlanElapsed,
} from "../../src/sidepanel/plan-strip-view-model";

describe("plan strip view model", () => {
  test("prioritizes confirmation over progress and planning", () => {
    const viewModel = derivePlanStripViewModel({
      isPlanning: true,
      pendingPlan: {
        confirmationId: "plan-1",
        nodes: [{ description: "Review", successCriteria: "Accepted" }],
        query: "Review page",
        requestedAt: 1,
      },
      taskProgress: {
        taskId: "task-1",
        currentIndex: 0,
        totalTurnsUsed: 0,
        subtasks: [],
      },
    });

    expect(viewModel.mode).toBe("confirmation");
    expect(viewModel.rows).toEqual([]);
    expect(viewModel.canSkip).toBe(false);
  });

  test("derives progress rows and skip availability", () => {
    const viewModel = derivePlanStripViewModel({
      isPlanning: false,
      pendingPlan: null,
      taskProgress: {
        taskId: "task-1",
        currentIndex: 1,
        totalTurnsUsed: 3,
        subtasks: [
          {
            description: "First",
            status: "completed",
            turnsUsed: 1,
            turnBudget: 10,
          },
          {
            description: "Second",
            status: "running",
            turnsUsed: 2,
            turnBudget: 10,
            workerStatus: "running",
          },
          {
            description: "Third",
            status: "pending",
            turnsUsed: 0,
            turnBudget: 10,
            workerStatus: "blocked",
          },
        ],
      },
    });

    expect(viewModel.mode).toBe("progress");
    expect(viewModel.currentIndex).toBe(1);
    expect(viewModel.rows).toHaveLength(3);
    expect(viewModel.canSkip).toBe(true);
    expect(viewModel.activeCount).toBe(1);
    expect(viewModel.blockedCount).toBe(1);
    expect(viewModel.queuedCount).toBe(0);
  });

  test("counts retrying workers by current lifecycle status", () => {
    const viewModel = derivePlanStripViewModel({
      isPlanning: false,
      pendingPlan: null,
      taskProgress: {
        taskId: "task-1",
        currentIndex: 0,
        totalTurnsUsed: 1,
        subtasks: [
          {
            description: "Retry active step",
            status: "running",
            turnsUsed: 1,
            turnBudget: 10,
            workerStatus: "retrying",
          },
          {
            description: "Retry queued step",
            status: "pending",
            turnsUsed: 0,
            turnBudget: 10,
            workerStatus: "retrying",
          },
        ],
      },
    });

    expect(viewModel.activeCount).toBe(1);
    expect(viewModel.queuedCount).toBe(1);
  });

  test("formats elapsed time compactly", () => {
    expect(formatPlanElapsed(59)).toBe("59s");
    expect(formatPlanElapsed(61)).toBe("1m1s");
  });
});
