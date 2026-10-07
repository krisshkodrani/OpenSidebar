import { describe, expect, test } from "vitest";
import "../setup";
import { AgentStatus } from "../../src/types";
import {
  deriveTaskUiState,
  type TaskUiStateInput,
} from "../../src/sidepanel/task-ui-state";

function baseState(
  overrides: Partial<TaskUiStateInput> = {},
): TaskUiStateInput {
  return {
    agentStatus: AgentStatus.IDLE,
    statusDetail: "Ready",
    isAgentRunning: false,
    turnProgress: null,
    sessionMetrics: null,
    stagnationState: null,
    taskProgress: null,
    taskCompletion: null,
    pendingApproval: null,
    pendingEscalation: null,
    pendingPlanConfirmation: null,
    pendingClarification: null,
    durableRunStatus: null,
    latestStepLabel: null,
    isPlanning: false,
    ...overrides,
  };
}

describe("deriveTaskUiState", () => {
  test("keeps the completed outcome visible in the primary rail", () => {
    const state = deriveTaskUiState(
      baseState({
        taskCompletion: {
          taskId: "task-1",
          status: "completed",
          summary: "Done",
          totalTurnsUsed: 2,
          totalTimeMs: 1000,
          subtaskResults: [],
          urlHistory: [],
        },
      }),
    );

    expect(state.phase).toBe("completed");
    expect(state.hasTerminalCompletion).toBe(true);
    expect(state.showPrimaryRail).toBe(true);
    expect(state.showPlanStrip).toBe(false);
    expect(state.showPageActivityHud).toBe(false);
  });

  test("keeps user-stopped completions separate from failures", () => {
    const state = deriveTaskUiState(
      baseState({
        taskCompletion: {
          taskId: "task-1",
          status: "stopped",
          summary: "Stopped by user",
          totalTurnsUsed: 2,
          totalTimeMs: 1000,
          subtaskResults: [],
          urlHistory: [],
        },
      }),
    );

    expect(state.phase).toBe("stopped");
    expect(state.rail.primaryLabel).toBe("Task stopped");
    expect(state.rail.tone).toBe("stopped");
  });

  test("keeps pending user decisions above latest step labels", () => {
    const state = deriveTaskUiState(
      baseState({
        agentStatus: AgentStatus.ACTING,
        isAgentRunning: true,
        latestStepLabel: "Clicking submit",
        pendingClarification: {
          clarificationId: "clarify-1",
          question: "Which account?",
          requestedAt: 1,
          timeoutMs: 30000,
        },
      }),
    );

    expect(state.phase).toBe("awaiting_user");
    expect(state.showPrimaryRail).toBe(true);
    expect(state.showPageActivityHud).toBe(false);
    expect(state.rail.primaryLabel).toBe("The agent needs more information");
    expect(state.showAmbientActivity).toBe(false);
    expect(state.rail.showSpinner).toBe(false);
  });

  test("uses the current task instead of a generic thinking label", () => {
    const state = deriveTaskUiState(
      baseState({
        agentStatus: AgentStatus.THINKING,
        statusDetail: "Thinking...",
        isAgentRunning: true,
        latestStepLabel: "Thinking...",
        taskProgress: {
          taskId: "task-1",
          currentIndex: 0,
          totalTurnsUsed: 0,
          subtasks: [
            {
              description: "Write a proper summary with complete sentences.",
              status: "running",
              turnsUsed: 0,
              turnBudget: 4,
            },
          ],
        },
      }),
    );

    expect(state.rail.primaryLabel).toBe(
      "Write a proper summary with complete sentences.",
    );
    expect(state.rail.secondaryLabel).toBe("");
  });

  test("prefers the planner display label over the raw instruction in the rail", () => {
    const state = deriveTaskUiState(
      baseState({
        agentStatus: AgentStatus.ACTING,
        isAgentRunning: true,
        taskProgress: {
          taskId: "task-1",
          currentIndex: 0,
          totalTurnsUsed: 0,
          subtasks: [
            {
              description:
                "Complete these steps in order on the current page: Close any popup dialogs; Set the notification email field; Click the delete account button",
              label: "Dismiss popups · Set email · Delete account",
              status: "running",
              turnsUsed: 0,
              turnBudget: 4,
            },
          ],
        },
      }),
    );

    expect(state.rail.primaryLabel).toBe(
      "Dismiss popups · Set email · Delete account",
    );
  });

  test("compacts internal planner context in the primary rail label", () => {
    const state = deriveTaskUiState(
      baseState({
        agentStatus: AgentStatus.ACTING,
        isAgentRunning: true,
        taskProgress: {
          taskId: "task-1",
          currentIndex: 0,
          totalTurnsUsed: 0,
          subtasks: [
            {
              description: [
                "Objective: Complete the workflow for the original request:",
                "RECENT WORKSPACE CONVERSATION:",
                "- User: Summarize this page",
                "PROFILE DIGEST CONTEXT:",
                "- Fact: Full name = Jordan Rivera",
                "CURRENT REQUEST:",
                "Fill the profile",
                "Execution policy:",
                "- Call done only when complete.",
              ].join("\n"),
              status: "running",
              turnsUsed: 0,
              turnBudget: 4,
            },
          ],
        },
      }),
    );

    expect(state.rail.primaryLabel).toBe("Fill the profile");
    expect(state.rail.primaryLabel).not.toContain(
      "RECENT WORKSPACE CONVERSATION",
    );
    expect(state.rail.primaryLabel).not.toContain("PROFILE DIGEST CONTEXT");
  });

  test("does not surface generic thinking status text", () => {
    const state = deriveTaskUiState(
      baseState({
        agentStatus: AgentStatus.THINKING,
        statusDetail: "Thinking...",
        isAgentRunning: true,
        latestStepLabel: "Executor: Thinking...",
      }),
    );

    expect(state.rail.primaryLabel).toBe("Planning next step");
    expect(state.rail.secondaryLabel).toBe("");
  });

  test("shows the page HUD only for active non-interruption work", () => {
    expect(
      deriveTaskUiState(
        baseState({ agentStatus: AgentStatus.ACTING, isAgentRunning: true }),
      ).showPageActivityHud,
    ).toBe(true);
    expect(
      deriveTaskUiState(baseState({ isPlanning: true })).showPageActivityHud,
    ).toBe(true);
    expect(
      deriveTaskUiState(
        baseState({ agentStatus: AgentStatus.PAUSED, isAgentRunning: true }),
      ).showPageActivityHud,
    ).toBe(false);
    expect(
      deriveTaskUiState(baseState({ turnProgress: { turn: 3, maxTurns: 8 } }))
        .showPageActivityHud,
    ).toBe(false);
    expect(
      deriveTaskUiState(
        baseState({
          agentStatus: AgentStatus.ACTING,
          isAgentRunning: true,
          stagnationState: {
            signal: "escalate",
            stagnantTurns: 4,
            url: "https://example.com",
            receivedAt: 2,
          },
        }),
      ).showPageActivityHud,
    ).toBe(false);
    expect(
      deriveTaskUiState(
        baseState({
          agentStatus: AgentStatus.THINKING,
          isAgentRunning: true,
          pendingPlanConfirmation: {
            confirmationId: "plan-1",
            nodes: [{ description: "Step", successCriteria: "Done" }],
            query: "Do it",
            requestedAt: 1,
          },
        }),
      ).showPageActivityHud,
    ).toBe(false);
  });

  test("shows plan strip only for active planning states", () => {
    expect(
      deriveTaskUiState(baseState({ isPlanning: true })).showPlanStrip,
    ).toBe(true);
    expect(
      deriveTaskUiState(
        baseState({
          pendingPlanConfirmation: {
            confirmationId: "plan-1",
            nodes: [{ description: "Step", successCriteria: "Done" }],
            query: "Do it",
            requestedAt: 1,
          },
        }),
      ).showPlanStrip,
    ).toBe(true);
    expect(deriveTaskUiState(baseState()).showPlanStrip).toBe(false);
  });
});

