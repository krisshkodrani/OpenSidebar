import { describe, expect, test, vi } from "vitest";

import type { DelegatedBrowserTask } from "@shared-types/browser-bridge";
import { DelegatedTaskFeedback } from "../../src/background/browser-bridge/delegated-task-feedback";

function task(
  status: DelegatedBrowserTask["status"],
  currentTabId = 42,
): DelegatedBrowserTask {
  return {
    taskId: "task-1",
    status,
    goal: "Fill the safe form fields",
    createdAt: 1,
    updatedAt: 2,
    currentPlan: ["Fill fields", "Verify fields"],
    completedSteps: [],
    currentTabId,
    providerUsage: { models: [], estimatedCostUsd: 0 },
    evidence: [],
    traceId: "trace-1",
  };
}

describe("DelegatedTaskFeedback", () => {
  test("turns the page glow on for a pinned task and off on completion", () => {
    const send = vi.fn();
    const feedback = new DelegatedTaskFeedback(send);

    feedback.update(task("queued"));
    feedback.update(task("running"));
    feedback.update(task("completed"));

    expect(send.mock.calls).toEqual([
      [42, { active: true, pageActivity: true }],
      [
        42,
        {
          active: false,
          pageActivity: false,
          outcome: {
            status: "completed",
            label: "Delegated task completed",
          },
        },
      ],
    ]);
  });

  test("moves the glow when a task changes tabs", () => {
    const send = vi.fn();
    const feedback = new DelegatedTaskFeedback(send);

    feedback.update(task("running", 42));
    feedback.update(task("running", 84));

    expect(send.mock.calls.slice(1)).toEqual([
      [42, { active: false, pageActivity: false }],
      [84, { active: true, pageActivity: true }],
    ]);
  });

  test("clears stale glow state for a restored terminal task", () => {
    const send = vi.fn();
    const feedback = new DelegatedTaskFeedback(send);

    feedback.update(task("failed"));

    expect(send).toHaveBeenCalledWith(42, {
      active: false,
      pageActivity: false,
      outcome: {
        status: "failed",
        label: "Delegated task failed",
      },
    });
  });
});
