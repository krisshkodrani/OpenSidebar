import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import "../setup";
import { AgentStatus } from "../../src/types";
import { TaskActivityHud } from "../../src/sidepanel/components/TaskActivityHud";
import { useStore } from "../../src/sidepanel/store";

async function renderHud(container: HTMLElement) {
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(TaskActivityHud));
  });
  return root;
}

describe("TaskActivityHud", () => {
  test("renders current action while active", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    useStore.setState({
      agentStatus: AgentStatus.ACTING,
      statusDetail: "Taking action on the page",
      isAgentRunning: true,
      latestStepLabel: "Clicking checkout",
      taskProgress: null,
      taskCompletion: null,
      pendingApproval: null,
      pendingEscalation: null,
      pendingClarification: null,
      pendingPlanConfirmation: null,
      durableRunStatus: null,
      stagnationState: null,
      turnProgress: { turn: 2, maxTurns: 8, provider: "fireworks" },
      sessionMetrics: null,
    });

    const root = await renderHud(container);
    try {
      expect(container.textContent).toContain("Clicking checkout");
      expect(container.textContent).toContain("2/8");
      expect(container.querySelector("[data-opensidebar-activity-hud]")).toBeTruthy();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  test("stays hidden for paused work", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    useStore.setState({
      agentStatus: AgentStatus.PAUSED,
      statusDetail: "Paused",
      isAgentRunning: true,
      latestStepLabel: "Clicking checkout",
      taskProgress: null,
      taskCompletion: null,
      pendingApproval: null,
      pendingEscalation: null,
      pendingClarification: null,
      pendingPlanConfirmation: null,
      durableRunStatus: null,
      stagnationState: null,
      turnProgress: null,
      sessionMetrics: null,
    });

    const root = await renderHud(container);
    try {
      expect(container.querySelector("[data-opensidebar-activity-hud]")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
