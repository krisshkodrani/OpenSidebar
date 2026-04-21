import { describe, expect, test } from "vitest";
import "../setup";
import { AgentStatus } from "../../src/types";
import { resolvePrimaryTaskLabel } from "../../src/sidepanel/components/PrimaryTaskRail";

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
  });
});
