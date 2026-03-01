import { describe, test, expect, vi, beforeEach } from "vitest";
import "../setup";
import { AgentStatus } from "../../src/types";

// Default completeStream implementation (text only, no tool calls)
const defaultCompleteStreamFn = (
  request: any,
  onTextDelta: (delta: string) => void,
) => {
  onTextDelta("Final answer");
  return Promise.resolve({
    role: "assistant",
    content: "Final answer",
    tool_calls: undefined,
    finish_reason: "stop",
  });
};

// Mock LLM Client — now mocking completeStream instead of complete
const { mockCompleteStream } = vi.hoisted(() => {
  const defaultFn = (
    request: any,
    onTextDelta: (delta: string) => void,
  ) => {
    onTextDelta("Final answer");
    return Promise.resolve({
      role: "assistant",
      content: "Final answer",
      tool_calls: undefined,
      finish_reason: "stop",
    });
  };
  return { mockCompleteStream: vi.fn(defaultFn) };
});

vi.mock("../../src/background/llm", () => ({
  LLMClient: class {
    private model = "google/gemini-2.5-flash-lite";
    complete = vi.fn(() =>
      Promise.resolve({
        role: "assistant",
        content: "Final answer",
        tool_calls: undefined,
        finish_reason: "stop",
      }),
    );
    completeStream = mockCompleteStream;
    _isPlannerTier = false;
    switchToPlanner = vi.fn(() => {
      this.model = "minimax/minimax-m2.5";
      this._isPlannerTier = true;
    });
    switchToExecutor = vi.fn(() => {
      this.model = "google/gemini-2.5-flash-lite";
      this._isPlannerTier = false;
    });
    isPlannerTier = () => this._isPlannerTier;
    getCurrentModel = () => this.model;
    getCurrentProvider = () => "openrouter";
    getActiveProviderInfo = () => ({
      providerId: "openrouter",
      model: this.model,
    });
    setFailoverCallback = vi.fn(() => {});
  },
  MODEL_EXECUTOR: "google/gemini-2.5-flash-lite",
  MODEL_PLANNER: "minimax/minimax-m2.5",
  stripThinkTags: (text: string) =>
    text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
  extractThinkContent: (text: string) => {
    const blocks: string[] = [];
    const re = /<think>([\s\S]*?)<\/think>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const inner = m[1].trim();
      if (inner) blocks.push(inner);
    }
    return blocks.length > 0 ? blocks.join("\n\n") : null;
  },
}));

import { AgentLoop } from "../../src/background/agent/loop";
import { workspaceManager } from "../../src/background/workspaces/manager";

describe("AgentLoop", () => {
  test("runs simple conversation with streaming", async () => {
    const onStatus = vi.fn();
    const onMessage = vi.fn();
    const onStep = vi.fn();

    const agent = new AgentLoop("test-key", undefined, {
      onStatusUpdate: onStatus,
      onMessage: onMessage,
      onStep: onStep,
    });

    await agent.start("Hello", 123);

    expect(mockCompleteStream).toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(AgentStatus.THINKING, "Analyzing...");
    // Unified mode: nudge→escalate→give-up ends with "Stalled" since mock LLM never emits tools
    expect(onStatus).toHaveBeenCalledWith(
      AgentStatus.IDLE,
      "Stalled — send a follow-up to continue",
    );
  });

  test("emits thinking steps during simple conversation", async () => {
    const onStatus = vi.fn();
    const onMessage = vi.fn();
    const onStep = vi.fn();

    const agent = new AgentLoop("test-key", undefined, {
      onStatusUpdate: onStatus,
      onMessage: onMessage,
      onStep: onStep,
    });

    await agent.start("Hello", 123);

    // Guardian decompose step + Filler-accelerated text-only give-up:
    // "Final answer" (12 chars) is detected as filler → consecutiveTextOnly += 2 each time
    // BRAINS→HANDS: starts at tier 1 (planner model, max tier in 2-tier system)
    // Pre-loop: guardian thinking(running) "Analyzing task scope..."
    // Turn 1: thinking(running) + thinking(done) → filler, textOnly=2 → already at tier 1, can't escalate
    // Turn 2: thinking(running) + thinking(done) → filler, textOnly=4 → give-up (>= 3)
    // = 1 guardian + 2 turns × 2 thinking = 5
    expect(onStep).toHaveBeenCalledTimes(5);

    // First call: guardian decompose thinking step
    const guardianCall = onStep.mock.calls[0];
    expect(guardianCall[0].type).toBe("thinking");
    expect(guardianCall[0].status).toBe("running");
    expect(guardianCall[1]).toBe(false);

    // Second call: turn 1 thinking step with running status
    const firstCall = onStep.mock.calls[1];
    expect(firstCall[0].type).toBe("thinking");
    expect(firstCall[0].status).toBe("running");
    expect(firstCall[1]).toBe(false); // update = false (new step)

    // Third call: update turn 1 thinking step to done
    const secondCall = onStep.mock.calls[2];
    expect(secondCall[0].type).toBe("thinking");
    expect(secondCall[0].status).toBe("done");
    expect(secondCall[0].durationMs).toBeDefined();
    expect(secondCall[1]).toBe(true); // update = true

    // Index 3-4: turn 2 thinking step (running + done), then give-up (consecutiveTextOnly >= 3)
    const turn2Start = onStep.mock.calls[3];
    expect(turn2Start[0].type).toBe("thinking");
    expect(turn2Start[0].status).toBe("running");
    const turn2Done = onStep.mock.calls[4];
    expect(turn2Done[0].type).toBe("thinking");
    expect(turn2Done[0].status).toBe("done");
  });
});

