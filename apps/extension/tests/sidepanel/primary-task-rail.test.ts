import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";
import "../setup";
import { AgentStatus } from "../../src/types";
import {
  PrimaryTaskRail,
  resolvePrimaryTaskLabel,
} from "../../src/sidepanel/components/PrimaryTaskRail";
import { useStore } from "../../src/sidepanel/store";

describe("PrimaryTaskRail label precedence", () => {
  test("prefers interruption states over the latest step label", () => {
    expect(
      resolvePrimaryTaskLabel({
        latestStepLabel: "Clicking Continue",
        isStalled: true,
        stagnantTurns: 7,
        hasPendingApproval: false,
        hasPendingEscalation: false,
        hasPendingClarification: false,
        isAgentRunning: true,
        taskCompletion: null,
        agentStatus: AgentStatus.ACTING,
        statusDetail: "Taking action on the page",
      }),
    ).toBe("The agent may be stuck after 7 turns");

    expect(
      resolvePrimaryTaskLabel({
        latestStepLabel: "Clicking Continue",
        isStalled: false,
        stagnantTurns: undefined,
        hasPendingApproval: true,
        hasPendingEscalation: false,
        hasPendingClarification: false,
        isAgentRunning: true,
        taskCompletion: null,
        agentStatus: AgentStatus.ACTING,
        statusDetail: "Taking action on the page",
      }),
    ).toBe("Approval required before continuing");

    expect(
      resolvePrimaryTaskLabel({
        latestStepLabel: "Clicking Continue",
        isStalled: false,
        stagnantTurns: undefined,
        hasPendingApproval: false,
        hasPendingEscalation: false,
        hasPendingClarification: true,
        isAgentRunning: true,
        taskCompletion: null,
        agentStatus: AgentStatus.ACTING,
        statusDetail: "Taking action on the page",
      }),
    ).toBe("The agent needs more information");
  });

  test("falls back to the latest step label when there is no interruption", () => {
    expect(
      resolvePrimaryTaskLabel({
        latestStepLabel: "Typing shipping address",
        isStalled: false,
        stagnantTurns: undefined,
        hasPendingApproval: false,
        hasPendingEscalation: false,
        hasPendingClarification: false,
        isAgentRunning: true,
        taskCompletion: null,
        agentStatus: AgentStatus.ACTING,
        statusDetail: "Taking action on the page",
      }),
    ).toBe("Typing shipping address");
  });

  test("does not use generic thinking text as the primary label", () => {
    expect(
      resolvePrimaryTaskLabel({
        latestStepLabel: "Executor: Thinking...",
        isStalled: false,
        stagnantTurns: undefined,
        hasPendingApproval: false,
        hasPendingEscalation: false,
        hasPendingClarification: false,
        isAgentRunning: true,
        taskCompletion: null,
        agentStatus: AgentStatus.THINKING,
        statusDetail: "Thinking...",
      }),
    ).toBe("Planning next step");
  });

  test("shows completion status when the run is over", () => {
    expect(
      resolvePrimaryTaskLabel({
        latestStepLabel: null,
        isStalled: false,
        stagnantTurns: undefined,
        hasPendingApproval: false,
        hasPendingEscalation: false,
        hasPendingClarification: false,
        isAgentRunning: false,
        taskCompletion: { status: "partial" },
        agentStatus: AgentStatus.IDLE,
        statusDetail: "Ready",
      }),
    ).toBe("Task partially completed");

    expect(
      resolvePrimaryTaskLabel({
        latestStepLabel: null,
        isStalled: false,
        stagnantTurns: undefined,
        hasPendingApproval: false,
        hasPendingEscalation: false,
        hasPendingClarification: false,
        isAgentRunning: false,
        taskCompletion: { status: "stopped" },
        agentStatus: AgentStatus.IDLE,
        statusDetail: "Ready",
      }),
    ).toBe("Task stopped");
  });

  test("labels the running stop control as take control", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    useStore.setState({
      agentStatus: AgentStatus.ACTING,
      statusDetail: "Taking action on the page",
      isAgentRunning: true,
      latestStepLabel: "Clicking Continue",
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
      settings: {
        ...useStore.getState().settings,
        showSessionMetrics: false,
      },
    });

    try {
      await act(async () => {
        root.render(React.createElement(PrimaryTaskRail));
      });

      const button = container.querySelector(
        'button[aria-label="Stop agent and take control"]',
      );
      expect(button?.getAttribute("title")).toBe("Take control");
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("keeps long primary labels truncated inside the compact rail", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const longLabel = Array.from({ length: 40 }, (_, index) => `part-${index}`)
      .join(" ");
    const expectedLabel = resolvePrimaryTaskLabel({
      latestStepLabel: longLabel,
      isStalled: false,
      stagnantTurns: undefined,
      hasPendingApproval: false,
      hasPendingEscalation: false,
      hasPendingClarification: false,
      isAgentRunning: true,
      taskCompletion: null,
      agentStatus: AgentStatus.THINKING,
      statusDetail: "Thinking...",
    });
    useStore.setState({
      agentStatus: AgentStatus.THINKING,
      statusDetail: "Thinking...",
      isAgentRunning: true,
      latestStepLabel: longLabel,
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
      settings: {
        ...useStore.getState().settings,
        showSessionMetrics: false,
      },
    });

    try {
      await act(async () => {
        root.render(React.createElement(PrimaryTaskRail));
      });

      const rail = container.querySelector("section");
      const label = [...container.querySelectorAll("span")].find(
        (element) => element.textContent === expectedLabel,
      );
      expect(expectedLabel).toMatch(/\.\.\.$/);
      expect(rail?.className).toContain("rounded-lg");
      expect(label?.className).toContain("truncate");
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("does not repeat the primary task label as secondary text", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    useStore.setState({
      agentStatus: AgentStatus.ACTING,
      statusDetail: "Reviewing invoice",
      isAgentRunning: true,
      latestStepLabel: "Reviewing invoice",
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
      settings: {
        ...useStore.getState().settings,
        showSessionMetrics: false,
      },
    });

    try {
      await act(async () => {
        root.render(React.createElement(PrimaryTaskRail));
      });

      const labels = [...container.querySelectorAll("span")].filter(
        (element) => element.textContent === "Reviewing invoice",
      );
      expect(labels).toHaveLength(1);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
