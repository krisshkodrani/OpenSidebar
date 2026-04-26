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
    private model = "accounts/fireworks/routers/kimi-k2p5-turbo";
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
      this.model = "accounts/fireworks/routers/kimi-k2p5-turbo";
      this._isPlannerTier = true;
    });
    switchToExecutor = vi.fn(() => {
      this.model = "accounts/fireworks/routers/kimi-k2p5-turbo";
      this._isPlannerTier = false;
    });
    activateExecutorFallback = vi.fn(() => {
      this.model = "accounts/fireworks/routers/kimi-k2p5-turbo";
      return true;
    });
    resetExecutorFallback = vi.fn();
    isPlannerTier = () => this._isPlannerTier;
    getCurrentModel = () => this.model;
    getCurrentProvider = () => "fireworks";
    getActiveProviderInfo = () => ({
      providerId: "fireworks",
      model: this.model,
    });
    setFailoverCallback = vi.fn(() => {});
  },
  MODEL_EXECUTOR: "accounts/fireworks/routers/kimi-k2p5-turbo",
  MODEL_PLANNER: "accounts/fireworks/routers/kimi-k2p5-turbo",
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
  countVisibleListDetailActions,
  getListDetailDoneRejection,
  getListDetailWorkflowBlock,
  getNextUnreviewedListDetailAction,
  isListDetailReturnControlRepeatExempt,
  isPerceptionFailurePlaceholder,
  requiresBroadListDetailReview,
  rewriteAutocompleteTextEntry,
  shouldOmitPerceptionForDoneValidation,
  validateTextEntryTarget,
} from "../../src/background/agent/loop";
import { getSnapshotFingerprint } from "../../src/background/agent/loop-helpers";
import { buildDomAwareProfile } from "../../src/background/tools/metadata";
import { workspaceManager } from "../../src/background/workspaces/manager";
import type { TaggedElement } from "../../src/types";