describe("High-risk approval policy", () => {
  function setupLLMSequence(responses: any[]) {
    let callIdx = 0;
    const doneResponse = {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "tc_auto_done",
          type: "function",
          function: { name: "done", arguments: '{"summary":"Auto-done"}' },
        },
      ],
      finish_reason: "tool_calls",
    };
    mockCompleteStream.mockImplementation((_req: any, _delta: any) => {
      const resp =
        callIdx < responses.length ? responses[callIdx] : doneResponse;
      callIdx++;
      return Promise.resolve(resp);
    });
  }

  function makeToolCall(
    id: string,
    name: string,
    args: Record<string, unknown>,
  ) {
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
      finish_reason: "tool_calls",
    };
  }

  function findToolResultInCalls(toolCallId: string): string | null {
    for (const call of mockCompleteStream.mock.calls) {
      const request = call[0];
      const messages = request?.messages;
      if (!Array.isArray(messages)) continue;
      const msg = messages.find(
        (m: any) => m.role === "tool" && m.tool_call_id === toolCallId,
      );
      if (msg?.content) return String(msg.content);
    }
    return null;
  }

  beforeEach(() => {
    mockCompleteStream.mockImplementation(defaultCompleteStreamFn);
    mockCompleteStream.mockClear();
    (chrome.runtime as any).sendMessage = vi.fn(async () => ({ success: true }));
  });

  test("requests explicit approval for high-risk tool when bypass is off", async () => {
    setupLLMSequence([
      makeToolCall("tc_nav", "navigate", { url: "https://example.com" }),
    ]);

    (chrome.runtime as any).sendMessage = vi.fn(async (msg: any) => {
      if (msg?.type === "APPROVAL_REQUEST") {
        AgentLoop.resolveApproval(msg.payload.approvalId, true);
      }
      return { success: true };
    });

    const onStep = vi.fn();
    const agent = new AgentLoop(
      "test-key",
      undefined,
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep,
      },
      { bypassApprovals: false },
    );

    await agent.start("Go to example.com", 123);

    const approvalRequests = (chrome.runtime.sendMessage as any).mock.calls.filter(
      (call: any[]) => call[0]?.type === "APPROVAL_REQUEST",
    );
    expect(approvalRequests.length).toBeGreaterThan(0);
    const approvalStep = onStep.mock.calls.find(
      (call: any[]) =>
        call[0]?.type === "info" &&
        String(call[0]?.label || "").includes("Approval granted"),
    );
    expect(approvalStep).toBeDefined();
  });

  test("denies high-risk action when user rejects approval", async () => {
    setupLLMSequence([
      makeToolCall("tc_nav_reject", "navigate", { url: "https://example.com" }),
    ]);

    (chrome.runtime as any).sendMessage = vi.fn(async (msg: any) => {
      if (msg?.type === "APPROVAL_REQUEST") {
        AgentLoop.resolveApproval(msg.payload.approvalId, false);
      }
      return { success: true };
    });

    const agent = new AgentLoop(
      "test-key",
      undefined,
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
      },
      { bypassApprovals: false },
    );

    await agent.start("Navigate to example.com", 123);

    const toolResult = findToolResultInCalls("tc_nav_reject");
    expect(toolResult).toContain("Action denied by user approval policy");
  });

  test("times out high-risk approval and denies tool execution", async () => {
    setupLLMSequence([
      makeToolCall("tc_nav_timeout", "navigate", { url: "https://example.com" }),
    ]);

    // No resolveApproval call -> should timeout and deny.
    (chrome.runtime as any).sendMessage = vi.fn(async (_msg: any) => ({
      success: true,
    }));

    const agent = new AgentLoop(
      "test-key",
      undefined,
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
      },
      { bypassApprovals: false, approvalTimeoutMs: 5 },
    );

    await agent.start("Navigate to example.com", 123);

    const toolResult = findToolResultInCalls("tc_nav_timeout");
    expect(toolResult).toContain("Action denied by user approval policy");
  });

  test("skips approval requests when bypass is enabled", async () => {
    setupLLMSequence([
      makeToolCall("tc_nav_bypass", "navigate", { url: "https://example.com" }),
    ]);

    (chrome.runtime as any).sendMessage = vi.fn(async (_msg: any) => ({
      success: true,
    }));

    const onStep = vi.fn();
    const agent = new AgentLoop(
      "test-key",
      undefined,
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep,
      },
      { bypassApprovals: true },
    );

    await agent.start("Navigate quickly", 123);

    const approvalRequests = (chrome.runtime.sendMessage as any).mock.calls.filter(
      (call: any[]) => call[0]?.type === "APPROVAL_REQUEST",
    );
    expect(approvalRequests.length).toBe(0);
    const bypassStep = onStep.mock.calls.find(
      (call: any[]) =>
        call[0]?.type === "info" &&
        String(call[0]?.label || "").includes("Approval bypassed"),
    );
    expect(bypassStep).toBeDefined();
  });
});