describe("task connection and wait states", () => {
  test("reconnection overrides stale action, plan, and pending approval without pretending to work", () => {
    const input = baseState({
      isAgentRunning: true,
      agentStatus: AgentStatus.ACTING,
      backgroundConnection: "reconnecting",
      latestStepLabel: "Clicking Submit",
      actionPresentation: {
        sequence: 1,
        toolCallId: "call-1",
        phase: "acting",
        label: "Submitting",
        toolName: "click_element",
        receivedAt: 1,
      } as TaskUiStateInput["actionPresentation"],
      pendingClarification: {
        clarificationId: "q",
        question: "Which account?",
        requestedAt: 1,
        timeoutMs: 30000,
      },
    });
    const state = deriveTaskUiState(input);
    expect(state.phase).toBe("reconnecting");
    expect(state.rail.primaryLabel).toBe("Reconnecting to the agent");
    expect(state.rail.secondaryLabel).toContain("unconfirmed");
    expect(state.rail.showSpinner).toBe(false);
    expect(state.rail.canPause).toBe(false);
    expect(state.showAmbientActivity).toBe(false);
    expect(state.showPageActivityHud).toBe(false);
    expect(
      deriveTaskUiState({ ...input, backgroundConnection: "connected" }).phase,
    ).toBe("awaiting_user");
  });

  test("page waits and pauses override an old action label", () => {
    for (const [status, phase, label] of [
      [
        AgentStatus.WAITING_FOR_PAGE_LOAD,
        "waiting",
        "Waiting for the page to load",
      ],
      [AgentStatus.PAUSED, "paused", "Paused"],
    ] as const) {
      const state = deriveTaskUiState(
        baseState({
          isAgentRunning: true,
          agentStatus: status,
          latestStepLabel: "Clicking Submit",
        }),
      );
      expect(state.phase).toBe(phase);
      expect(state.rail.primaryLabel).toBe(label);
      expect(state.rail.showSpinner).toBe(false);
    }
  });

  test("verification is displayed only when a worker reports verification", () => {
    const input = baseState({
      isAgentRunning: true,
      agentStatus: AgentStatus.ACTING,
      taskProgress: {
        taskId: "t",
        currentIndex: 0,
        totalTurnsUsed: 2,
        subtasks: [
          {
            description: "Update address",
            status: "running",
            workerStatus: "verifying",
            turnsUsed: 2,
            turnBudget: 5,
          },
        ],
      },
    });
    expect(deriveTaskUiState(input).phase).toBe("verifying");
    input.taskProgress!.subtasks[0].workerStatus = "running";
    expect(deriveTaskUiState(input).phase).toBe("running");
  });
});