describe("AgentLoop", () => {
  function setPlanContext(
    agent: AgentLoop,
    params: {
      subtasks: Array<{ description: string; status: string }>;
      planSteps: Array<{ successCriteria?: string }>;
      snapshotText: string;
    },
  ) {
    (agent as any).planSubtasks = params.subtasks.map((subtask) => ({
      ...subtask,
      turnsUsed: 0,
      turnBudget: 0,
    }));
    (agent as any).planSteps = params.planSteps;
    (agent as any).context.getSnapshot = vi.fn(() => ({
      title: "Test Page",
      url: "https://example.com/test",
      elements: [],
      pageContent: params.snapshotText,
      visibleContent: params.snapshotText,
      scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
      viewportHeight: 800,
      timestamp: Date.now(),
    }));
  }

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

  test("rewriteAutocompleteTextEntry truncates full values for suggestion fields", () => {
    const target: TaggedElement = {
      tag: 31,
      tagName: "input",
      role: "textbox",
      text: "",
      attributes: {
        type: "text",
        placeholder: "Start typing an address...",
        id: "address-input",
        autocomplete: "off",
      },
      rect: { x: 0, y: 0, width: 200, height: 30 },
      isVisible: true,
      isDisabled: false,
    };

    const rewrite = rewriteAutocompleteTextEntry({
      objectiveText:
        "Select the address suggestion for 123 Main Street, Springfield, IL 62704 from the dropdown.",
      originalQuery: "",
      element: target,
      typedText: "123 Main Street, Springfield, IL 62704",
    });

    expect(rewrite).not.toBeNull();
    expect(rewrite?.rewrittenText).not.toBe(
      "123 Main Street, Springfield, IL 62704",
    );
    expect(rewrite?.rewrittenText.length).toBeLessThan(
      "123 Main Street, Springfield, IL 62704".length,
    );
    expect(rewrite?.reason).toContain("Wait for suggestions/dropdown");
  });

  test("rewriteAutocompleteTextEntry does not rewrite normal text entry", () => {
    const target: TaggedElement = {
      tag: 32,
      tagName: "input",
      role: "textbox",
      text: "",
      attributes: {
        type: "email",
        placeholder: "Email address",
        id: "email",
      },
      rect: { x: 0, y: 0, width: 200, height: 30 },
      isVisible: true,
      isDisabled: false,
    };

    const rewrite = rewriteAutocompleteTextEntry({
      objectiveText: "Type alex.morgan@example.com into the email field.",
      originalQuery: "",
      element: target,
      typedText: "alex.morgan@example.com",
    });

    expect(rewrite).toBeNull();
  });

  test("rewriteAutocompleteTextEntry falls back to original query for autocomplete element", () => {
    const target: TaggedElement = {
      tag: 33,
      tagName: "input",
      role: "textbox",
      text: "",
      attributes: {
        type: "text",
        placeholder: "Start typing to search products...",
        id: "product-input",
        autocomplete: "off",
      },
      rect: { x: 0, y: 0, width: 200, height: 30 },
      isVisible: true,
      isDisabled: false,
    };

    // Step objective does NOT mention suggestions, but original query does
    const rewrite = rewriteAutocompleteTextEntry({
      objectiveText:
        "Search for Laptop Stand in the product search field",
      originalQuery:
        "Fill in the address with '123 Main Street' from the suggestions, and search for 'Laptop Stand' in the product search.",
      element: target,
      typedText: "Laptop Stand",
    });

    expect(rewrite).not.toBeNull();
    expect(rewrite?.rewrittenText.length).toBeLessThan(
      "Laptop Stand".length,
    );
  });

  test("rewriteAutocompleteTextEntry does not rewrite normal input even when query mentions suggestions", () => {
    const target: TaggedElement = {
      tag: 34,
      tagName: "input",
      role: "textbox",
      text: "",
      attributes: {
        type: "tel",
        placeholder: "Phone number",
        id: "phone",
      },
      rect: { x: 0, y: 0, width: 200, height: 30 },
      isVisible: true,
      isDisabled: false,
    };

    // Original query mentions suggestions, but the element is a normal phone input
    const rewrite = rewriteAutocompleteTextEntry({
      objectiveText: "Type the phone number into the form",
      originalQuery:
        "Fill in the address from the suggestions, then enter your phone number 555-0123",
      element: target,
      typedText: "555-0123",
    });

    expect(rewrite).toBeNull();
  });

  test("rewriteAutocompleteTextEntry does not rewrite plain search input without autocomplete cues", () => {
    const target: TaggedElement = {
      tag: 35,
      tagName: "input",
      role: "textbox",
      text: "",
      attributes: {
        type: "text",
        placeholder: "Enter SKU (e.g. SKU-4829)",
        id: "sku-search",
        name: "skuSearch",
      },
      rect: { x: 0, y: 0, width: 240, height: 30 },
      isVisible: true,
      isDisabled: false,
    };

    const rewrite = rewriteAutocompleteTextEntry({
      objectiveText: "Search for the SKU number for Widget X in the search field.",
      originalQuery:
        "Go to Electronics under the Products menu, find the SKU number for Widget X, and search for it.",
      element: target,
      typedText: "SKU-4829",
    });

    expect(rewrite).toBeNull();
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

  test("uses DOM-aware profiling when no plan status exists", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).originalQuery = "Enter the secret code into the input and submit it";
    (agent as any).context.getPlanStatusRaw = vi.fn(() => null);
    // Provide a snapshot with a draggable element — drag_and_drop should be included
    (agent as any).context.getSnapshot = vi.fn(() => ({
      elements: [
        { tagName: "input", attributes: { type: "text" } },
        { tagName: "div", attributes: { draggable: "true" } },
      ],
    }));

    const tools = [
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.DRAG_AND_DROP } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.TYPE_TEXT);
    expect(names).toContain(ToolName.CLICK_ELEMENT);
    expect(names).toContain(ToolName.DRAG_AND_DROP); // DOM-aware: draggable detected
    expect(names).toContain(ToolName.DONE);
  });

  test("DOM-aware profiling always includes nav tools", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).originalQuery = "Go back to previous page";
    (agent as any).context.getPlanStatusRaw = vi.fn(() => null);
    (agent as any).context.getSnapshot = vi.fn(() => ({
      elements: [
        { tagName: "button", attributes: {} }, // no links, just buttons
      ],
    }));

    const tools = [
      { function: { name: ToolName.READ_PAGE } },
      { function: { name: ToolName.NAVIGATE } },
      { function: { name: ToolName.GO_BACK } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.NAVIGATE); // always in base set
    expect(names).toContain(ToolName.GO_BACK);   // always in base set
    expect(names).toContain(ToolName.CLICK_ELEMENT);
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

  test("uses DOM-aware profiling when plan status has no running subtask", () => {
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
    (agent as any).context.getSnapshot = vi.fn(() => ({
      elements: [{ tagName: "input", attributes: { type: "text" } }],
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
    expect(event![2].profile).toBe("dom_aware");
    expect(event![2].source).toBe("dom_snapshot");
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

  test("infers edit-surface tool profile from the running step when planner omitted one", () => {
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
              description:
                "Rename the document Q3 Report.pdf to Q3 Financial Report 2026.pdf",
              status: "running",
            },
          ],
        },
      },
    );

    const logInfo = vi.spyOn((agent as any).log, "info");
    (agent as any).planSteps = [
      { successCriteria: "The document list shows Q3 Financial Report 2026.pdf" },
    ];

    const tools = [
      { function: { name: ToolName.RIGHT_CLICK } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.PRESS_KEY } },
      { function: { name: ToolName.EXECUTE_JS } },
      { function: { name: ToolName.CLICK_COORDINATES } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);
    const event = logInfo.mock.calls.find(
      (call: any[]) => call[1] === "Tool profile applied",
    );

    expect(event).toBeDefined();
    expect(event![2].profile).toBe("edit_surface");
    expect(event![2].source).toBe("step_inference");
    expect(names).toContain(ToolName.RIGHT_CLICK);
    expect(names).toContain(ToolName.TYPE_TEXT);
    expect(names).toContain(ToolName.PRESS_KEY);
    expect(names).not.toContain(ToolName.EXECUTE_JS);
    expect(names).not.toContain(ToolName.CLICK_COORDINATES);
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

  test("upgrades careful messaging reply steps to submit-capable tools", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "thread-message-careful",
        taskId: "task-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description:
                "Reply in the project-updates channel with the release timing, changelog owner, and blocker",
              status: "running",
              toolProfile: "read_only",
            },
          ],
        },
      },
    );

    const tools = [
      { function: { name: ToolName.READ_PAGE } },
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.EXECUTE_JS } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.TYPE_TEXT);
    expect(names).toContain(ToolName.CLICK_ELEMENT);
    expect(names).not.toContain(ToolName.EXECUTE_JS);
  });

  test("keeps careful messaging read steps read-only", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "thread-message-careful",
        taskId: "task-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description:
                "Read the project-updates thread and identify Sarah's questions",
              status: "running",
              toolProfile: "read_only",
            },
          ],
        },
      },
    );

    const tools = [
      { function: { name: ToolName.READ_PAGE } },
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.READ_PAGE);
    expect(names).not.toContain(ToolName.TYPE_TEXT);
    expect(names).not.toContain(ToolName.CLICK_ELEMENT);
  });

  test("keeps careful messaging read steps with message wording read-only", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "thread-message-careful",
        taskId: "task-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description:
                "Read the customer message thread and summarize the blocker",
              status: "running",
              toolProfile: "read_only",
            },
          ],
        },
      },
    );

    const tools = [
      { function: { name: ToolName.READ_PAGE } },
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.READ_PAGE);
    expect(names).not.toContain(ToolName.TYPE_TEXT);
    expect(names).not.toContain(ToolName.CLICK_ELEMENT);
  });

  test("keeps careful messaging read steps with unrelated draft wording read-only", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "thread-message-careful",
        taskId: "task-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description:
                "Read the project-updates channel to identify who should draft the changelog",
              status: "running",
              toolProfile: "read_only",
            },
          ],
        },
      },
    );

    const tools = [
      { function: { name: ToolName.READ_PAGE } },
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.READ_PAGE);
    expect(names).not.toContain(ToolName.TYPE_TEXT);
    expect(names).not.toContain(ToolName.CLICK_ELEMENT);
  });

  test("upgrades CRM mutation steps to record-update tools", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "crm-ticket-update",
        taskId: "task-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description:
                "Update the ticket status to escalated, assign the owner, and add an internal note",
              status: "running",
              toolProfile: "read_only",
            },
          ],
        },
      },
    );

    const tools = [
      { function: { name: ToolName.READ_PAGE } },
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.SELECT_OPTION } },
      { function: { name: ToolName.SET_CHECKBOX } },
      { function: { name: ToolName.EXECUTE_JS } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.SELECT_OPTION);
    expect(names).toContain(ToolName.SET_CHECKBOX);
    expect(names).toContain(ToolName.TYPE_TEXT);
    expect(names).toContain(ToolName.CLICK_ELEMENT);
    expect(names).not.toContain(ToolName.EXECUTE_JS);
  });

  test("keeps CRM ticket review steps read-only", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "crm-ticket-update",
        taskId: "task-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description:
                "Read the ticket details including current status, priority, assignee, and customer impact",
              status: "running",
              toolProfile: "read_only",
            },
          ],
        },
      },
    );

    const tools = [
      { function: { name: ToolName.READ_PAGE } },
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.SELECT_OPTION } },
      { function: { name: ToolName.SET_CHECKBOX } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.READ_PAGE);
    expect(names).not.toContain(ToolName.TYPE_TEXT);
    expect(names).not.toContain(ToolName.CLICK_ELEMENT);
    expect(names).not.toContain(ToolName.SELECT_OPTION);
    expect(names).not.toContain(ToolName.SET_CHECKBOX);
  });

  test("applySkillToolRanking prefers skill tools and demotes discouraged ones", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "structured-form-fill",
      },
    );

    const tools = [
      { function: { name: ToolName.PRESS_KEY } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.DONE } },
      { function: { name: ToolName.READ_PAGE } },
      { function: { name: ToolName.SELECT_OPTION } },
    ] as any;

    const ranked = (agent as any).applySkillToolRanking(tools);
    const names = ranked.map((t: any) => t.function.name);

    expect(names).toEqual([
      ToolName.READ_PAGE,
      ToolName.TYPE_TEXT,
      ToolName.SELECT_OPTION,
      ToolName.CLICK_ELEMENT,
      ToolName.DONE,
      ToolName.PRESS_KEY,
    ]);
  });

  test("applySkillToolRanking keeps inline-edit tools ahead of discouraged coordinate fallback", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "inline-edit-surface",
      },
    );

    const tools = [
      { function: { name: ToolName.CLICK_COORDINATES } },
      { function: { name: ToolName.DONE } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.PRESS_KEY } },
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.READ_PAGE } },
    ] as any;

    const ranked = (agent as any).applySkillToolRanking(tools);
    const names = ranked.map((t: any) => t.function.name);

    expect(names).toEqual([
      ToolName.CLICK_ELEMENT,
      ToolName.PRESS_KEY,
      ToolName.TYPE_TEXT,
      ToolName.READ_PAGE,
      ToolName.CLICK_COORDINATES,
      ToolName.DONE,
    ]);
  });

  test("applySkillToolRanking returns the original order when no skill is selected", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    const tools = [
      { function: { name: ToolName.PRESS_KEY } },
      { function: { name: ToolName.CLICK_ELEMENT } },
      { function: { name: ToolName.TYPE_TEXT } },
    ] as any;

    const ranked = (agent as any).applySkillToolRanking(tools);
    expect(ranked).toEqual(tools);
  });

  test("preserves a broad turn budget for list-detail review loop skill", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "list-detail-review-loop",
        maxTurns: 45,
      },
    );

    expect((agent as any).maxTurns).toBe(45);
  });

  test("preserves a broad turn budget for multi-item procurement loop skill", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "multi-tab-procurement-loop",
        maxTurns: 60,
      },
    );

    expect((agent as any).maxTurns).toBe(45);
  });

  test("exempts list-detail return controls from same-argument repeat blocking", () => {
    const exempt = isListDetailReturnControlRepeatExempt({
      selectedSkillId: "list-detail-review-loop",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 45 },
      snapshot: {
        url: "https://example.com/jobs",
        title: "Jobs",
        timestamp: Date.now(),
        elements: [
          {
            tag: 45,
            tagName: "button",
            role: "button",
            text: "Back to Listings",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
        ],
      } as any,
    });

    expect(exempt).toBe(true);
  });

  test("does not exempt arbitrary repeated list-detail clicks", () => {
    const exempt = isListDetailReturnControlRepeatExempt({
      selectedSkillId: "list-detail-review-loop",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 35 },
      snapshot: {
        url: "https://example.com/jobs",
        title: "Jobs",
        timestamp: Date.now(),
        elements: [
          {
            tag: 35,
            tagName: "button",
            role: "button",
            text: "View details for Senior Frontend Engineer",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
        ],
      } as any,
    });

    expect(exempt).toBe(false);
  });

  test("does not replay cached list-detail return control clicks", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "list-detail-review-loop",
      },
    );
    (agent as any).context.setSnapshot({
      url: "https://example.com/jobs",
      title: "Frontend Developer",
      timestamp: Date.now(),
      elements: [
        {
          tag: 45,
          tagName: "button",
          role: "button",
          text: "Back to Listings",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);

    (agent as any).recordMutationSensitiveAction(
      ToolName.CLICK_ELEMENT,
      { id: 45 },
      'Clicked [45] button "Back to Listings"',
    );

    expect(
      (agent as any).replayMutationSensitiveAction(
        "call-1",
        ToolName.CLICK_ELEMENT,
        { id: 45 },
      ),
    ).toBe(false);
  });

  test("does not replay repeated mutations after the page snapshot changes", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).context.setSnapshot({
      url: "https://example.com/table",
      title: "Table",
      timestamp: Date.now(),
      elements: [
        {
          tag: 41,
          tagName: "button",
          role: "button",
          text: "Next",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 50,
          tagName: "td",
          role: "cell",
          text: "Page 1",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);

    (agent as any).recordMutationSensitiveAction(
      ToolName.CLICK_ELEMENT,
      { id: 41 },
      'Clicked [41] button "Next"',
    );

    (agent as any).context.setSnapshot({
      url: "https://example.com/table",
      title: "Table",
      timestamp: Date.now(),
      elements: [
        {
          tag: 41,
          tagName: "button",
          role: "button",
          text: "Next",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 50,
          tagName: "td",
          role: "cell",
          text: "Page 2",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);

    expect(
      (agent as any).replayMutationSensitiveAction(
        "call-1",
        ToolName.CLICK_ELEMENT,
        { id: 41 },
      ),
    ).toBe(false);
  });

  test("does not use the after-done cache for repeated mutations after the page snapshot changes", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).context.setSnapshot({
      url: "https://example.com/table",
      title: "Table",
      timestamp: Date.now(),
      elements: [
        {
          tag: 41,
          tagName: "button",
          role: "button",
          text: "Next",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 50,
          tagName: "td",
          role: "cell",
          text: "Page 1",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);

    (agent as any).recordMutationSensitiveAction(
      ToolName.CLICK_ELEMENT,
      { id: 41 },
      'Clicked [41] button "Next"',
    );
    (agent as any).guardAfterDoneRejection = true;

    (agent as any).context.setSnapshot({
      url: "https://example.com/table",
      title: "Table",
      timestamp: Date.now(),
      elements: [
        {
          tag: 41,
          tagName: "button",
          role: "button",
          text: "Next",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 50,
          tagName: "td",
          role: "cell",
          text: "Page 2",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);

    expect(
      (agent as any).replayMutationSensitiveAction(
        "call-1",
        ToolName.CLICK_ELEMENT,
        { id: 41 },
      ),
    ).toBe(false);
  });

  test("replays repeated non-pagination mutations when the page snapshot is unchanged", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).context.setSnapshot({
      url: "https://example.com/table",
      title: "Table",
      timestamp: Date.now(),
      elements: [
        {
          tag: 41,
          tagName: "button",
          role: "button",
          text: "Submit",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);

    (agent as any).recordMutationSensitiveAction(
      ToolName.CLICK_ELEMENT,
      { id: 41 },
      'Clicked [41] button "Submit"',
    );

    expect(
      (agent as any).replayMutationSensitiveAction(
        "call-1",
        ToolName.CLICK_ELEMENT,
        { id: 41 },
      ),
    ).toBe(true);
  });

  test("does not replay pagination clicks even when returning to a previously seen page", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "paginated-table-scan",
      },
    );
    const page2Snapshot = {
      url: "https://example.com/table",
      title: "Employee Directory",
      timestamp: Date.now(),
      pageContent:
        "Employee Directory # Name Salary 6 Frank Garcia $63,655 7 Diana Chen $65,386 Showing 6 - 10 of 50 Prev 1 2 3 Next Page 2 of 10",
      elements: [
        {
          tag: 41,
          tagName: "button",
          role: "button",
          text: "3",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any;

    (agent as any).context.setSnapshot(page2Snapshot);
    (agent as any).recordMutationSensitiveAction(
      ToolName.CLICK_ELEMENT,
      { id: 41 },
      'Clicked [41] button "3"',
    );
    (agent as any).context.setSnapshot({
      ...page2Snapshot,
      timestamp: Date.now() + 1,
    });

    expect(
      (agent as any).replayMutationSensitiveAction(
        "call-1",
        ToolName.CLICK_ELEMENT,
        { id: 41 },
      ),
    ).toBe(false);
  });

  test("snapshot fingerprint distinguishes paginated table pages after a long shared header", () => {
    const sharedHeader = `OpenSidebar Fixtures ${"Navigation ".repeat(80)}Employee Directory Browse and search employees across departments. `;
    const page1 = {
      url: "https://example.com/table",
      elements: { length: 49 },
      pageContent:
        sharedHeader +
        "# Name Salary 1 Alice Smith $55,000 2 Bob Johnson $56,731 Showing 1 - 5 of 50 Prev 1 2 3 Next Page 1 of 10",
    };
    const page2 = {
      url: "https://example.com/table",
      elements: { length: 49 },
      pageContent:
        sharedHeader +
        "# Name Salary 6 Frank Garcia $63,655 7 Diana Chen $65,386 Showing 6 - 10 of 50 Prev 1 2 3 Next Page 2 of 10",
    };

    expect(getSnapshotFingerprint(page1)).not.toBe(
      getSnapshotFingerprint(page2),
    );
  });

  test("preserves highest salary aggregate memory across paginated read_page results", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery =
      "Review the employee directory and tell me which employee has the highest salary and what that salary is.";

    const firstNote = (agent as any).updateMoneyTableAggregate(`Page: Employee Directory

Page content:
#
Name
Email
Department
Salary
1
Alice Smith
alice.smith@company.com
Engineering
$55,000
2
Bob Johnson
bob.johnson@company.com
Sales
$56,731
Showing 1-5 of 50`);

    expect(firstNote).toContain("Bob Johnson");
    expect(firstNote).toContain("$56,731");
    expect(firstNote).toContain("not exhaustive");
    expect(firstNote).toContain("Next action: click Next");

    const laterNote = (agent as any).updateMoneyTableAggregate(`Page: Employee Directory

Page content:
#
Name
Email
Department
Salary
35
Isla Wright
isla.wright@company.com
Marketing
$113,854
Showing 31\u201335 of 50`);

    expect(laterNote).toContain("Isla Wright");
    expect(laterNote).toContain("$113,854");
    expect(laterNote).toContain("rows read 10/50");
    expect((agent as any).context.getWorkingNotes()).toContain("Isla Wright");
  });

  test("updates highest salary aggregate memory from the current snapshot", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery =
      "Review the employee directory and tell me which employee has the highest salary and what that salary is.";
    (agent as any).context.setSnapshot({
      url: "https://example.com/table",
      title: "Employee Directory",
      timestamp: Date.now(),
      elements: [],
      pageContent: `#
Name
Email
Department
Salary
6
Frank Garcia
frank.garcia@company.com
Operations
$63,655
Showing 6-10 of 50`,
    } as any);

    (agent as any).updateMoneyTableAggregateFromSnapshot();

    expect((agent as any).context.getWorkingNotes()).toContain("Frank Garcia");
    expect((agent as any).context.getWorkingNotes()).toContain("rows read 5/50");
  });

  test("extracts highest salary aggregate from compact read_page table text", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery =
      "Review the employee directory and tell me which employee has the highest salary and what that salary is.";

    const note = (agent as any).updateMoneyTableAggregate(
      "Page content: Employee Directory 50 employees, 5 per page. # Name Email Department Salary 46 Yara Nelson yara.nelson@company.com Engineering $122,000 47 Omar Hall omar.hall@company.com Support $98,100 Showing 46 - 50 of 50 Page 10 of 10",
    );

    expect(note).toContain("Yara Nelson");
    expect(note).toContain("$122,000");
    expect((agent as any).context.getWorkingNotes()).toContain("seen rows 46-50/50");
  });

  test("rejects completed money table answer that conflicts with tracked aggregate", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery =
      "Review the employee directory and tell me which employee has the highest salary and what that salary is.";
    (agent as any).updateMoneyTableAggregate(
      "Page content: Employee Directory 10 employees, 5 per page. # Name Email Department Salary 1 Alice Smith alice.smith@company.com Engineering $55,000 2 Bob Johnson bob.johnson@company.com Sales $56,731 3 Cara Lopez cara.lopez@company.com HR $58,000 4 Dan Miller dan.miller@company.com Finance $59,000 5 Eva Moore eva.moore@company.com Legal $60,000 Showing 1 - 5 of 10 Page 1 of 2",
    );
    (agent as any).updateMoneyTableAggregate(
      "Page content: Employee Directory 10 employees, 5 per page. # Name Email Department Salary 6 Frank Garcia frank.garcia@company.com Operations $63,655 7 Yara Nelson yara.nelson@company.com Engineering $122,000 8 Omar Hall omar.hall@company.com Support $98,100 9 Ivy Stone ivy.stone@company.com Sales $99,000 10 Jack King jack.king@company.com Sales $100,000 Showing 6 - 10 of 10 Page 2 of 2",
    );

    const rejection = (agent as any).getIncorrectMoneyTableAggregateDoneRejection(
      "The highest salary is Jack King at $100,000.",
    );

    expect(rejection).toContain("Yara Nelson");
    expect(rejection).toContain("$122,000");
  });

  test("recognizes completed paginated money table aggregate summaries", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      { selectedSkillId: "paginated-table-scan" },
    );
    (agent as any).originalQuery =
      "Review the employee directory and tell me which employee has the highest salary and what that salary is.";
    (agent as any).updateMoneyTableAggregate(
      "Page content: Employee Directory 10 employees, 5 per page. # Name Email Department Salary 1 Alice Smith alice.smith@company.com Engineering $55,000 2 Bob Johnson bob.johnson@company.com Sales $56,731 3 Cara Lopez cara.lopez@company.com HR $58,000 4 Dan Miller dan.miller@company.com Finance $59,000 5 Eva Moore eva.moore@company.com Legal $60,000 Showing 1 - 5 of 10 Page 1 of 2",
    );
    (agent as any).updateMoneyTableAggregate(
      "Page content: Employee Directory 10 employees, 5 per page. # Name Email Department Salary 6 Frank Garcia frank.garcia@company.com Operations $63,655 7 Yara Nelson yara.nelson@company.com Engineering $122,000 8 Omar Hall omar.hall@company.com Support $98,100 9 Ivy Stone ivy.stone@company.com Sales $99,000 10 Jack King jack.king@company.com Sales $100,000 Showing 6 - 10 of 10 Page 2 of 2",
    );

    expect(
      (agent as any).isCompletedMoneyTableAggregateSummary(
        "The highest salary is Yara Nelson at $122,000.",
      ),
    ).toBe(true);
    expect(
      (agent as any).isCompletedMoneyTableAggregateSummary(
        "The highest salary is Jack King at $100,000.",
      ),
    ).toBe(false);
  });

  test("counts visible list-detail actions for broad review guards", () => {
    const count = countVisibleListDetailActions({
      url: "https://example.com/jobs",
      title: "Jobs",
      timestamp: Date.now(),
      elements: [
        {
          tag: 35,
          tagName: "button",
          role: "button",
          text: "View details for Senior Frontend Engineer at Nextera Tech",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 36,
          tagName: "button",
          role: "button",
          text: "View details for Full Stack Engineer at DataPulse",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 45,
          tagName: "button",
          role: "button",
          text: "Back to Listings",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);

    expect(count).toBe(2);
  });

  test("finds the next unreviewed visible list-detail action", () => {
    const next = getNextUnreviewedListDetailAction(
      {
        url: "https://example.com/jobs",
        title: "Jobs",
        timestamp: Date.now(),
        elements: [
          {
            tag: 35,
            tagName: "button",
            role: "button",
            text: "View details for Senior Frontend Engineer at Nextera Tech",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
          {
            tag: 36,
            tagName: "button",
            role: "button",
            text: "View details for Full Stack Engineer at DataPulse",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
        ],
      } as any,
      ["senior frontend engineer at nextera tech"],
    );

    expect(next).toEqual({
      id: 36,
      label: "full stack engineer at datapulse",
    });
  });

  test("ignores cosmetic attributes when deriving list-detail labels", () => {
    const next = getNextUnreviewedListDetailAction(
      {
        url: "https://example.com/jobs",
        title: "Jobs",
        timestamp: Date.now(),
        elements: [
          {
            tag: 35,
            tagName: "button",
            role: "button",
            text: "View details for Senior Frontend Engineer at Nextera Tech",
            attributes: {
              "aria-label":
                "View details for Senior Frontend Engineer at Nextera Tech",
              style: "background-color: rgb(37, 99, 235); color: rgb(255, 255, 255);",
            },
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
          {
            tag: 36,
            tagName: "button",
            role: "button",
            text: "View details for Full Stack Engineer at DataPulse",
            attributes: {
              style: "background-color: rgb(37, 99, 235); color: rgb(255, 255, 255);",
            },
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
        ],
      } as any,
      ["senior frontend engineer at nextera tech"],
    );

    expect(next).toEqual({
      id: 36,
      label: "full stack engineer at datapulse",
    });
  });

  test("blocks off-workflow tools when visible list details remain", () => {
    const block = getListDetailWorkflowBlock({
      selectedSkillId: "list-detail-review-loop",
      query:
        "Review the job listings and tell me which ones are the best matches for my profile and why.",
      toolName: ToolName.RIGHT_CLICK,
      args: { id: 12 },
      visibleDetailActionCount: 3,
      reviewedTargets: ["senior frontend engineer at nextera tech"],
      snapshot: {
        url: "https://example.com/jobs",
        title: "Jobs",
        timestamp: Date.now(),
        elements: [
          {
            tag: 35,
            tagName: "button",
            role: "button",
            text: "View details for Senior Frontend Engineer at Nextera Tech",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
          {
            tag: 36,
            tagName: "button",
            role: "button",
            text: "View details for Full Stack Engineer at DataPulse",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
          {
            tag: 37,
            tagName: "button",
            role: "button",
            text: "View details for QA Engineer at ClearWorks",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
        ],
      } as any,
    });

    expect(block).toContain("off workflow");
    expect(block).toContain('[36] "full stack engineer at datapulse"');
  });

  test("allows clicking an unreviewed list-detail action", () => {
    const block = getListDetailWorkflowBlock({
      selectedSkillId: "list-detail-review-loop",
      query:
        "Review the job listings and tell me which ones are the best matches for my profile and why.",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 36 },
      visibleDetailActionCount: 3,
      reviewedTargets: ["senior frontend engineer at nextera tech"],
      snapshot: {
        url: "https://example.com/jobs",
        title: "Jobs",
        timestamp: Date.now(),
        elements: [
          {
            tag: 35,
            tagName: "button",
            role: "button",
            text: "View details for Senior Frontend Engineer at Nextera Tech",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
          {
            tag: 36,
            tagName: "button",
            role: "button",
            text: "View details for Full Stack Engineer at DataPulse",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
        ],
      } as any,
    });

    expect(block).toBeNull();
  });

  test("blocks clicking an already reviewed list-detail action", () => {
    const block = getListDetailWorkflowBlock({
      selectedSkillId: "list-detail-review-loop",
      query:
        "Review the job listings and tell me which ones are the best matches for my profile and why.",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 35 },
      visibleDetailActionCount: 3,
      reviewedTargets: ["senior frontend engineer at nextera tech"],
      snapshot: {
        url: "https://example.com/jobs",
        title: "Jobs",
        timestamp: Date.now(),
        elements: [
          {
            tag: 35,
            tagName: "button",
            role: "button",
            text: "View details for Senior Frontend Engineer at Nextera Tech",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
          {
            tag: 36,
            tagName: "button",
            role: "button",
            text: "View details for Full Stack Engineer at DataPulse",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
          {
            tag: 37,
            tagName: "button",
            role: "button",
            text: "View details for QA Engineer at ClearWorks",
            attributes: {},
            rect: { x: 0, y: 0, width: 1, height: 1 },
            isVisible: true,
            isDisabled: false,
          },
        ],
      } as any,
    });

    expect(block).toContain("already been reviewed");
    expect(block).toContain("[36]");
  });

  test("tracks list-detail opened and reviewed state separately", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "list-detail-review-loop",
      },
    );
    const recordEvent = vi.fn();
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).turnCount = 4;

    const listSnapshot = {
      url: "https://example.com/jobs",
      title: "Jobs",
      timestamp: Date.now(),
      elements: [
        {
          tag: 35,
          tagName: "button",
          role: "button",
          text: "View details for Senior Frontend Engineer at Nextera Tech",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 36,
          tagName: "button",
          role: "button",
          text: "View details for Full Stack Engineer at DataPulse",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 37,
          tagName: "button",
          role: "button",
          text: "View details for QA Engineer at ClearWorks",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any;
    const detailSnapshot = {
      ...listSnapshot,
      url: "https://example.com/jobs/senior-frontend",
      title: "Senior Frontend Engineer",
      elements: [],
    };

    (agent as any).trackListDetailToolSuccess(
      ToolName.CLICK_ELEMENT,
      { id: 35 },
      listSnapshot,
    );

    expect((agent as any).listDetailOpenedTargets.size).toBe(1);
    expect((agent as any).listDetailReviewedTargets.size).toBe(0);

    (agent as any).trackListDetailToolSuccess(
      ToolName.READ_PAGE,
      {},
      detailSnapshot,
    );

    expect((agent as any).listDetailOpenedTargets.size).toBe(1);
    expect((agent as any).listDetailReviewedTargets.size).toBe(1);
    expect(recordEvent).toHaveBeenCalledWith(
      "list_detail_item_reviewed",
      expect.objectContaining({
        source: "read",
        openedCount: 1,
        reviewedCount: 1,
      }),
    );
  });

  test("does not count a list-page read as reviewing an opened detail", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "list-detail-review-loop",
      },
    );

    const listSnapshot = {
      url: "https://example.com/jobs",
      title: "Jobs",
      timestamp: Date.now(),
      elements: [
        {
          tag: 35,
          tagName: "button",
          role: "button",
          text: "View details for Senior Frontend Engineer at Nextera Tech",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 36,
          tagName: "button",
          role: "button",
          text: "View details for Full Stack Engineer at DataPulse",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 37,
          tagName: "button",
          role: "button",
          text: "View details for QA Engineer at ClearWorks",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any;

    (agent as any).trackListDetailToolSuccess(
      ToolName.CLICK_ELEMENT,
      { id: 35 },
      listSnapshot,
    );
    (agent as any).trackListDetailToolSuccess(
      ToolName.READ_PAGE,
      {},
      listSnapshot,
    );

    expect((agent as any).listDetailOpenedTargets.size).toBe(1);
    expect((agent as any).listDetailReviewedTargets.size).toBe(0);
  });

  test("redirects off-workflow list-detail tool calls to the next review action", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "list-detail-review-loop",
      },
    );
    const recordEvent = vi.fn();
    (agent as any).originalQuery =
      "Review the job listings and tell me which ones are the best matches for my profile and why.";
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).listDetailVisibleActionCount = 3;
    (agent as any).listDetailReviewedTargets = new Set([
      "senior frontend engineer at nextera tech",
    ]);
    (agent as any).context.setSnapshot({
      url: "https://example.com/jobs",
      title: "Jobs",
      timestamp: Date.now(),
      elements: [
        {
          tag: 35,
          tagName: "button",
          role: "button",
          text: "View details for Senior Frontend Engineer at Nextera Tech",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 36,
          tagName: "button",
          role: "button",
          text: "View details for Full Stack Engineer at DataPulse",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 37,
          tagName: "button",
          role: "button",
          text: "View details for QA Engineer at ClearWorks",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);
    const toolCall = {
      id: "call-1",
      type: "function",
      function: {
        name: ToolName.READ_PAGE,
        arguments: "{}",
      },
    } as any;

    const redirected = (agent as any).rewriteListDetailWorkflowToolCall(
      toolCall,
      "sequential",
    );

    expect(redirected).toBe(true);
    expect(toolCall.function.name).toBe(ToolName.CLICK_ELEMENT);
    expect(JSON.parse(toolCall.function.arguments)).toEqual({ id: 36 });
    expect(recordEvent).toHaveBeenCalledWith(
      "list_detail_workflow_tool_redirected",
      expect.objectContaining({
        fromTool: ToolName.READ_PAGE,
        toTool: ToolName.CLICK_ELEMENT,
        targetId: 36,
      }),
    );
  });

  test("redirects off-workflow detail-page actions to reading the open detail", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "list-detail-review-loop",
      },
    );
    const recordEvent = vi.fn();
    (agent as any).originalQuery =
      "Review the job listings and tell me which ones are the best matches for my profile and why.";
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).listDetailVisibleActionCount = 10;
    (agent as any).listDetailCurrentTarget =
      "full stack engineer at datapulse";
    (agent as any).listDetailOpenedTargets = new Set([
      "full stack engineer at datapulse",
    ]);
    (agent as any).context.setSnapshot({
      url: "https://example.com/jobs",
      title: "Full Stack Engineer",
      timestamp: Date.now(),
      elements: [
        {
          tag: 45,
          tagName: "button",
          role: "button",
          text: "Back to Listings",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);
    const toolCall = {
      id: "call-1",
      type: "function",
      function: {
        name: ToolName.CLICK_ELEMENT,
        arguments: JSON.stringify({ id: 37 }),
      },
    } as any;

    const redirected = (agent as any).rewriteListDetailWorkflowToolCall(
      toolCall,
      "sequential",
    );

    expect(redirected).toBe(true);
    expect(toolCall.function.name).toBe(ToolName.READ_PAGE);
    expect(toolCall.function.arguments).toBe("{}");
    expect(recordEvent).toHaveBeenCalledWith(
      "list_detail_workflow_tool_redirected",
      expect.objectContaining({
        fromTool: ToolName.CLICK_ELEMENT,
        toTool: ToolName.READ_PAGE,
        reason: "current_detail_needs_read",
      }),
    );
  });

  test("allows reading an unread detail page instead of returning to the list", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "list-detail-review-loop",
      },
    );
    (agent as any).originalQuery =
      "Review the job listings and tell me which ones are the best matches for my profile and why.";
    (agent as any).listDetailVisibleActionCount = 10;
    (agent as any).listDetailCurrentTarget =
      "frontend developer at startupgrid";
    (agent as any).listDetailOpenedTargets = new Set([
      "frontend developer at startupgrid",
    ]);
    (agent as any).context.setSnapshot({
      url: "https://example.com/jobs",
      title: "Frontend Developer",
      timestamp: Date.now(),
      elements: [
        {
          tag: 45,
          tagName: "button",
          role: "button",
          text: "Back to Listings",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);
    const toolCall = {
      id: "call-1",
      type: "function",
      function: {
        name: ToolName.READ_PAGE,
        arguments: "{}",
      },
    } as any;

    const redirected = (agent as any).rewriteListDetailWorkflowToolCall(
      toolCall,
      "sequential",
    );

    expect(redirected).toBe(false);
    expect(toolCall.function.name).toBe(ToolName.READ_PAGE);
  });

  test("redirects repeated reads on a reviewed detail page back to the listings", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "list-detail-review-loop",
      },
    );
    const recordEvent = vi.fn();
    (agent as any).originalQuery =
      "Review the job listings and tell me which ones are the best matches for my profile and why.";
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).listDetailVisibleActionCount = 10;
    (agent as any).listDetailCurrentTarget =
      "frontend developer at startupgrid";
    (agent as any).listDetailReviewedTargets = new Set([
      "frontend developer at startupgrid",
    ]);
    (agent as any).context.setSnapshot({
      url: "https://example.com/jobs",
      title: "Frontend Developer",
      timestamp: Date.now(),
      elements: [
        {
          tag: 45,
          tagName: "button",
          role: "button",
          text: "Back to Listings",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);
    const toolCall = {
      id: "call-1",
      type: "function",
      function: {
        name: ToolName.READ_PAGE,
        arguments: "{}",
      },
    } as any;

    const redirected = (agent as any).rewriteListDetailWorkflowToolCall(
      toolCall,
      "sequential",
    );

    expect(redirected).toBe(true);
    expect(toolCall.function.name).toBe(ToolName.CLICK_ELEMENT);
    expect(JSON.parse(toolCall.function.arguments)).toEqual({ id: 45 });
    expect(recordEvent).toHaveBeenCalledWith(
      "list_detail_workflow_tool_redirected",
      expect.objectContaining({
        fromTool: ToolName.READ_PAGE,
        toTool: ToolName.CLICK_ELEMENT,
        reason: "return_to_list_required",
      }),
    );
  });

  test("redirects detail-page drift back to the listings page after reading", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "list-detail-review-loop",
      },
    );
    const recordEvent = vi.fn();
    (agent as any).originalQuery =
      "Review the job listings and tell me which ones are the best matches for my profile and why.";
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).listDetailVisibleActionCount = 10;
    (agent as any).listDetailCurrentTarget =
      "full stack engineer at datapulse";
    (agent as any).listDetailReviewedTargets = new Set([
      "full stack engineer at datapulse",
    ]);
    (agent as any).context.setSnapshot({
      url: "https://example.com/jobs",
      title: "Full Stack Engineer",
      timestamp: Date.now(),
      elements: [
        {
          tag: 12,
          tagName: "a",
          role: "link",
          text: "GoBack",
          attributes: { href: "/go-back-chain" },
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 45,
          tagName: "button",
          role: "button",
          text: "Back to Listings",
          attributes: {},
          rect: { x: 0, y: 0, width: 1, height: 1 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    } as any);
    const toolCall = {
      id: "call-1",
      type: "function",
      function: {
        name: ToolName.CLICK_ELEMENT,
        arguments: JSON.stringify({ id: 12 }),
      },
    } as any;

    const redirected = (agent as any).rewriteListDetailWorkflowToolCall(
      toolCall,
      "sequential",
    );

    expect(redirected).toBe(true);
    expect(toolCall.function.name).toBe(ToolName.CLICK_ELEMENT);
    expect(JSON.parse(toolCall.function.arguments)).toEqual({ id: 45 });
    expect(recordEvent).toHaveBeenCalledWith(
      "list_detail_workflow_tool_redirected",
      expect.objectContaining({
        fromTool: ToolName.CLICK_ELEMENT,
        toTool: ToolName.CLICK_ELEMENT,
        targetId: 45,
        reason: "return_to_list_required",
      }),
    );
  });

  test("skips replanning for skill-owned broad list-detail reviews", async () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "list-detail-review-loop",
      },
    );
    const replanFrom = vi.fn();
    const recordEvent = vi.fn();
    (agent as any).originalQuery =
      "Review the job listings and tell me which ones are the best matches for my profile and why.";
    (agent as any).planner = { replanFrom };
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).planSubtasks = [
      {
        description: "Review job listings",
        status: "running",
        turnsUsed: 0,
        turnBudget: 0,
      },
    ];
    (agent as any).planSteps = [
      {
        id: "step-1",
        objective: "Review job listings",
        successCriteria: "All listings reviewed",
        type: "read",
      },
    ];

    const replanned = await (agent as any).replanOnEscalation(123, []);

    expect(replanned).toBe(false);
    expect(replanFrom).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "plan_replan_skipped_skill_owned_loop",
      expect.objectContaining({
        skillId: "list-detail-review-loop",
      }),
    );
  });

  test("skips replanning for skill-owned procurement loops", async () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "multi-tab-procurement-loop",
      },
    );
    const replanFrom = vi.fn();
    const recordEvent = vi.fn();
    (agent as any).originalQuery =
      "Buy the first two items from the procurement list and mark them complete.";
    (agent as any).planner = { replanFrom };
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).planSubtasks = [
      {
        description: "Complete procurement checklist workflow",
        status: "running",
        turnsUsed: 0,
        turnBudget: 0,
      },
    ];
    (agent as any).planSteps = [
      {
        id: "step-1",
        objective: "Complete procurement checklist workflow",
        successCriteria:
          "The requested procurement list items are purchased and marked complete.",
        type: "act",
      },
    ];

    const replanned = await (agent as any).replanOnEscalation(123, []);

    expect(replanned).toBe(false);
    expect(replanFrom).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "plan_replan_skipped_skill_owned_loop",
      expect.objectContaining({
        skillId: "multi-tab-procurement-loop",
      }),
    );
  });

  test("rejects done for incomplete broad list-detail recommendation reviews", () => {
    expect(
      requiresBroadListDetailReview(
        "Review the job listings and tell me which ones are the best matches for my profile and why.",
      ),
    ).toBe(true);

    const rejection = getListDetailDoneRejection({
      selectedSkillId: "list-detail-review-loop",
      query:
        "Review the job listings and tell me which ones are the best matches for my profile and why.",
      reviewedDetailCount: 2,
      visibleDetailActionCount: 10,
    });

    expect(rejection).toContain("reviewed 2/10 visible detail pages");
  });

  test("allows done once the visible list-detail candidate set is reviewed", () => {
    const rejection = getListDetailDoneRejection({
      selectedSkillId: "list-detail-review-loop",
      query:
        "Review the job listings and tell me which ones are the best matches for my profile and why.",
      reviewedDetailCount: 10,
      visibleDetailActionCount: 10,
    });

    expect(rejection).toBeNull();
  });

  test("recordSkillToolSelection traces the chosen tool preference for the active skill", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "structured-form-fill",
      },
    );
    const recordEvent = vi.fn();
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).turnCount = 3;

    (agent as any).recordSkillToolSelection(
      ToolName.PRESS_KEY,
      "sequential",
    );

    expect(recordEvent).toHaveBeenCalledWith("skill_tool_selected", {
      turn: 3,
      skillId: "structured-form-fill",
      toolName: ToolName.PRESS_KEY,
      preference: "discouraged",
      mode: "sequential",
    });
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

  test("text-admission gate passes for intermediate step after repeated admitted text", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        { description: "Go to Warehouse Gamma", status: "running" },
        { description: "Return to Warehouse Alpha", status: "pending" },
        { description: "Report both inventory counts", status: "pending" },
      ],
      planSteps: [
        { successCriteria: "Warehouse Gamma inventory count 6,412 visible" },
        { successCriteria: "Warehouse Alpha visible" },
        { successCriteria: "Gamma and Alpha counts reported" },
      ],
      snapshotText: "Warehouse Gamma inventory count: 6,412 units",
    });

    const result = (agent as any).evaluateTextAdmissionAdvanceGate({
      summary:
        "## Completed\nI navigated to Warehouse Gamma and verified 6,412 units.",
      consecutiveTextOnly: 2,
    });

    expect(result.passed).toBe(true);
    expect(result.runningIdx).toBe(0);
    expect(result.isLastStep).toBe(false);
  });

  test("text-admission gate identifies final step without auto-completing it", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [{ description: "Report Warehouse Gamma count", status: "running" }],
      planSteps: [{ successCriteria: "Warehouse Gamma inventory count 6,412 visible" }],
      snapshotText: "Warehouse Gamma inventory count: 6,412 units",
    });

    const result = (agent as any).evaluateTextAdmissionAdvanceGate({
      summary: "## Completed\nWarehouse Gamma inventory count is 6,412 units.",
      consecutiveTextOnly: 2,
    });

    expect(result.passed).toBe(true);
    expect(result.isLastStep).toBe(true);
  });

  test("text-admission gate blocks failure sentiment even when criteria match", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        { description: "Go to Warehouse Gamma", status: "running" },
        { description: "Return to Warehouse Alpha", status: "pending" },
      ],
      planSteps: [
        { successCriteria: "Warehouse Gamma inventory count 6,412 visible" },
        { successCriteria: "Warehouse Alpha visible" },
      ],
      snapshotText: "Warehouse Gamma inventory count: 6,412 units",
    });

    const result = (agent as any).evaluateTextAdmissionAdvanceGate({
      summary: "Unable to complete the Warehouse Gamma check even though the page changed.",
      consecutiveTextOnly: 2,
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("failure_sentiment");
  });

  test("text-admission gate blocks criteria mismatch", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        { description: "Go to Warehouse Gamma", status: "running" },
        { description: "Return to Warehouse Alpha", status: "pending" },
      ],
      planSteps: [
        { successCriteria: "Warehouse Gamma inventory count 6,412 visible" },
        { successCriteria: "Warehouse Alpha visible" },
      ],
      snapshotText: "Warehouse Alpha inventory count: 4,827 units",
    });

    const result = (agent as any).evaluateTextAdmissionAdvanceGate({
      summary: "## Completed\nWarehouse Gamma inventory count is visible.",
      consecutiveTextOnly: 2,
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("criteria_mismatch");
  });

  test("text-admission gate blocks on first text-only turn", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        { description: "Go to Warehouse Gamma", status: "running" },
        { description: "Return to Warehouse Alpha", status: "pending" },
      ],
      planSteps: [
        { successCriteria: "Warehouse Gamma inventory count 6,412 visible" },
        { successCriteria: "Warehouse Alpha visible" },
      ],
      snapshotText: "Warehouse Gamma inventory count: 6,412 units",
    });

    const result = (agent as any).evaluateTextAdmissionAdvanceGate({
      summary: "## Completed\nWarehouse Gamma inventory count is 6,412 units.",
      consecutiveTextOnly: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("first_text_only_turn");
  });

  test("verification-turn text-admission gate can pass on first text-only turn", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
      verificationTurnMode: true,
    });
    (agent as any).verificationTurnMode = true;

    setPlanContext(agent, {
      subtasks: [{ description: "Report Warehouse Gamma inventory count", status: "running" }],
      planSteps: [{ successCriteria: "Warehouse Gamma inventory count 6,412 visible" }],
      snapshotText: "Warehouse Gamma inventory count: 6,412 units",
    });

    const result = (agent as any).evaluateTextAdmissionAdvanceGate({
      summary: "## Completed\nWarehouse Gamma inventory count is 6,412 units.",
      consecutiveTextOnly: 1,
    });

    expect(result.passed).toBe(true);
    expect(result.isLastStep).toBe(true);
  });

  test("final-step text admission nudges done instead of auto-completing", async () => {
    mockCompleteStream.mockReset();
    let callIdx = 0;
    mockCompleteStream.mockImplementation((_request: any, onTextDelta: (delta: string) => void) => {
      callIdx++;
      if (callIdx <= 2) {
        const text = "## Completed\nWarehouse Gamma inventory count is 6,412 units.";
        onTextDelta(text);
        return Promise.resolve({
          role: "assistant",
          content: text,
          tool_calls: undefined,
          finish_reason: "stop",
        });
      }

      return Promise.resolve({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "tc_done",
            type: "function",
            function: {
              name: "done",
              arguments:
                '{"summary":"Warehouse Gamma inventory count is 6,412 units."}',
            },
          },
        ],
        finish_reason: "tool_calls",
      });
    });

    const onMessage = vi.fn();
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage,
        onStep: vi.fn(),
      },
      {
        preferredModelTier: "executor",
        taskId: "task-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description: "Report Warehouse Gamma count",
              status: "running",
            },
          ],
        },
      },
    );

    (agent as any).planSteps = [
      { successCriteria: "Warehouse Gamma inventory count 6,412 visible" },
    ];
    (agent as any).context.getSnapshot = vi.fn(() => ({
      title: "Warehouse Gamma",
      url: "https://example.com/gamma",
      elements: [],
      pageContent: "Warehouse Gamma inventory count: 6,412 units",
      visibleContent: "Warehouse Gamma inventory count: 6,412 units",
      scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
      viewportHeight: 800,
      timestamp: Date.now(),
    }));

    const result = await agent.start("Report Warehouse Gamma count", 123);

    expect(callIdx).toBeGreaterThanOrEqual(3);
    expect(result.outcome).not.toBe("completed");
  });

  test("bypasses stale plan rejection for satisfied spreadsheet edit tasks", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        { description: "Update the Q1 Sales cell in row 1 to 999", status: "running" },
        { description: "Clear the previous cell value if needed", status: "pending" },
      ],
      planSteps: [
        { successCriteria: "Spreadsheet shows Q1 Sales value 999 in the first row" },
        { successCriteria: "Old value is no longer present in the edited cell" },
      ],
      snapshotText:
        "Spreadsheet row 1 Q1 Sales value 999 is visible in the edited cell.",
    });
    (agent as any).originalQuery =
      "In the spreadsheet, change the Q1 Sales value in the first row to 999.";

    const result = (agent as any).shouldBypassPlanIncompleteDoneRejection({
      summary: "Updated the spreadsheet so the first-row Q1 Sales cell now shows 999.",
      currentStepIndex: 0,
    });

    expect(result).toBe(true);
  });

  test("bypasses stale plan rejection for satisfied procurement loop tasks", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        { description: "Open the store in a new tab", status: "completed" },
        { description: "Switch to the newly opened store tab", status: "running" },
        { description: "Add the item to cart and place the order", status: "pending" },
      ],
      planSteps: [
        { successCriteria: "Store tab opened" },
        { successCriteria: "Store tab is active" },
        { successCriteria: "Order confirmation visible" },
      ],
      snapshotText:
        "Procurement List shows 1 of 3 items completed after returning from the store tab.",
    });
    (agent as any).selectedSkillId = "multi-tab-procurement-loop";
    (agent as any).originalQuery =
      "Buy the first two items from the procurement list. Open each store in a new tab, purchase the item, then come back and check it off.";

    const result = (agent as any).shouldBypassPlanIncompleteDoneRejection({
      summary:
        "Purchased the first procurement item, returned to the procurement list, and checked off the completed row.",
      currentStepIndex: 1,
    });

    expect(result).toBe(true);
  });

  test("allows tab management tools for skill-owned procurement loops", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "multi-tab-procurement-loop",
      },
    );
    (agent as any).originalQuery =
      "Buy the first two items from the procurement list and mark them complete.";

    expect((agent as any).shouldBlockTabManagementTools()).toBe(false);
  });

  test("bypasses stale plan rejection when the page already shows final submission confirmation", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        { description: "Select Business for the category", status: "completed" },
        { description: "Pick the Standard budget", status: "running" },
        { description: "Submit the form", status: "pending" },
      ],
      planSteps: [
        { successCriteria: "Business category is selected" },
        { successCriteria: "Standard budget is selected" },
        { successCriteria: "Submission confirmation is visible" },
      ],
      snapshotText:
        "Submission Complete! Bob Martinez bob@company.com Reference Number REF-20481. Your request has been submitted successfully.",
    });
    (agent as any).originalQuery =
      "Select Business for the category, pick the Standard budget, and submit the form.";

    const result = (agent as any).shouldBypassPlanIncompleteDoneRejection({
      summary:
        "Submitted the form successfully and reached the submission complete page with Bob's details and a reference number.",
      currentStepIndex: 1,
    });

    expect(result).toBe(true);
  });

  test("redirects procurement return to the existing checklist tab", async () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        workspaceId: "ws-1",
        selectedSkillId: "multi-tab-procurement-loop",
      },
    );

    const originalGetWorkspaceById = workspaceManager.getWorkspaceById;
    workspaceManager.getWorkspaceById = (async () => ({
      id: "ws-1",
      name: "Test",
      color: "blue",
      tabGroupId: 1,
      tabIds: [123, 789],
    })) as any;

    const originalGet = chrome.tabs.get;
    (chrome.tabs as any).get = vi.fn(async (id: number) => {
      if (id === 123) {
        return {
          id,
          title: "TechDirect Store",
          url: "http://127.0.0.1:65055/procurement?store=techdirect",
          active: true,
        };
      }
      return {
        id,
        title: "Procurement List",
        url: "http://127.0.0.1:65055/procurement",
        active: false,
      };
    });

    (agent as any).context.getSnapshot = vi.fn(() => ({
      title: "TechDirect Store",
      url: "http://127.0.0.1:65055/procurement?store=techdirect",
      elements: [
        {
          tag: 17,
          tagName: "a",
          role: "link",
          text: "Procurement",
          attributes: { href: "/procurement" },
          isVisible: true,
          isDisabled: false,
        },
      ],
      pageContent: "Order confirmed for Ergonomic Keyboard.",
      visibleContent: "Order confirmed for Ergonomic Keyboard.",
      scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
      viewportHeight: 800,
      timestamp: Date.now(),
    }));
    (agent as any).context.getCurrentUrl = vi.fn(
      () => "http://127.0.0.1:65055/procurement?store=techdirect",
    );

    const redirect = await (agent as any).getWorkflowTabToolRedirect({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 17 },
      currentTabId: 123,
    });

    expect(redirect).toContain('switch_tab({"tabId": 789})');
    expect(redirect).toContain("checklist");

    (chrome.tabs as any).get = originalGet;
    workspaceManager.getWorkspaceById = originalGetWorkspaceById;
  });

  test("redirects procurement store reopen to the existing store tab", async () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        workspaceId: "ws-1",
        selectedSkillId: "multi-tab-procurement-loop",
      },
    );

    const originalGetWorkspaceById = workspaceManager.getWorkspaceById;
    workspaceManager.getWorkspaceById = (async () => ({
      id: "ws-1",
      name: "Test",
      color: "blue",
      tabGroupId: 1,
      tabIds: [123, 789],
    })) as any;

    const originalGet = chrome.tabs.get;
    (chrome.tabs as any).get = vi.fn(async (id: number) => {
      if (id === 123) {
        return {
          id,
          title: "Procurement List",
          url: "http://127.0.0.1:65055/procurement",
          active: true,
        };
      }
      return {
        id,
        title: "TechDirect Store",
        url: "http://127.0.0.1:65055/procurement?store=techdirect",
        active: false,
      };
    });

    (agent as any).context.getSnapshot = vi.fn(() => ({
      title: "Procurement List",
      url: "http://127.0.0.1:65055/procurement",
      elements: [
        {
          tag: 38,
          tagName: "a",
          role: "link",
          text: "Open TechDirect",
          attributes: { href: "/procurement?store=techdirect" },
          isVisible: true,
          isDisabled: false,
        },
      ],
      pageContent: "0 of 3 items completed.",
      visibleContent: "0 of 3 items completed.",
      scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
      viewportHeight: 800,
      timestamp: Date.now(),
    }));
    (agent as any).context.getCurrentUrl = vi.fn(
      () => "http://127.0.0.1:65055/procurement",
    );

    const redirect = await (agent as any).getWorkflowTabToolRedirect({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 38 },
      currentTabId: 123,
    });

    expect(redirect).toContain('switch_tab({"tabId": 789})');
    expect(redirect).toContain("already open");

    (chrome.tabs as any).get = originalGet;
    workspaceManager.getWorkspaceById = originalGetWorkspaceById;
  });

  test("redirects cross-tab compare to an already open matching tab", async () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        workspaceId: "ws-1",
        selectedSkillId: "cross-tab-compare",
      },
    );

    const originalGetWorkspaceById = workspaceManager.getWorkspaceById;
    workspaceManager.getWorkspaceById = (async () => ({
      id: "ws-1",
      name: "Test",
      color: "blue",
      tabGroupId: 1,
      tabIds: [123, 789],
    })) as any;

    const originalGet = chrome.tabs.get;
    (chrome.tabs as any).get = vi.fn(async (id: number) => {
      if (id === 123) {
        return {
          id,
          title: "Overview",
          url: "http://127.0.0.1:65055/compare",
          active: true,
        };
      }
      return {
        id,
        title: "Quarterly Report",
        url: "http://127.0.0.1:65055/reports/q1",
        active: false,
      };
    });

    (agent as any).context.getSnapshot = vi.fn(() => ({
      title: "Overview",
      url: "http://127.0.0.1:65055/compare",
      elements: [
        {
          tag: 44,
          tagName: "a",
          role: "link",
          text: "Q1 report",
          attributes: { href: "/reports/q1" },
          isVisible: true,
          isDisabled: false,
        },
      ],
      pageContent: "Compare quarterly reports.",
      visibleContent: "Compare quarterly reports.",
      scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
      viewportHeight: 800,
      timestamp: Date.now(),
    }));
    (agent as any).context.getCurrentUrl = vi.fn(
      () => "http://127.0.0.1:65055/compare",
    );

    const redirect = await (agent as any).getWorkflowTabToolRedirect({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 44 },
      currentTabId: 123,
    });

    expect(redirect).toContain('switch_tab({"tabId": 789})');
    expect(redirect).toContain("comparison page is already open");

    (chrome.tabs as any).get = originalGet;
    workspaceManager.getWorkspaceById = originalGetWorkspaceById;
  });

  test("rejects done while an inline spreadsheet edit field is still active", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        { description: "Update the Q1 Sales cell in row 1 to 999", status: "running" },
      ],
      planSteps: [
        { successCriteria: "Spreadsheet shows Q1 Sales value 999 in the first row" },
      ],
      snapshotText:
        "Spreadsheet row 1 Q1 Sales value 999 is visible while the cell is still marked (editing).",
    });
    (agent as any).originalQuery =
      "In the spreadsheet, change the Q1 Sales value in the first row to 999.";
    (agent as any).context.getSnapshot = vi.fn(() => ({
      title: "Quarterly Sales Sheet",
      url: "https://example.com/sheet",
      elements: [
        {
          tagName: "input",
          text: "999",
          isVisible: true,
          attributes: { type: "text", value: "999", "aria-label": "Q1 Sales editor" },
        },
      ],
      pageContent:
        "Quarterly Sales spreadsheet. Row 1 Q1 Sales value 999. Cell remains (editing).",
      visibleContent:
        "Quarterly Sales spreadsheet. Row 1 Q1 Sales value 999. Cell remains (editing).",
      scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
      viewportHeight: 800,
      timestamp: Date.now(),
    }));

    const result = (agent as any).getUncommittedInlineEditDoneRejection(0);

    expect(result).toContain("Commit the edit");
  });

  test("retargets inline-edit text entry from the cell tag to the active input", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        { description: "Update the Q1 Sales cell in row 1 to 999", status: "running" },
      ],
      planSteps: [
        { successCriteria: "Spreadsheet shows Q1 Sales value 999 in the first row" },
      ],
      snapshotText:
        "Spreadsheet editor is open for row 1 Q1 Sales while the cell is being edited.",
    });
    (agent as any).originalQuery =
      "In the spreadsheet, change the Q1 Sales value in the first row to 999.";
    (agent as any).context.getSnapshot = vi.fn(() => ({
      title: "Quarterly Sales Sheet",
      url: "https://example.com/sheet",
      elements: [
        {
          tag: 37,
          tagName: "td",
          role: "gridcell",
          text: "130",
          isVisible: true,
          isDisabled: false,
          rect: { x: 10, y: 10, width: 80, height: 24 },
          attributes: {},
        },
        {
          tag: 44,
          tagName: "input",
          role: "textbox",
          text: "130",
          isVisible: true,
          isDisabled: false,
          rect: { x: 12, y: 12, width: 76, height: 20 },
          attributes: { type: "text", value: "130", "aria-label": "Q1 Sales editor" },
        },
      ],
      pageContent:
        "Quarterly Sales spreadsheet. Row 1 Q1 Sales cell is in editing mode.",
      visibleContent:
        "Quarterly Sales spreadsheet. Row 1 Q1 Sales cell is in editing mode.",
      scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
      viewportHeight: 800,
      timestamp: Date.now(),
    }));

    const result = (agent as any).retargetInlineEditTextEntry({
      targetId: 37,
      currentStepIndex: 0,
    });

    expect(result).toEqual({
      retargetedId: 44,
      reason:
        "Retargeted type_text from [37] to the active inline editor [44] for this edit-surface step.",
    });
  });

  test("requires a verification read after committing an inline edit", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).pendingInlineEditVerification = {
      stepIndex: 0,
      reason: "You likely just committed an inline edit on this step.",
    };

    const mutationBlock = (agent as any).getPendingInlineEditVerificationBlock(
      ToolName.CLICK_ELEMENT,
      0,
    );
    expect(mutationBlock).toContain("Verify the committed page state");

    const readAllowed = (agent as any).getPendingInlineEditVerificationBlock(
      ToolName.READ_PAGE,
      0,
    );
    expect(readAllowed).toBeNull();

    const staleStep = (agent as any).getPendingInlineEditVerificationBlock(
      ToolName.CLICK_ELEMENT,
      1,
    );
    expect(staleStep).toBeNull();
    expect((agent as any).pendingInlineEditVerification).toBeNull();
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

    (chrome.runtime as any).sendMessage = vi.fn(async () => ({
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
      { bypassApprovals: false },
    );

    const result = await agent.start("Go to example.com", 123);

    const approvalRequests = (chrome.runtime.sendMessage as any).mock.calls.filter(
      (call: any[]) => call[0]?.type === "APPROVAL_REQUEST",
    );
    expect(approvalRequests.length).toBeGreaterThan(0);
    expect(result.outcome).toBe("awaiting_approval");
    expect(result.pendingInteraction).toMatchObject({
      kind: "approval",
      toolName: ToolName.NAVIGATE,
      args: { url: "https://example.com" },
    });
    const approvalStep = onStep.mock.calls.find(
      (call: any[]) =>
        call[0]?.type === "info" &&
        String(call[0]?.label || "").includes("Approval requested"),
    );
    expect(approvalStep).toBeDefined();
  });

  test("denies high-risk action when user rejects approval", async () => {
    setupLLMSequence([
      makeToolCall("tc_nav_reject", "navigate", { url: "https://example.com" }),
    ]);

    (chrome.runtime as any).sendMessage = vi.fn(async () => ({
      success: true,
    }));

    const initialAgent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
      },
      { bypassApprovals: false },
    );

    const initialResult = await initialAgent.start("Navigate to example.com", 123);
    expect(initialResult.outcome).toBe("awaiting_approval");
    expect(initialResult.pendingInteraction?.kind).toBe("approval");

    setupLLMSequence([
      makeToolCall("tc_nav_reject", "navigate", { url: "https://example.com" }),
    ]);
    const resumedAgent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
      },
      {
        bypassApprovals: false,
        resumeInteraction: {
          ...initialResult.pendingInteraction!,
          approved: false,
        },
      },
    );

    await resumedAgent.start("Navigate to example.com", 123);

    const toolResult = findToolResultInCalls("tc_nav_reject");
    expect(toolResult).toContain("Action denied by user approval policy");
  });

  test("times out high-risk approval and denies tool execution", async () => {
    setupLLMSequence([
      makeToolCall("tc_nav_timeout", "navigate", { url: "https://example.com" }),
    ]);

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

    const result = await agent.start("Navigate to example.com", 123);

    expect(result.outcome).toBe("awaiting_approval");
    expect(result.pendingInteraction).toMatchObject({
      kind: "approval",
      toolName: ToolName.NAVIGATE,
      args: { url: "https://example.com" },
      timeoutMs: 5,
    });
  });

  test("skips approval requests when bypass is enabled", async () => {
    setupLLMSequence([
      makeToolCall("tc_close_bypass", "close_tab", { tabId: 123 }),
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

    await agent.start("Close current tab quickly", 123);

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

  function createAgent(
    workspaceId: string | null = null,
    options?: { bypassApprovals?: boolean },
  ) {
    return new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      { workspaceId, bypassApprovals: options?.bypassApprovals },
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
    (chrome.runtime as any).sendMessage = vi.fn(async () => {
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

    const agent = createAgent("ws-1", { bypassApprovals: true });
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

    const agent = createAgent("ws-1", { bypassApprovals: true });
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

  test("applyToolProfile returns all tools when no snapshot available", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).originalQuery = "Do something";
    (agent as any).context.getPlanStatusRaw = vi.fn(() => null);
    (agent as any).context.getSnapshot = vi.fn(() => null);

    const tools = [
      { function: { name: ToolName.TYPE_TEXT } },
      { function: { name: ToolName.DRAG_AND_DROP } },
      { function: { name: ToolName.EXECUTE_JS } },
      { function: { name: ToolName.DONE } },
    ] as any;

    const filtered = (agent as any).applyToolProfile(tools);
    expect(filtered).toHaveLength(tools.length); // all tools pass through
  });
});

describe("buildDomAwareProfile", () => {
  test("empty elements returns base set without extras", () => {
    const profile = buildDomAwareProfile([]);
    expect(profile.has(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(profile.has(ToolName.TYPE_TEXT)).toBe(true);
    expect(profile.has(ToolName.DONE)).toBe(true);
    expect(profile.has(ToolName.NAVIGATE)).toBe(true); // nav always in base
    expect(profile.has(ToolName.GO_BACK)).toBe(true);
    // Extras not included without matching elements
    expect(profile.has(ToolName.DRAG_AND_DROP)).toBe(false);
    expect(profile.has(ToolName.UPLOAD_FILE)).toBe(false);
  });

  test("draggable elements add drag_and_drop", () => {
    const profile = buildDomAwareProfile([
      { tagName: "div", attributes: { draggable: "true" } },
    ]);
    expect(profile.has(ToolName.DRAG_AND_DROP)).toBe(true);
  });

  test("file input adds upload_file", () => {
    const profile = buildDomAwareProfile([
      { tagName: "input", attributes: { type: "file" } },
    ]);
    expect(profile.has(ToolName.UPLOAD_FILE)).toBe(true);
  });

  test("canvas adds click_coordinates", () => {
    const profile = buildDomAwareProfile([
      { tagName: "canvas", attributes: {} },
    ]);
    expect(profile.has(ToolName.CLICK_COORDINATES)).toBe(true);
  });

  test("navigation tools always in base set regardless of elements", () => {
    // Nav tools are always available — agent may need go_back from any page
    const profile = buildDomAwareProfile([]);
    expect(profile.has(ToolName.NAVIGATE)).toBe(true);
    expect(profile.has(ToolName.GO_BACK)).toBe(true);
    expect(profile.has(ToolName.CREATE_TAB)).toBe(true);
    expect(profile.has(ToolName.SWITCH_TAB)).toBe(true);
    expect(profile.has(ToolName.CLOSE_TAB)).toBe(true);
    expect(profile.has(ToolName.LIST_TABS)).toBe(true);
  });

  test("mixed elements include all relevant extras", () => {
    const profile = buildDomAwareProfile([
      { tagName: "div", attributes: { draggable: "true" } },
      { tagName: "input", attributes: { type: "file" } },
      { tagName: "a", attributes: { href: "/page" } },
      { tagName: "canvas", attributes: {} },
    ]);
    expect(profile.has(ToolName.DRAG_AND_DROP)).toBe(true);
    expect(profile.has(ToolName.UPLOAD_FILE)).toBe(true);
    expect(profile.has(ToolName.NAVIGATE)).toBe(true);
    expect(profile.has(ToolName.CLICK_COORDINATES)).toBe(true);
  });
});
