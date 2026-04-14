import { describe, expect, test } from "vitest";
import "../setup";
import { AgentStatus, ChatEntry, ToolName } from "../../src/types";
import {
  buildDecisionFeed,
  getLatestAssistantSteps,
  inferConsoleRole,
  subtaskHealth,
} from "../../src/sidepanel/orchestrator-view";

function assistantMessageWithSteps(steps: any[]): ChatEntry {
  return {
    id: "a1",
    role: "assistant",
    content: "ok",
    timestamp: Date.now(),
    toolCalls: [],
    isStreaming: false,
    steps,
  };
}

describe("orchestrator-view helpers", () => {
  test("inferConsoleRole prioritizes policy when approval is pending", () => {
    const role = inferConsoleRole({
      agentStatus: AgentStatus.ACTING,
      statusDetail: "Executing",
      pendingApproval: {
        approvalId: "ap-1",
        toolName: ToolName.NAVIGATE,
        args: { url: "https://example.com" },
        risk: "high" as any,
        context: "Navigate",
        timeoutMs: 30000,
        requestedAt: Date.now(),
      },
      pendingPlanConfirmation: null,
      messages: [],
    });
    expect(role).toBe("policy");
  });

  test("inferConsoleRole prioritizes policy when plan confirmation is pending", () => {
    const role = inferConsoleRole({
      agentStatus: AgentStatus.THINKING,
      statusDetail: "Planning",
      pendingApproval: null,
      pendingPlanConfirmation: {
        confirmationId: "pc-1",
        nodes: [{ description: "Step 1", successCriteria: "Done" }],
        query: "Do something complex",
        requestedAt: Date.now(),
      },
      messages: [],
    });
    expect(role).toBe("policy");
  });

  test("inferConsoleRole returns verifier when status detail indicates verification", () => {
    const role = inferConsoleRole({
      agentStatus: AgentStatus.THINKING,
      statusDetail: "Verifying completion...",
      pendingApproval: null,
      pendingPlanConfirmation: null,
      messages: [],
    });
    expect(role).toBe("verifier");
  });

  test("getLatestAssistantSteps uses latest assistant message", () => {
    const messages: ChatEntry[] = [
      {
        id: "u1",
        role: "user",
        content: "hello",
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: false,
      },
      assistantMessageWithSteps([
        {
          id: "s1",
          type: "info",
          label: "old",
          status: "done",
          timestamp: 1,
        },
      ]),
      assistantMessageWithSteps([
        {
          id: "s2",
          type: "info",
          label: "new",
          status: "done",
          timestamp: 2,
        },
      ]),
    ];
    const steps = getLatestAssistantSteps(messages);
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe("s2");
  });

  test("buildDecisionFeed filters to orchestration decision markers", () => {
    const feed = buildDecisionFeed([
      {
        id: "s1",
        type: "info",
        label: "Verifier decision: accept",
        status: "done",
        timestamp: 2,
      },
      {
        id: "s2",
        type: "tool",
        label: "Click [12]",
        status: "done",
        timestamp: 3,
      },
      {
        id: "s3",
        type: "info",
        label: "Retry policy decision",
        status: "running",
        timestamp: 4,
      },
    ]);
    expect(feed.map((d) => d.id)).toEqual(["s3", "s1"]);
  });

  test("subtaskHealth summarizes statuses", () => {
    const health = subtaskHealth([
      { description: "a", status: "completed", turnsUsed: 1, turnBudget: 3 },
      { description: "b", status: "running", turnsUsed: 1, turnBudget: 3 },
      { description: "c", status: "failed", turnsUsed: 2, turnBudget: 3 },
      { description: "d", status: "pending", turnsUsed: 0, turnBudget: 3 },
    ]);
    expect(health).toEqual({
      completed: 1,
      running: 1,
      blocked: 1,
      pending: 1,
    });
  });
});