describe("Workspace-scoped tab operations", () => {
  /** Set up mockCompleteStream to return tool calls in order, then done() for all subsequent calls. */
  function setupLLMSequence(responses: any[]) {
    let callIdx = 0;
    const doneResponse = {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "tc_auto_done",
          type: "function",
          function: { name: "done", arguments: '{"summary":"Auto-done"}' },
        },
      ],
      finish_reason: "tool_calls",
    };
    mockCompleteStream.mockImplementation((_req: any, _delta: any) => {
      const resp =
        callIdx < responses.length ? responses[callIdx] : doneResponse;
      callIdx++;
      return Promise.resolve(resp);
    });
  }

  function createAgent(workspaceId: string | null = null) {
    return new AgentLoop(
      "test-key",
      undefined,
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      { workspaceId },
    );
  }

  function makeToolCall(
    id: string,
    name: string,
    args: Record<string, unknown>,
  ) {
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
      finish_reason: "tool_calls",
    };
  }

  // Save originals for restoration
  const origGetWorkspaceById = workspaceManager.getWorkspaceById;
  const origAddTabToWorkspace = workspaceManager.addTabToWorkspace;
  beforeEach(() => {
    mockCompleteStream.mockImplementation(defaultCompleteStreamFn);
    mockCompleteStream.mockClear();
    // Spy on the singleton methods directly
    workspaceManager.getWorkspaceById = origGetWorkspaceById;
    workspaceManager.addTabToWorkspace = origAddTabToWorkspace;
    (chrome.runtime as any).sendMessage = vi.fn(async (msg: any) => {
      if (msg?.type === "APPROVAL_REQUEST") {
        AgentLoop.resolveApproval(msg.payload.approvalId, true);
      }
      return { success: true };
    });
  });

  const testWorkspace = {
    id: "ws-1",
    name: "Test",
    color: "blue" as const,
    tabGroupId: 1,
    tabIds: [123, 789],
  };

  function mockWorkspace(ws: any) {
    workspaceManager.getWorkspaceById = (async () => ws) as any;
    workspaceManager.addTabToWorkspace = (async () => {}) as any;
  }

  test("switch_tab rejects tabs outside workspace", async () => {
    mockWorkspace(testWorkspace);

    setupLLMSequence([makeToolCall("tc_switch", "switch_tab", { tabId: 456 })]);

    const agent = createAgent("ws-1");
    await agent.start("Switch to tab 456", 123);

    // Second completeStream call should have the rejection message
    const msgs = mockCompleteStream.mock.calls[1][0].messages;
    const toolResult = msgs.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_switch",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("not in this workspace");
    expect(toolResult.content).toContain("123, 789");
  });

  test("switch_tab updates tabId for subsequent operations", async () => {
    mockWorkspace(testWorkspace);

    // Spy on chrome.tabs.sendMessage to verify snapshot refresh targets new tab
    const originalSendMessage = chrome.tabs.sendMessage;
    const sendMessageSpy = vi.fn(async () => ({
      payload: { result: "ok", success: true },
    }));
    (chrome.tabs as any).sendMessage = sendMessageSpy;

    setupLLMSequence([makeToolCall("tc_switch", "switch_tab", { tabId: 789 })]);

    const agent = createAgent("ws-1");
    await agent.start("Switch to 789", 123);

    // Verify switch_tab result confirms the switch
    const msgs = mockCompleteStream.mock.calls[1][0].messages;
    const toolResult = msgs.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_switch",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("Switched to tab 789");

    // Verify snapshot refresh targeted the new tab (789)
    const snapshotCalls = sendMessageSpy.mock.calls.filter(
      (c: any) => c[1]?.type === "DOM_SNAPSHOT_REQUEST",
    );
    const targetedNewTab = snapshotCalls.some((c: any) => c[0] === 789);
    expect(targetedNewTab).toBe(true);

    (chrome.tabs as any).sendMessage = originalSendMessage;
  });

  test("close_tab rejects tabs outside workspace", async () => {
    mockWorkspace(testWorkspace);

    setupLLMSequence([makeToolCall("tc_close", "close_tab", { tabId: 456 })]);

    const agent = createAgent("ws-1");
    await agent.start("Close tab 456", 123);

    const msgs = mockCompleteStream.mock.calls[1][0].messages;
    const toolResult = msgs.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_close",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("not in this workspace");
  });

  test("close_tab rejects closing the current tab", async () => {
    mockWorkspace(testWorkspace);

    setupLLMSequence([makeToolCall("tc_close", "close_tab", { tabId: 123 })]);

    const agent = createAgent("ws-1");
    await agent.start("Close current tab", 123);

    const msgs = mockCompleteStream.mock.calls[1][0].messages;
    const toolResult = msgs.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_close",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("Cannot close the current tab");
  });

  test("list_tabs returns only workspace tabs", async () => {
    mockWorkspace(testWorkspace);

    // Mock chrome.tabs.get to return proper tab objects
    const originalGet = chrome.tabs.get;
    (chrome.tabs as any).get = vi.fn(async (id: number) => ({
      id,
      title: `Tab ${id}`,
      url: `https://example.com/${id}`,
      active: id === 123,
      groupId: 1,
    }));

    setupLLMSequence([makeToolCall("tc_list", "list_tabs", {})]);

    const agent = createAgent("ws-1");
    await agent.start("List tabs", 123);

    const msgs = mockCompleteStream.mock.calls[1][0].messages;
    const toolResult = msgs.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_list",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("Tab 123");
    expect(toolResult.content).toContain("Tab 789");
    // Should NOT contain tabs outside the workspace
    expect(toolResult.content).not.toContain("Tab 456");

    (chrome.tabs as any).get = originalGet;
  });

  test("no workspace — no tab restrictions", async () => {
    mockWorkspace(null);

    // Mock chrome.tabs.query to return all tabs
    const originalQuery = chrome.tabs.query;
    (chrome.tabs as any).query = vi.fn(async () => [
      { id: 123, title: "Tab A", url: "https://a.com", active: true },
      { id: 456, title: "Tab B", url: "https://b.com", active: false },
    ]);

    setupLLMSequence([makeToolCall("tc_list", "list_tabs", {})]);

    // No workspaceId — no restrictions
    const agent = createAgent(null);
    await agent.start("List all tabs", 123);

    const msgs = mockCompleteStream.mock.calls[1][0].messages;
    const toolResult = msgs.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_list",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("Tab 123");
    expect(toolResult.content).toContain("Tab 456");

    (chrome.tabs as any).query = originalQuery;
  });
});
