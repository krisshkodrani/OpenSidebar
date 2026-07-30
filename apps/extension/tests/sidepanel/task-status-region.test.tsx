import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import "../setup";
import { AgentStatus } from "../../src/types";
import { TaskStatusRegion } from "../../src/sidepanel/components/TaskStatusRegion";
import { useStore } from "../../src/sidepanel/store";

afterEach(() => {
  useStore.setState({ delegatedBrowserTask: null });
});

describe("TaskStatusRegion delegated feedback", () => {
  test("shows delegated progress while the normal task rail is idle", async () => {
    useStore.setState({
      agentStatus: AgentStatus.IDLE,
      statusDetail: "Ready",
      isAgentRunning: false,
      taskProgress: null,
      taskCompletion: null,
      pendingApproval: null,
      pendingEscalation: null,
      pendingClarification: null,
      pendingPlanConfirmation: null,
      durableRunStatus: null,
      stagnationState: null,
      delegatedBrowserTask: {
        taskId: "task-1",
        status: "running",
        goal: "Fill Roomora metadata",
        createdAt: 1,
        updatedAt: 2,
        currentPlan: ["Fill safe fields", "Verify values"],
        completedSteps: [],
        currentTabId: 42,
        providerUsage: { models: [], estimatedCostUsd: 0 },
        evidence: [],
        traceId: "trace-1",
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <TaskStatusRegion
            isPlanExpanded={false}
            onTogglePlan={() => {}}
            onSkillRecordingHelp={() => {}}
          />,
        );
      });

      expect(container.textContent).toContain("Delegated browser task");
      expect(container.textContent).toContain("Fill Roomora metadata");
      expect(container.textContent).toContain("Fill safe fields");
      expect(container.textContent).toContain("running · 0/2 steps");
      expect(
        container.querySelector(
          'button[aria-label="Stop delegated browser task"]',
        ),
      ).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
