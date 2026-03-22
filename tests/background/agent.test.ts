import { describe, test, expect, vi, beforeEach } from "vitest";
import "../setup";
import { AgentStatus, ToolName } from "../../src/types";

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
    activateExecutorFallback = vi.fn(() => {
      this.model = "google/gemini-3-flash-preview";
      return true;
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

import {
  AgentLoop,
  isPerceptionFailurePlaceholder,
  shouldOmitPerceptionForDoneValidation,
  validateTextEntryTarget,
} from "../../src/background/agent/loop";
import { workspaceManager } from "../../src/background/workspaces/manager";
import type { TaggedElement } from "../../src/types";

describe("AgentLoop", () => {
  test("blocks typing checkout name into non-text shipping radio input", () => {
    const target: TaggedElement = {
      tag: 15,
      tagName: "input",
      role: "radio",
      text: "Standard (Free)",
      attributes: {
        type: "radio",
        name: "shipping-method",
        value: "standard",
      },
      rect: { x: 0, y: 0, width: 20, height: 20 },
      isVisible: true,
      isDisabled: false,
    };

    const error = validateTextEntryTarget(
      'In the cart drawer checkout section, type Alex Morgan into the input with placeholder "Full name".',
      target,
      "Alex Morgan",
    );

    expect(error).toContain("not a text-entry field");
  });

  test("blocks typing email into full-name field", () => {
    const target: TaggedElement = {
      tag: 22,
      tagName: "input",
      role: "textbox",
      text: "",
      attributes: {
        type: "text",
        placeholder: "Full name",
        "aria-label": "Full name",
      },
      rect: { x: 0, y: 0, width: 100, height: 30 },
      isVisible: true,
      isDisabled: false,
    };

    const error = validateTextEntryTarget(
      'Type alex.morgan@example.com into the input with placeholder "Email address".',
      target,
      "alex.morgan@example.com",
    );

    expect(error).toContain("looks like a name field");
  });

  test("runs simple conversation with streaming", async () => {
    const onStatus = vi.fn();
    const onMessage = vi.fn();
    const onStep = vi.fn();

    const agent = new AgentLoop("test-key", {
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

    const agent = new AgentLoop("test-key", {
      onStatusUpdate: onStatus,
      onMessage: onMessage,
      onStep: onStep,
    });

    await agent.start("Hello", 123);

    // Guardian decompose step + uniform text-only counting with give-up at >= 4:
    // "Final answer" (12 chars) is detected as filler → consecutiveTextOnly += 1 each time
    // BRAINS→HANDS: starts at tier 1 (planner model)
    // Pre-loop: guardian thinking(running) "Analyzing task scope..."
    // Turn 1: tier 1, orientation, thinking(running) + thinking(done) → filler, textOnly=1
    // Turn 2: tier 1, orientation, thinking(running) + thinking(done) → filler, textOnly=2
    // Turn 3: orientation ends → info step "Handing off", deescalate to tier 0, cooldown=3
    //         thinking(running) + thinking(done) → filler, textOnly=3 (cooldown blocks escalation)
    // Turn 4: cooldown=2, thinking(running) + thinking(done) → filler, textOnly=4 → give-up (>= 4)
    // = 1 guardian + 4 turns × 2 thinking + 1 handoff info = 10
    expect(onStep).toHaveBeenCalledTimes(10);

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

    // Index 3-4: turn 2 thinking step (running + done)
    const turn2Start = onStep.mock.calls[3];
    expect(turn2Start[0].type).toBe("thinking");
    expect(turn2Start[0].status).toBe("running");
    const turn2Done = onStep.mock.calls[4];
    expect(turn2Done[0].type).toBe("thinking");
    expect(turn2Done[0].status).toBe("done");

    // Index 5: handoff info step "Handing off to executor model"
    const handoffStep = onStep.mock.calls[5];
    expect(handoffStep[0].type).toBe("info");
    expect(handoffStep[0].status).toBe("done");

    // Index 6-9: turns 3-4 thinking (running + done each), give-up at turn 4 (cTO >= 4)
    const turn3Start = onStep.mock.calls[6];
    expect(turn3Start[0].type).toBe("thinking");
    expect(turn3Start[0].status).toBe("running");
    const turn4Done = onStep.mock.calls[9];
    expect(turn4Done[0].type).toBe("thinking");
    expect(turn4Done[0].status).toBe("done");
  });

  test("applies inferred fallback tool profile when no plan status exists", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).originalQuery = "Enter the secret code into the input and submit it";
    (agent as any).context.getPlanStatusRaw = vi.fn(() => null);

    const tools = [
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.EXECUTE_JS } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.TYPE_TEXT);
    expect(names).toContain(ToolName.CLICK_ELEMENT);
    expect(names).toContain(ToolName.DONE);
    expect(names).not.toContain(ToolName.EXECUTE_JS);
  });

  test("applies read_only fallback profile for summarize tasks", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).originalQuery =
      "Open the GitHub repository page and summarize the README";
    (agent as any).context.getPlanStatusRaw = vi.fn(() => null);

    const tools = [
      { function: { name: ToolName.READ_PAGE } },
      { function: { name: ToolName.NAVIGATE } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.READ_PAGE);
    expect(names).toContain(ToolName.DONE);
    expect(names).not.toContain(ToolName.NAVIGATE);
    expect(names).not.toContain(ToolName.CLICK_ELEMENT);
  });

  test("treats the provider-exhausted marker as a perception failure placeholder", () => {
    expect(
      isPerceptionFailurePlaceholder(
        "[Visual perception failed: all providers exhausted]",
      ),
    ).toBe(true);
    expect(
      isPerceptionFailurePlaceholder("LOCATION:\n- GitHub README is visible"),
    ).toBe(false);
  });

  test("omits failed perception during done validation for read-only tasks after read_page", () => {
    expect(
      shouldOmitPerceptionForDoneValidation({
        interpretation: "[Visual perception failed: all providers exhausted]",
        hasReadPage: true,
        originalQuery: "Open the repository and summarize the README",
      }),
    ).toBe(true);

    expect(
      shouldOmitPerceptionForDoneValidation({
        interpretation: "[Visual perception failed: all providers exhausted]",
        hasReadPage: true,
        originalQuery: "Open checkout and place the order",
      }),
    ).toBe(false);
  });

  test("records fallback reason when plan status has no running subtask", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    const logInfo = vi.spyOn((agent as any).log, "info");
    (agent as any).originalQuery =
      "Enter the secret code into the input and submit it";
    (agent as any).context.getPlanStatusRaw = vi.fn(() => ({
      currentIndex: 0,
      subtasks: [{ description: "Old step", status: "pending" }],
    }));

    const tools = [
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.EXECUTE_JS } },
      { function: { name: ToolName.DONE } },
    ] as any;

    (agent as any).applyToolProfile(tools);

    const event = logInfo.mock.calls.find(
      (call: any[]) => call[1] === "Tool profile applied",
    );
    expect(event).toBeDefined();
    expect(event![2].source).toBe("fallback_inference");
    expect(event![2].fallbackReason).toBe("no_running_subtask_in_plan_status");
  });

  test("uses injected plan status before fallback inference", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        taskId: "task-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description: "Enter the secret code",
              status: "running",
              toolProfile: "enter_code",
            },
            {
              description: "Submit the form",
              status: "pending",
              toolProfile: "submit_form",
            },
          ],
        },
      },
    );

    const logInfo = vi.spyOn((agent as any).log, "info");
    (agent as any).originalQuery = "Do something else entirely";

    const tools = [
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.EXECUTE_JS } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);
    const event = logInfo.mock.calls.find(
      (call: any[]) => call[1] === "Tool profile applied",
    );

    expect(event).toBeDefined();
    expect(event![2].source).toBe("plan_status");
    expect(names).toContain(ToolName.TYPE_TEXT);
    expect(names).not.toContain(ToolName.EXECUTE_JS);
  });

  test("widens injected tool profile after step stagnation", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        taskId: "task-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description: "Enter the secret code",
              status: "running",
              toolProfile: "enter_code",
            },
          ],
        },
      },
    );

    const logInfo = vi.spyOn((agent as any).log, "info");
    (agent as any).turnsOnCurrentStep = (agent as any).limits.stepWarnTurns;

    const tools = [
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.EXECUTE_JS } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const event = logInfo.mock.calls.find(
      (call: any[]) =>
        call[1] === "Tool profile widened due to step stagnation",
    );

    expect(filtered).toHaveLength(tools.length);
    expect(event).toBeDefined();
  });

  test("syncPlanStatus preserves tool profiles when advancing steps", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        taskId: "task-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description: "Add item to cart",
              status: "running",
              toolProfile: "form_fill",
            },
            {
              description: "Submit order",
              status: "pending",
              toolProfile: "submit_form",
            },
          ],
        },
      },
    );

    const newIdx = (agent as any).advanceCompletedSubtasks();
    (agent as any).syncPlanStatus(newIdx);

    const planStatus = (agent as any).context.getPlanStatusRaw();
    expect(planStatus.currentIndex).toBe(1);
    expect(planStatus.subtasks[1].status).toBe("running");
    expect(planStatus.subtasks[1].toolProfile).toBe("submit_form");
  });

  test("syncPlanStatus repairs missing running subtask and records it", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    const logWarn = vi.spyOn((agent as any).log, "warn");
    (agent as any).planSubtasks = [
      { description: "Step 1", status: "completed", turnsUsed: 0, turnBudget: 0 },
      { description: "Step 2", status: "pending", turnsUsed: 0, turnBudget: 0 },
    ];

    (agent as any).syncPlanStatus(1);

    const planStatus = (agent as any).context.getPlanStatusRaw();
    expect(planStatus.subtasks[1].status).toBe("running");
    expect(
      logWarn.mock.calls.find(
        (call: any[]) => call[1] === "Plan status missing running subtask",
      ),
    ).toBeDefined();
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
