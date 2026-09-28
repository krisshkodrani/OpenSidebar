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
  const defaultFn = (request: any, onTextDelta: (delta: string) => void) => {
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
import {
  TURN_CHECKPOINT_VERSION,
  type TurnCheckpoint,
} from "../../src/background/agent/checkpoint-types";
import { buildTrustedReadAnswerCompletionCandidate } from "../../src/background/agent/completion-kernel";
import { assessInlineEditTextEntryRetarget } from "../../src/background/agent/text-entry-guards";
import {
  evaluateTextAdmissionAdvanceGate,
  type TextAdmissionGateHost,
} from "../../src/background/agent/text-admission-gate";
import {
  shouldBypassPlanIncompleteDoneRejection,
  type DonePlanValidationHost,
} from "../../src/background/agent/done-plan-validation";
import {
  detectExplicitSuccessSignalInSnapshot,
  type ExplicitSuccessSignalHost,
} from "../../src/background/agent/explicit-success-signal";
import { buildDomAwareProfile } from "../../src/background/tools/metadata";
import { workspaceManager } from "../../src/background/workspaces/manager";
import { shouldBlockTabManagementTools } from "../../src/background/agent/workflow-tab-routing";
import type { TaggedElement } from "../../src/types";

describe("AgentLoop", () => {
  function setPlanContext(
    agent: AgentLoop,
    params: {
      subtasks: Array<{ description: string; status: string }>;
      planSteps: Array<{
        objective?: string;
        successCriteria?: string;
        verifyAfter?: { trigger: string };
      }>;
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

  test("explicit success detection uses the active step scope", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).originalQuery =
      'Completed prior step: The page shows "Old signal".';
    setPlanContext(agent, {
      subtasks: [
        {
          description: 'Verify the page shows "Profile saved"',
          status: "running",
        },
      ],
      planSteps: [
        {
          objective: 'Verify the page shows "Profile saved"',
          successCriteria: 'The page shows "Profile saved"',
        },
      ],
      snapshotText: "Profile saved",
    });

    const result = detectExplicitSuccessSignalInSnapshot(
      agent as unknown as ExplicitSuccessSignalHost,
      {
        title: "Settings",
        url: "https://example.com/settings",
        pageContent: "Profile saved",
        visibleContent: "Profile saved",
      },
    );

    expect(result).toBe("Profile saved");
  });

  test("perception refresh can switch from structured DOM to unified VL", async () => {
    const recordEvent = vi.fn();
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      { perceptionMode: "auto" },
    );
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery = "Review the current page.";
    (agent as any).useVLExecutor = false;
    (agent as any).refreshPerception = vi.fn();
    (agent as any).triagePopups = vi.fn();
    const currentObservation = vi.spyOn(
      (agent as any).perception,
      "getCurrentObservation",
    );
    (agent as any).context.setSnapshot({
      title: "Chart Canvas",
      url: "https://example.com/chart",
      visibleContent: "Q4 status",
      pageContent: "Q4 status",
      elements: [
        {
          tag: 1,
          tagName: "canvas",
          role: "img",
          text: "",
          attributes: {},
          rect: { x: 0, y: 0, width: 600, height: 320 },
          isVisible: true,
          isDisabled: false,
        },
      ],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    await (agent as any).refreshPerceptionAndTriage(123);

    expect((agent as any).useVLExecutor).toBe(true);
    expect(currentObservation).toHaveBeenCalled();
    expect((agent as any).refreshPerception).not.toHaveBeenCalled();
    expect((agent as any).triagePopups).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "perception_mode_decision",
      expect.objectContaining({
        dynamic: true,
        previousMode: "structured",
        mode: "unified_vl",
        reason: "canvas_present",
      }),
    );
  });

  test("perception refresh switches from unified VL to a text-only DOM turn", async () => {
    const recordEvent = vi.fn();
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      { perceptionMode: "auto" },
    );
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery = "Fill out the account form.";
    (agent as any).useVLExecutor = true;
    const currentObservation = vi.spyOn(
      (agent as any).perception,
      "getCurrentObservation",
    );
    const setScreenshot = vi.spyOn(
      (agent as any).context,
      "setScreenshotForExecutor",
    );
    const setInterpretation = vi.spyOn(
      (agent as any).context,
      "setPageInterpretation",
    );
    // Dense text-heavy DOM: post LP-11 flip, this is the signal-less page
    // shape that still argues FOR structured (>= 40 elements, >= 2000 chars).
    const text = "Account form ".repeat(200);
    (agent as any).context.setSnapshot({
      title: "Account Form",
      url: "https://example.com/account",
      visibleContent: text,
      pageContent: text,
      elements: Array.from({ length: 50 }, (_, index) => ({
        tag: index + 1,
        tagName: "input",
        role: "textbox",
        text: `Field ${index + 1}`,
        attributes: { value: "" },
        rect: { x: 0, y: index * 32, width: 320, height: 24 },
        isVisible: true,
        isDisabled: false,
      })),
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    await (agent as any).refreshPerceptionAndTriage(123);

    expect((agent as any).useVLExecutor).toBe(false);
    // Structured now means a text-only executor turn: no screenshot, no
    // separate perception model interpretation.
    expect(currentObservation).not.toHaveBeenCalled();
    expect(setScreenshot).toHaveBeenCalledWith(null);
    expect(setInterpretation).toHaveBeenCalledWith(null);
    expect(recordEvent).toHaveBeenCalledWith(
      "perception_mode_decision",
      expect.objectContaining({
        dynamic: true,
        previousMode: "unified_vl",
        mode: "structured",
        reason: "dense_text_dom",
      }),
    );
  });

  test("job-application submit approval ignores workflow boilerplate", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).originalQuery = [
      "Selected workflow skill:",
      "5. Apply the requested delta in place when possible.",
      "## Current Task",
      "Objective: Submit the incident form by clicking the Submit button",
      "Original user request (reference for specific values):",
      "Create a new incident with Caller Joe Employee and Channel Phone.",
    ].join("\n");
    (agent as any).planSubtasks = [
      {
        description: "Submit the incident form by clicking the Submit button",
        status: "running",
        turnsUsed: 0,
        turnBudget: 0,
      },
    ];
    (agent as any).planSteps = [
      {
        objective: "Submit the incident form by clicking the Submit button",
        successCriteria: "Incident record is created",
      },
    ];
    (agent as any).lastPlanIndex = 0;
    (agent as any).elementResolver = () => '"Submit" button';

    expect(
      (agent as any).requiresJobApplicationSubmitApproval(
        ToolName.CLICK_ELEMENT,
        {
          id: 40,
        },
      ),
    ).toBe(false);
  });

  test("job-application submit approval still applies to job workflows", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).originalQuery = [
      "## Current Task",
      "Objective: Submit the software engineer job application",
      "Original user request:",
      "Apply for the software engineer job using my resume.",
    ].join("\n");
    (agent as any).planSubtasks = [
      {
        description: "Submit the software engineer job application",
        status: "running",
        turnsUsed: 0,
        turnBudget: 0,
      },
    ];
    (agent as any).planSteps = [
      {
        objective: "Submit the software engineer job application",
        successCriteria: "Application submitted",
      },
    ];
    (agent as any).lastPlanIndex = 0;
    (agent as any).elementResolver = () => '"Submit" button';

    expect(
      (agent as any).requiresJobApplicationSubmitApproval(
        ToolName.CLICK_ELEMENT,
        {
          id: 40,
        },
      ),
    ).toBe(true);
  });

  test("destructive delete clicks require approval even when the user requested deletion", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).originalQuery = "Delete the selected email messages.";
    (agent as any).elementResolver = () => 'button "Delete"';

    expect(
      (agent as any).requiresConsequentialActionApproval(
        ToolName.CLICK_ELEMENT,
        { id: 40 },
      ),
    ).toBe(true);
  });

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
      objectiveText: "Search for Laptop Stand in the product search field",
      originalQuery:
        "Fill in the address with '123 Main Street' from the suggestions, and search for 'Laptop Stand' in the product search.",
      element: target,
      typedText: "Laptop Stand",
    });

    expect(rewrite).not.toBeNull();
    expect(rewrite?.rewrittenText.length).toBeLessThan("Laptop Stand".length);
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
      objectiveText:
        "Search for the SKU number for Widget X in the search field.",
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

  // --- Escalation tier characterization (LP-15 Phase 6 regression net) ---
  // The tier locals live inside loop() and aren't accessible, so we pin
  // OBSERVABLE behavior: the context.setModelTier trajectory (only callers are
  // escalateModel/deescalateModel). These must stay byte-green across the
  // TurnState / EscalationTierController extraction.

  test("plan-then-act: starts on planner tier, then hands off to executor", async () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    const setModelTier = vi.spyOn((agent as any).context, "setModelTier");

    await agent.start("Hello", 123);

    const tiers = setModelTier.mock.calls.map((c: any[]) => c[0]);
    // Orientation begins on planner (loop init), then the handoff de-escalates
    // to executor once orientation ends.
    expect(tiers[0]).toBe("planner");
    expect(tiers).toContain("executor");
    expect(tiers.indexOf("planner")).toBeLessThan(tiers.indexOf("executor"));
  });

  test("uses DOM-aware profiling when no plan status exists", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    (agent as any).originalQuery =
      "Enter the secret code into the input and submit it";
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

    const filtered = agent.skillTools.applyToolProfile(tools);
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

    const filtered = agent.skillTools.applyToolProfile(tools);
    const names = filtered.map((t: any) => t.function.name);

    expect(names).toContain(ToolName.NAVIGATE); // always in base set
    expect(names).toContain(ToolName.GO_BACK); // always in base set
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

    agent.skillTools.applyToolProfile(tools);

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

    const filtered = agent.skillTools.applyToolProfile(tools);
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
      {
        successCriteria: "The document list shows Q3 Financial Report 2026.pdf",
      },
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

    const filtered = agent.skillTools.applyToolProfile(tools);
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

    const filtered = agent.skillTools.applyToolProfile(tools);
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

    const filtered = agent.skillTools.applyToolProfile(tools);
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

    const filtered = agent.skillTools.applyToolProfile(tools);
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

    const filtered = agent.skillTools.applyToolProfile(tools);
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

    const filtered = agent.skillTools.applyToolProfile(tools);
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

    const filtered = agent.skillTools.applyToolProfile(tools);
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

    const filtered = agent.skillTools.applyToolProfile(tools);
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

    const ranked = agent.skillTools.applySkillToolRanking(tools);
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

  test("catalog order helper auto-submits after trusted configuration", async () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "catalog-order-workflow",
      },
    );
    (agent as any).originalQuery =
      'Go to the hardware store and order 10 "Premium Monitor".';
    const executeToolCall = vi
      .spyOn(agent as any, "executeToolCall")
      .mockResolvedValue(
        "Configured catalog item.\nClicked submit control: Add to Cart",
      );
    vi.spyOn(agent as any, "refreshSnapshotWithRetry").mockResolvedValue(0);

    await (agent as any).maybeAutoSubmitConfiguredCatalogItem({
      toolName: ToolName.CONFIGURE_CATALOG_ITEM,
      toolArgs: { quantity: "10", submit: false },
      toolResult:
        "Configured catalog item.\nConfigured:\n- Quantity=10\n- Adobe Acrobat=checked",
      tabId: 123,
      mode: "sequential",
    });

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(executeToolCall.mock.calls[0][0].function.arguments),
    ).toEqual({ quantity: "10", submit: true, continueToCheckout: true });
  });

  test("catalog order helper waits when explicit configuration fields are missing", async () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "catalog-order-workflow",
      },
    );
    (agent as any).originalQuery =
      'Go to the hardware store and order 5 "Loaner Laptop" with configuration {\'How long do you need it for ?\': \'1 week\', \'When do you need it ?\': \'On time for the next meeting\'}';

    expect(
      (agent as any).shouldAutoSubmitConfiguredCatalogItem({
        toolName: ToolName.CONFIGURE_CATALOG_ITEM,
        toolArgs: { quantity: "5", submit: false },
        toolResult:
          'Configured catalog item.\nConfigured:\n- Quantity=5\n- When do you need it ?="On time for the next meeting"',
      }),
    ).toBe(false);

    expect(
      (agent as any).shouldAutoSubmitConfiguredCatalogItem({
        toolName: ToolName.CONFIGURE_CATALOG_ITEM,
        toolArgs: { quantity: "5", submit: false },
        toolResult:
          'Configured catalog item.\nConfigured:\n- Quantity=5\n- How long do you need it for ?=1 week\n- When do you need it ?="On time for the next meeting"',
      }),
    ).toBe(true);
  });

  test("deterministic done accepts current quiz selection despite stale planner question", async () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery = "Select the correct option/s";
    (agent as any).hasReadPage = true;
    (agent as any).taskId = "task-quiz";
    (agent as any).planSubtasks = [
      {
        description:
          "Read the current quiz question and select the correct answer(s) for Question 31",
        status: "running",
      },
      { description: "Report completion", status: "pending" },
    ];
    (agent as any).planSteps = [
      {
        objective: "Select quiz answers",
        successCriteria: "Question 31 answers are selected",
      },
      { objective: "Report completion" },
    ];
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: false,
      reason: "stale planner should not run",
    }));
    (agent as any).context.setSnapshot({
      title: "Quiz",
      url: "https://example.test/quiz",
      visibleContent:
        "Question 32. Which approaches help adapt a foundation model? (Select two)",
      pageContent:
        "Question 32. Which approaches help adapt a foundation model? (Select two)",
      elements: [
        {
          tag: 158,
          tagName: "input",
          role: "checkbox",
          text: "on",
          attributes: {
            id: "choice-158",
            control: "choice-158",
            name: "answer",
            type: "checkbox",
            checked: "true",
            label: "Domain Adaptation Fine-Tuning",
          },
          rect: { x: 0, y: 0, width: 16, height: 16 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 159,
          tagName: "input",
          role: "checkbox",
          text: "on",
          attributes: {
            id: "choice-159",
            control: "choice-159",
            name: "answer",
            type: "checkbox",
            checked: "true",
            label: "Continued Pre-Training",
          },
          rect: { x: 0, y: 20, width: 16, height: 16 },
          isVisible: true,
          isDisabled: false,
        },
      ],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-1",
      "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
      123,
    );

    expect(accepted).toBe(true);
    expect((agent as any).completedResult).toMatchObject({
      outcome: "completed",
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
      completionEnvelope: {
        status: "completed",
        source: "model_done",
        contractKind: "quiz_selection",
        evidenceKeys: expect.arrayContaining([
          expect.stringContaining("domain-adaptation-fine-tuning"),
        ]),
      },
    });
    const resultId = (agent as any).completedResult.completionEnvelope.resultId;
    const duplicateAccepted = await (agent as any).handleDoneToolCall(
      "done-call-2",
      "Trying to finish again should reuse the first result.",
      123,
    );

    expect(duplicateAccepted).toBe(true);
    expect((agent as any).completedResult.completionEnvelope.resultId).toBe(
      resultId,
    );
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    expect((agent as any).doneRejections).toBe(0);
  });

  test("done grounding preflight runs before deterministic quiz acceptance", async () => {
    const recordEvent = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery =
      "Read this page, then select the correct option/s.";
    (agent as any).hasReadPage = true;
    (agent as any).hasExplicitPageRead = false;
    (agent as any).taskId = "task-quiz-grounding";
    (agent as any).forceGroundingRefresh = vi.fn(async () => undefined);
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: false,
      reason: "planner should not run",
    }));
    (agent as any).context.setSnapshot({
      title: "Quiz",
      url: "https://example.test/quiz",
      visibleContent:
        "Question 32. Which approaches help adapt a foundation model? Select two. The page contains a long prompt with multiple answer choices and explanatory text.",
      pageContent:
        "Question 32. Which approaches help adapt a foundation model? Select two. The page contains a long prompt with multiple answer choices and explanatory text.",
      elements: [
        {
          tag: 158,
          tagName: "input",
          role: "checkbox",
          text: "on",
          attributes: {
            id: "choice-158",
            name: "answer",
            type: "checkbox",
            checked: "true",
            label: "Domain Adaptation Fine-Tuning",
          },
          rect: { x: 0, y: 0, width: 16, height: 16 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 159,
          tagName: "input",
          role: "checkbox",
          text: "on",
          attributes: {
            id: "choice-159",
            name: "answer",
            type: "checkbox",
            checked: "true",
            label: "Continued Pre-Training",
          },
          rect: { x: 0, y: 20, width: 16, height: 16 },
          isVisible: true,
          isDisabled: false,
        },
        ...Array.from({ length: 4 }, (_, index) => ({
          tag: 200 + index,
          tagName: "div",
          role: "text",
          text: `Supporting quiz content ${index + 1}`,
          attributes: {},
          rect: { x: 0, y: 40 + index * 20, width: 300, height: 18 },
          isVisible: true,
          isDisabled: false,
        })),
      ],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-grounded-quiz",
      "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).completedResult).toBeNull();
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    expect((agent as any).forceGroundingRefresh).toHaveBeenCalledWith(
      123,
      "done_before_grounding_read",
    );
    expect(recordEvent).toHaveBeenCalledWith(
      "done_rejected_no_read",
      expect.objectContaining({
        elementCount: 6,
      }),
    );
    expect(recordEvent).not.toHaveBeenCalledWith(
      "completion_decision",
      expect.objectContaining({
        status: "accepted",
        contractKind: "quiz_selection",
      }),
    );
  });

  test("deterministic form-fill rejection gives form-specific guidance", async () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery = 'Set Caller to "Joe Employee".';
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: false,
      reason: "deterministic form-fill rejection should not reach planner",
    }));
    (agent as any).context.setSnapshot({
      title: "Incident",
      url: "https://example.test/incident",
      visibleContent: "Caller Jane Manager",
      pageContent: "Caller Jane Manager",
      elements: [
        {
          tag: 201,
          tagName: "input",
          role: "textbox",
          text: "Jane Manager",
          attributes: {
            id: "caller",
            name: "caller",
            label: "Caller",
            value: "Jane Manager",
          },
          rect: { x: 0, y: 40, width: 180, height: 24 },
          isVisible: true,
          isDisabled: false,
        },
      ],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-form",
      "Filled Caller with Joe Employee.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).completedResult).toBeNull();
    expect((agent as any).doneRejections).toBe(1);
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();

    const messages = (agent as any).context.getMessages();
    const toolMessages = messages.filter(
      (message: any) => message.role === "tool",
    );
    const rejectionMessage = toolMessages[toolMessages.length - 1];
    expect(rejectionMessage).toMatchObject({
      tool_call_id: "done-call-form",
      content: expect.stringContaining("Verify the current form state"),
    });
    expect(String(rejectionMessage.content)).not.toContain("selected options");
  });

  test("done rejects missing multi-return coverage through kernel preflight", async () => {
    const recordEvent = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery =
      "From this page, tell me both numbers for Warehouse Gamma and Warehouse Alpha.";
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: true,
      reason: "planner should not be reached",
    }));

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-multi-return",
      "Warehouse Gamma inventory count is 6,412 units.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).completedResult).toBeNull();
    expect((agent as any).doneRejections).toBe(1);
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "done_rejected_incomplete_multi_return",
      expect.objectContaining({
        reason: expect.stringContaining("warehouse alpha"),
      }),
    );

    const messages = (agent as any).context.getMessages();
    expect(messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "done-call-multi-return",
      content: expect.stringContaining("Return all requested results"),
    });
  });

  test("done rejects incomplete task-contract obligations through kernel preflight", async () => {
    const recordEvent = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery =
      "Open Warehouse Gamma, then use go_back twice to return to Warehouse Alpha before calling done.";
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: true,
      reason: "planner should not be reached",
    }));
    (agent as any).context.setSnapshot({
      title: "Warehouse Gamma",
      url: "https://shop.example.com/warehouse/gamma",
      visibleContent: "Warehouse Gamma inventory count: 6,412 units",
      pageContent: "Warehouse Gamma inventory count: 6,412 units",
      elements: [],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-task-contract",
      "Opened Warehouse Gamma successfully.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).completedResult).toBeNull();
    expect((agent as any).doneRejections).toBe(1);
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "done_rejected_task_contract",
      expect.objectContaining({
        reason: expect.stringContaining("warehouse alpha"),
        missingReturnTarget: true,
      }),
    );

    const messages = (agent as any).context.getMessages();
    expect(messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "done-call-task-contract",
      content: expect.stringContaining("Complete the missing task obligations"),
    });
  });

  test("repeated done rejection reports consolidated outstanding issues", async () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery =
      "Open Warehouse Gamma, then use go_back twice to return to Warehouse Alpha before calling done.";
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: true,
      reason: "planner should not be reached",
    }));
    (agent as any).context.setSnapshot({
      title: "Warehouse Gamma",
      url: "https://shop.example.com/warehouse/gamma",
      visibleContent: "Warehouse Gamma inventory count: 6,412 units",
      pageContent: "Warehouse Gamma inventory count: 6,412 units",
      elements: [],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    await (agent as any).handleDoneToolCall(
      "done-call-task-contract-1",
      "Opened Warehouse Gamma successfully.",
      123,
    );
    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-task-contract-2",
      "Opened Warehouse Gamma successfully.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).doneRejections).toBe(2);
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    const messages = (agent as any).context.getMessages();
    expect(messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "done-call-task-contract-2",
      content: expect.stringContaining("done() REJECTED (attempt 2/"),
    });
    expect(String(messages.at(-1)?.content)).toContain("Outstanding:");
    expect(String(messages.at(-1)?.content)).toContain("task contract:");
    expect(String(messages.at(-1)?.content).toLowerCase()).toContain(
      "warehouse alpha",
    );
  });

  test("done rejects incomplete list-detail review through kernel preflight", async () => {
    const recordEvent = vi.fn();
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
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery =
      "Review the job listings and tell me which ones are the best matches for my profile and why.";
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: true,
      reason: "planner should not be reached",
    }));
    (agent as any).listDetailWorkflow.listDetailReviewedTargets = new Set(["frontend engineer"]);
    (agent as any).context.setSnapshot({
      title: "Job Listings",
      url: "https://jobs.example.test/listings",
      visibleContent:
        "View details for Frontend Engineer. View details for Backend Engineer. View details for Data Analyst.",
      pageContent:
        "View details for Frontend Engineer. View details for Backend Engineer. View details for Data Analyst.",
      elements: [
        {
          tag: 101,
          tagName: "button",
          role: "button",
          text: "View details for Frontend Engineer",
          attributes: {},
          rect: { x: 0, y: 10, width: 200, height: 24 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 102,
          tagName: "button",
          role: "button",
          text: "View details for Backend Engineer",
          attributes: {},
          rect: { x: 0, y: 40, width: 200, height: 24 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 103,
          tagName: "button",
          role: "button",
          text: "View details for Data Analyst",
          attributes: {},
          rect: { x: 0, y: 70, width: 200, height: 24 },
          isVisible: true,
          isDisabled: false,
        },
      ],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-list-detail",
      "Reviewed the listings and selected the best matches.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).completedResult).toBeNull();
    expect((agent as any).doneRejections).toBe(1);
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "done_rejected_list_detail_incomplete",
      expect.objectContaining({
        reviewedDetailCount: 1,
        visibleDetailActionCount: 3,
      }),
    );

    const messages = (agent as any).context.getMessages();
    expect(messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "done-call-list-detail",
      content: expect.stringContaining(
        "Do NOT synthesize the recommendation from list-card snippets alone.",
      ),
    });
  });

  test("done rejects interim workflow completion through kernel preflight", async () => {
    const recordEvent = vi.fn();
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        selectedSkillId: "chart-value-extraction",
      },
    );
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery =
      "Tell me the value shown in the incident chart.";
    (agent as any).hasReadPage = true;
    (agent as any).hasExplicitPageRead = true;
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: true,
      reason: "planner should not be reached",
    }));
    (agent as any).context.setSnapshot({
      title: "Incident Chart",
      url: "https://example.test/incidents/chart",
      visibleContent: "Incident chart with critical incidents.",
      pageContent: "Incident chart with critical incidents.",
      elements: [],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-workflow",
      "The incident chart page is open and visible.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).completedResult).toBeNull();
    expect((agent as any).doneRejections).toBe(1);
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "done_rejected_workflow_contract",
      expect.objectContaining({
        selectedSkillId: "chart-value-extraction",
        reason: expect.stringContaining("concrete extracted value"),
      }),
    );

    const messages = (agent as any).context.getMessages();
    expect(messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "done-call-workflow",
      content: expect.stringContaining(
        "Continue the workflow, verify the requested final state",
      ),
    });
  });

  test("done rejects ungrounded page-read completion through kernel preflight", async () => {
    const recordEvent = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery =
      "Summarize this page and report the key points.";
    (agent as any).hasReadPage = false;
    (agent as any).hasExplicitPageRead = false;
    (agent as any).forceGroundingRefresh = vi.fn(async () => undefined);
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: true,
      reason: "planner should not be reached",
    }));
    (agent as any).context.setSnapshot({
      title: "Transformer Architecture",
      url: "https://example.test/transformers",
      visibleContent:
        "The Transformer architecture uses attention mechanisms, encoder and decoder layers, positional encodings, residual connections, and feed-forward networks to process sequences efficiently.",
      pageContent:
        "The Transformer architecture uses attention mechanisms, encoder and decoder layers, positional encodings, residual connections, and feed-forward networks to process sequences efficiently.",
      elements: Array.from({ length: 6 }, (_, index) => ({
        tag: 200 + index,
        tagName: "section",
        role: "region",
        text: `Transformer section ${index + 1}`,
        attributes: {},
        rect: { x: 0, y: index * 30, width: 300, height: 24 },
        isVisible: true,
        isDisabled: false,
      })),
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-grounding",
      "The page provides a helpful overview with several important points and examples.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).completedResult).toBeNull();
    expect((agent as any).doneRejections).toBe(0);
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    expect((agent as any).forceGroundingRefresh).toHaveBeenCalledWith(
      123,
      "done_before_grounding_read",
    );
    expect(recordEvent).toHaveBeenCalledWith(
      "done_rejected_no_read",
      expect.objectContaining({
        turn: 0,
        elementCount: 6,
      }),
    );

    const messages = (agent as any).context.getMessages();
    expect(messages.at(-2)).toMatchObject({
      role: "tool",
      tool_call_id: "done-call-grounding",
      content: expect.stringContaining("Call read_page first"),
    });
    expect(messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("refreshed for grounding"),
    });
  });

  test("done rejects early multi-step completion through kernel preflight", async () => {
    const recordEvent = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery =
      "1. Open the account.\n2. Update the status.\n3. Verify the saved result.";
    (agent as any).hasReadPage = true;
    (agent as any).turnCount = 3;
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: true,
      reason: "planner should not be reached",
    }));

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-early-multistep",
      "All three requested steps are complete.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).completedResult).toBeNull();
    expect((agent as any).doneRejections).toBe(1);
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "done_rejected_early_multistep",
      {
        turn: 3,
        stepCount: 3,
      },
    );
    expect((agent as any).context.getMessages().at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "done-call-early-multistep",
      content: expect.stringContaining("The task has 3 steps"),
    });
  });

  test("done rejects incomplete money-table aggregate through kernel preflight", async () => {
    const recordEvent = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery =
      "Review the employee directory and tell me which employee has the highest salary and what that salary is.";
    (agent as any).hasReadPage = true;
    (agent as any).turnCount = 4;
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: true,
      reason: "planner should not be reached",
    }));
    (agent as any).moneyTable.updateMoneyTableAggregate(
      "Page content: Employee Directory 10 employees, 5 per page. # Name Email Department Salary 1 Alice Smith alice.smith@company.com Engineering $55,000 2 Bob Johnson bob.johnson@company.com Sales $56,731 3 Cara Lopez cara.lopez@company.com HR $58,000 4 Dan Miller dan.miller@company.com Finance $59,000 5 Eva Moore eva.moore@company.com Legal $60,000 Showing 1 - 5 of 10 Page 1 of 2",
    );

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-money-table",
      "The highest salary is Eva Moore at $60,000.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).completedResult).toBeNull();
    expect((agent as any).doneRejections).toBe(1);
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "done_rejected_incomplete_money_table_scan",
      expect.objectContaining({
        turn: 4,
        reason: expect.stringContaining("not exhaustive"),
      }),
    );
    expect((agent as any).context.getMessages().at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "done-call-money-table",
      content: expect.stringContaining("scan is exhaustive"),
    });
  });

  test("done rejects pending autocomplete through kernel preflight", async () => {
    const recordEvent = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).traceRecorder = { recordEvent };
    (agent as any).originalQuery =
      "Search for Laptop Stand in the product autocomplete field.";
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: true,
      reason: "planner should not be reached",
    }));
    (agent as any).context.setSnapshot({
      title: "Product Search",
      url: "https://example.test/products",
      visibleContent: "Product autocomplete suggestions Laptop Stand",
      pageContent: "Product autocomplete suggestions Laptop Stand",
      elements: [
        {
          tag: 201,
          tagName: "input",
          role: "combobox",
          text: "Laptop Stand",
          attributes: {
            id: "product-search",
            name: "product-search",
            value: "Laptop Stand",
            label: "Product Search",
            "aria-autocomplete": "list",
          },
          rect: { x: 0, y: 40, width: 180, height: 24 },
          isVisible: true,
          isDisabled: false,
        },
        {
          tag: 202,
          tagName: "li",
          role: "option",
          text: "Laptop Stand",
          attributes: { id: "product-option-laptop-stand" },
          rect: { x: 0, y: 60, width: 180, height: 24 },
          isVisible: true,
          isDisabled: false,
        },
      ],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-call-autocomplete",
      "The product search field contains Laptop Stand.",
      123,
    );

    expect(accepted).toBe(false);
    expect((agent as any).completedResult).toBeNull();
    expect((agent as any).doneRejections).toBe(1);
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "done_rejected_autocomplete_suggestion_pending",
      expect.objectContaining({
        inputTag: 201,
        suggestionTag: 202,
        value: "laptop stand",
      }),
    );

    const messages = (agent as any).context.getMessages();
    expect(messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "done-call-autocomplete",
      content: expect.stringContaining('click_element({"id": 202})'),
    });
  });

  test("submit-form reset completion creates a trusted_tool completion envelope", () => {
    const onMessage = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage,
      onStep: vi.fn(),
    });
    setPlanContext(agent, {
      subtasks: [
        {
          description: "Submit the completed form",
          status: "running",
        },
      ],
      planSteps: [
        {
          objective: "Submit the completed form",
          successCriteria: "A fresh record form is visible after submit",
        },
      ],
      snapshotText: "New record INC0034275",
    });

    const trustedCompletion = (agent as any).completeSubmitFormReset(0, {
      reason:
        "Submit advanced from populated record INC0034274 to fresh record form INC0034275; treating the prior record submission as complete.",
      previousRecordId: "INC0034274",
      currentRecordId: "INC0034275",
      filledFieldsBeforeSubmit: 3,
    });

    expect(trustedCompletion).toMatchObject({
      finalSummary: expect.stringContaining("INC0034274"),
      completionCandidate: {
        contractKind: "workflow_confirmation",
        decisionReason: expect.stringContaining("form submit reset"),
        evidence: [
          expect.objectContaining({
            type: "confirmation_state",
            confidence: "high",
            logicalKey: expect.stringContaining(
              "trusted:form-submit-reset:confirmation:inc0034274",
            ),
            detail: expect.objectContaining({
              source: "trusted_workflow",
              recordId: "INC0034274",
              targetText: "INC0034274",
            }),
          }),
        ],
      },
    });

    (agent as any).completeTaskResult(trustedCompletion.finalSummary, {
      completionCandidate: trustedCompletion.completionCandidate,
      saveCheckpoint: false,
    });

    expect((agent as any).completedResult).toMatchObject({
      outcome: "completed",
      summary: trustedCompletion.finalSummary,
      completionEnvelope: {
        status: "completed",
        source: "trusted_tool",
        contractKind: "workflow_confirmation",
        decisionReason: expect.stringContaining("form submit reset"),
        evidenceKeys: expect.arrayContaining([
          expect.stringContaining(
            "trusted:form-submit-reset:confirmation:inc0034274",
          ),
        ]),
      },
    });
    expect(onMessage).toHaveBeenCalledWith(trustedCompletion.finalSummary, []);
  });

  test("direct non-candidate completion is trace-visible without trusted envelope", () => {
    const recordEvent = vi.fn();
    const onMessage = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage,
      onStep: vi.fn(),
    });
    (agent as any).traceRecorder = { recordEvent };

    (agent as any).completeTaskResult("The requested field is unavailable.", {
      saveCheckpoint: false,
    });

    expect((agent as any).completedResult).toEqual({
      outcome: "completed",
      summary: "The requested field is unavailable.",
    });
    expect(recordEvent).toHaveBeenCalledWith(
      "completion_state_transition",
      expect.objectContaining({
        from: "working",
        to: "completed",
        source: "direct_completion",
      }),
    );
    expect(recordEvent).not.toHaveBeenCalledWith(
      "completion_candidate",
      expect.anything(),
    );
    expect(recordEvent).not.toHaveBeenCalledWith(
      "completion_envelope_created",
      expect.anything(),
    );
    expect(onMessage).toHaveBeenCalledWith(
      "The requested field is unavailable.",
      [],
    );
  });

  test("deterministic done accepts explicit-url navigation completion", async () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery =
      "Open https://docs.example.test/getting-started";
    (agent as any).hasReadPage = true;
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: false,
      reason: "navigation should not require planner validation",
    }));
    (agent as any).context.setSnapshot({
      title: "Documentation",
      url: "https://docs.example.test/getting-started",
      visibleContent: "Documentation Getting started",
      pageContent: "Documentation Getting started",
      elements: [],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-navigation",
      "Opened https://docs.example.test/getting-started.",
      123,
    );

    expect(accepted).toBe(true);
    expect((agent as any).completedResult).toMatchObject({
      outcome: "completed",
      completionEnvelope: {
        status: "completed",
        source: "model_done",
        contractKind: "navigation",
        evidenceKeys: expect.arrayContaining([
          expect.stringContaining("navigation:page:docs-example-test"),
        ]),
      },
    });
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
  });

  test("deterministic done accepts visible workflow confirmation", async () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery = "Delete the account and confirm it is gone.";
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: false,
      reason: "workflow confirmation should not require planner validation",
    }));
    (agent as any).context.setSnapshot({
      title: "Account Settings",
      url: "https://example.test/account",
      visibleContent: "Account deleted successfully.",
      pageContent: "Account deleted successfully.",
      elements: [],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-workflow",
      "Deleted the account successfully.",
      123,
    );

    expect(accepted).toBe(true);
    expect((agent as any).completedResult).toMatchObject({
      outcome: "completed",
      completionEnvelope: {
        status: "completed",
        source: "model_done",
        contractKind: "workflow_confirmation",
        evidenceKeys: expect.arrayContaining([
          "workflow:confirmation:delete",
        ]),
      },
    });
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
  });

  test("deterministic done accepts visible unsent draft completion", async () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery =
      "Read David's email and draft a short reply in the reply box. Don't click send.";
    (agent as any).hasReadPage = true;
    (agent as any).planner.validateDone = vi.fn(async () => ({
      approved: false,
      reason: "draft-only deterministic acceptance should bypass planner",
    }));
    (agent as any).context.setSnapshot({
      title: "Email thread",
      url: "https://mail.example.test/thread/123",
      visibleContent: "Email thread Reply message",
      pageContent: "Email thread Reply message",
      elements: [
        {
          tag: 301,
          tagName: "textarea",
          role: "textbox",
          text: "Hi David, Monday at 2 PM works for me.",
          attributes: {
            id: "reply-message",
            name: "reply-message",
            label: "Reply message",
            value: "Hi David, Monday at 2 PM works for me.",
          },
          rect: { x: 0, y: 0, width: 320, height: 120 },
          isVisible: true,
          isDisabled: false,
        },
      ],
      viewport: { width: 1280, height: 720 },
      scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    });

    const accepted = await (agent as any).handleDoneToolCall(
      "done-draft-only",
      "Drafted the reply and left it unsent in the editor.",
      123,
    );

    expect(accepted).toBe(true);
    expect((agent as any).completedResult).toMatchObject({
      outcome: "completed",
      completionEnvelope: {
        status: "completed",
        source: "model_done",
        contractKind: "draft_only",
        evidenceKeys: expect.arrayContaining([
          expect.stringContaining("draft:reply-message"),
        ]),
      },
    });
    expect((agent as any).planner.validateDone).not.toHaveBeenCalled();
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

    const ranked = agent.skillTools.applySkillToolRanking(tools);
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

    const ranked = agent.skillTools.applySkillToolRanking(tools);
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
        selectedSkillId: "multi-tab-checklist-workflow",
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

    agent.mutationReplay.recordMutationSensitiveAction(
      ToolName.CLICK_ELEMENT,
      { id: 45 },
      'Clicked [45] button "Back to Listings"',
    );

    expect(
      agent.mutationReplay.replayMutationSensitiveAction(
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

    agent.mutationReplay.recordMutationSensitiveAction(
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
      agent.mutationReplay.replayMutationSensitiveAction(
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

    agent.mutationReplay.recordMutationSensitiveAction(
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
      agent.mutationReplay.replayMutationSensitiveAction(
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

    agent.mutationReplay.recordMutationSensitiveAction(
      ToolName.CLICK_ELEMENT,
      { id: 41 },
      'Clicked [41] button "Submit"',
    );

    expect(
      agent.mutationReplay.replayMutationSensitiveAction(
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
    agent.mutationReplay.recordMutationSensitiveAction(
      ToolName.CLICK_ELEMENT,
      { id: 41 },
      'Clicked [41] button "3"',
    );
    (agent as any).context.setSnapshot({
      ...page2Snapshot,
      timestamp: Date.now() + 1,
    });

    expect(
      agent.mutationReplay.replayMutationSensitiveAction(
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

  test("preserves highest salary aggregate state across paginated read_page results", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery =
      "Review the employee directory and tell me which employee has the highest salary and what that salary is.";

    const firstNote = (agent as any).moneyTable
      .updateMoneyTableAggregate(`Page: Employee Directory

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

    const laterNote = (agent as any).moneyTable
      .updateMoneyTableAggregate(`Page: Employee Directory

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

  test("updates highest salary aggregate state from the current snapshot", () => {
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

    (agent as any).moneyTable.updateMoneyTableAggregateFromSnapshot();

    expect((agent as any).context.getWorkingNotes()).toContain("Frank Garcia");
    expect((agent as any).context.getWorkingNotes()).toContain(
      "rows read 5/50",
    );
  });

  test("extracts highest salary aggregate from compact read_page table text", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery =
      "Review the employee directory and tell me which employee has the highest salary and what that salary is.";

    const note = (agent as any).moneyTable.updateMoneyTableAggregate(
      "Page content: Employee Directory 50 employees, 5 per page. # Name Email Department Salary 46 Yara Nelson yara.nelson@company.com Engineering $122,000 47 Omar Hall omar.hall@company.com Support $98,100 Showing 46 - 50 of 50 Page 10 of 10",
    );

    expect(note).toContain("Yara Nelson");
    expect(note).toContain("$122,000");
    expect((agent as any).context.getWorkingNotes()).toContain(
      "seen rows 46-50/50",
    );
  });

  test("rejects completed money table answer that conflicts with tracked aggregate", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });
    (agent as any).originalQuery =
      "Review the employee directory and tell me which employee has the highest salary and what that salary is.";
    (agent as any).moneyTable.updateMoneyTableAggregate(
      "Page content: Employee Directory 10 employees, 5 per page. # Name Email Department Salary 1 Alice Smith alice.smith@company.com Engineering $55,000 2 Bob Johnson bob.johnson@company.com Sales $56,731 3 Cara Lopez cara.lopez@company.com HR $58,000 4 Dan Miller dan.miller@company.com Finance $59,000 5 Eva Moore eva.moore@company.com Legal $60,000 Showing 1 - 5 of 10 Page 1 of 2",
    );
    (agent as any).moneyTable.updateMoneyTableAggregate(
      "Page content: Employee Directory 10 employees, 5 per page. # Name Email Department Salary 6 Frank Garcia frank.garcia@company.com Operations $63,655 7 Yara Nelson yara.nelson@company.com Engineering $122,000 8 Omar Hall omar.hall@company.com Support $98,100 9 Ivy Stone ivy.stone@company.com Sales $99,000 10 Jack King jack.king@company.com Sales $100,000 Showing 6 - 10 of 10 Page 2 of 2",
    );

    const rejection = (
      agent as any
    ).moneyTable.getIncorrectMoneyTableAggregateDoneRejection(
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
    (agent as any).moneyTable.updateMoneyTableAggregate(
      "Page content: Employee Directory 10 employees, 5 per page. # Name Email Department Salary 1 Alice Smith alice.smith@company.com Engineering $55,000 2 Bob Johnson bob.johnson@company.com Sales $56,731 3 Cara Lopez cara.lopez@company.com HR $58,000 4 Dan Miller dan.miller@company.com Finance $59,000 5 Eva Moore eva.moore@company.com Legal $60,000 Showing 1 - 5 of 10 Page 1 of 2",
    );
    (agent as any).moneyTable.updateMoneyTableAggregate(
      "Page content: Employee Directory 10 employees, 5 per page. # Name Email Department Salary 6 Frank Garcia frank.garcia@company.com Operations $63,655 7 Yara Nelson yara.nelson@company.com Engineering $122,000 8 Omar Hall omar.hall@company.com Support $98,100 9 Ivy Stone ivy.stone@company.com Sales $99,000 10 Jack King jack.king@company.com Sales $100,000 Showing 6 - 10 of 10 Page 2 of 2",
    );

    expect(
      (agent as any).moneyTable.isCompletedMoneyTableAggregateSummary(
        "The highest salary is Yara Nelson at $122,000.",
      ),
    ).toBe(true);
    expect(
      (agent as any).moneyTable.isCompletedMoneyTableAggregateSummary(
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
              style:
                "background-color: rgb(37, 99, 235); color: rgb(255, 255, 255);",
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
              style:
                "background-color: rgb(37, 99, 235); color: rgb(255, 255, 255);",
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

    (agent as any).listDetailWorkflow.trackListDetailToolSuccess(
      ToolName.CLICK_ELEMENT,
      { id: 35 },
      listSnapshot,
    );

    expect((agent as any).listDetailWorkflow.listDetailOpenedTargets.size).toBe(1);
    expect((agent as any).listDetailWorkflow.listDetailReviewedTargets.size).toBe(0);

    (agent as any).listDetailWorkflow.trackListDetailToolSuccess(
      ToolName.READ_PAGE,
      {},
      detailSnapshot,
    );

    expect((agent as any).listDetailWorkflow.listDetailOpenedTargets.size).toBe(1);
    expect((agent as any).listDetailWorkflow.listDetailReviewedTargets.size).toBe(1);
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

    (agent as any).listDetailWorkflow.trackListDetailToolSuccess(
      ToolName.CLICK_ELEMENT,
      { id: 35 },
      listSnapshot,
    );
    (agent as any).listDetailWorkflow.trackListDetailToolSuccess(
      ToolName.READ_PAGE,
      {},
      listSnapshot,
    );

    expect((agent as any).listDetailWorkflow.listDetailOpenedTargets.size).toBe(1);
    expect((agent as any).listDetailWorkflow.listDetailReviewedTargets.size).toBe(0);
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
    (agent as any).listDetailWorkflow.listDetailVisibleActionCount = 3;
    (agent as any).listDetailWorkflow.listDetailReviewedTargets = new Set([
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

    const redirected = (agent as any).listDetailWorkflow.rewriteListDetailWorkflowToolCall(
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
    (agent as any).listDetailWorkflow.listDetailVisibleActionCount = 10;
    (agent as any).listDetailWorkflow.listDetailCurrentTarget = "full stack engineer at datapulse";
    (agent as any).listDetailWorkflow.listDetailOpenedTargets = new Set([
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

    const redirected = (agent as any).listDetailWorkflow.rewriteListDetailWorkflowToolCall(
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
    (agent as any).listDetailWorkflow.listDetailVisibleActionCount = 10;
    (agent as any).listDetailWorkflow.listDetailCurrentTarget =
      "frontend developer at startupgrid";
    (agent as any).listDetailWorkflow.listDetailOpenedTargets = new Set([
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

    const redirected = (agent as any).listDetailWorkflow.rewriteListDetailWorkflowToolCall(
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
    (agent as any).listDetailWorkflow.listDetailVisibleActionCount = 10;
    (agent as any).listDetailWorkflow.listDetailCurrentTarget =
      "frontend developer at startupgrid";
    (agent as any).listDetailWorkflow.listDetailReviewedTargets = new Set([
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

    const redirected = (agent as any).listDetailWorkflow.rewriteListDetailWorkflowToolCall(
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
    (agent as any).listDetailWorkflow.listDetailVisibleActionCount = 10;
    (agent as any).listDetailWorkflow.listDetailCurrentTarget = "full stack engineer at datapulse";
    (agent as any).listDetailWorkflow.listDetailReviewedTargets = new Set([
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

    const redirected = (agent as any).listDetailWorkflow.rewriteListDetailWorkflowToolCall(
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

    const replanned = await (agent as any).planRecovery.replanOnEscalation(123, []);

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
        selectedSkillId: "multi-tab-checklist-workflow",
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

    const replanned = await (agent as any).planRecovery.replanOnEscalation(123, []);

    expect(replanned).toBe(false);
    expect(replanFrom).not.toHaveBeenCalled();
    expect(recordEvent).toHaveBeenCalledWith(
      "plan_replan_skipped_skill_owned_loop",
      expect.objectContaining({
        skillId: "multi-tab-checklist-workflow",
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

    agent.skillTools.recordSkillToolSelection(ToolName.PRESS_KEY, "sequential");

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

    const newIdx = agent.planProgress.advanceCompletedSubtasks();
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
      {
        description: "Step 1",
        status: "completed",
        turnsUsed: 0,
        turnBudget: 0,
      },
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

    const result = evaluateTextAdmissionAdvanceGate(agent as unknown as TextAdmissionGateHost, {
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
      subtasks: [
        { description: "Report Warehouse Gamma count", status: "running" },
      ],
      planSteps: [
        { successCriteria: "Warehouse Gamma inventory count 6,412 visible" },
      ],
      snapshotText: "Warehouse Gamma inventory count: 6,412 units",
    });

    const result = evaluateTextAdmissionAdvanceGate(agent as unknown as TextAdmissionGateHost, {
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

    const result = evaluateTextAdmissionAdvanceGate(agent as unknown as TextAdmissionGateHost, {
      summary:
        "Unable to complete the Warehouse Gamma check even though the page changed.",
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

    const result = evaluateTextAdmissionAdvanceGate(agent as unknown as TextAdmissionGateHost, {
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

    const result = evaluateTextAdmissionAdvanceGate(agent as unknown as TextAdmissionGateHost, {
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
      subtasks: [
        {
          description: "Report Warehouse Gamma inventory count",
          status: "running",
        },
      ],
      planSteps: [
        { successCriteria: "Warehouse Gamma inventory count 6,412 visible" },
      ],
      snapshotText: "Warehouse Gamma inventory count: 6,412 units",
    });

    const result = evaluateTextAdmissionAdvanceGate(agent as unknown as TextAdmissionGateHost, {
      summary: "## Completed\nWarehouse Gamma inventory count is 6,412 units.",
      consecutiveTextOnly: 1,
    });

    expect(result.passed).toBe(true);
    expect(result.isLastStep).toBe(true);
  });

  test("final-step text admission nudges done instead of auto-completing", async () => {
    mockCompleteStream.mockReset();
    let callIdx = 0;
    mockCompleteStream.mockImplementation(
      (_request: any, onTextDelta: (delta: string) => void) => {
        callIdx++;
        if (callIdx <= 2) {
          const text =
            "## Completed\nWarehouse Gamma inventory count is 6,412 units.";
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
      },
    );

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

  test("done accepts planless completion and finalizes the UI", async () => {
    mockCompleteStream.mockReset();
    mockCompleteStream.mockImplementation(
      (_request: any, _onTextDelta: (delta: string) => void) =>
        Promise.resolve({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "tc_done_planless",
              type: "function",
              function: {
                name: "done",
                arguments: '{"summary":"Planless task is complete."}',
              },
            },
          ],
          finish_reason: "tool_calls",
        }),
    );

    const onStatus = vi.fn();
    const onMessage = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: onStatus,
      onMessage,
      onStep: vi.fn(),
    });
    (agent as any).hasReadPage = true;

    const result = await agent.start("Report that the task is complete", 123);

    expect(result.outcome).toBe("completed");
    expect(result.summary).toBe("Planless task is complete.");
    expect(result.completionEnvelope).toMatchObject({
      status: "completed",
      source: "model_done",
      contractKind: "legacy_done_guards",
      decisionReason: "legacy_done_guards_passed",
    });
    expect(onStatus).toHaveBeenCalledWith(AgentStatus.IDLE, "Done");
    expect(onMessage).toHaveBeenCalledWith("Planless task is complete.", []);
  });

  test("done accepts completed plan when planner validation approves", async () => {
    mockCompleteStream.mockReset();
    mockCompleteStream.mockImplementation(
      (_request: any, _onTextDelta: (delta: string) => void) =>
        Promise.resolve({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "tc_done_completed_plan",
              type: "function",
              function: {
                name: "done",
                arguments:
                  '{"summary":"Warehouse Gamma inventory count is 6,412 units."}',
              },
            },
          ],
          finish_reason: "tool_calls",
        }),
    );

    const onStatus = vi.fn();
    const onMessage = vi.fn();
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: onStatus,
        onMessage,
        onStep: vi.fn(),
      },
      {
        taskId: "task-done-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description: "Report Warehouse Gamma count",
              status: "completed",
            },
          ],
        },
      },
    );
    (agent as any).hasReadPage = true;
    (agent as any).planner.validateDone = vi
      .fn()
      .mockResolvedValue({ approved: true, reason: "ok" });
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

    expect(result.outcome).toBe("completed");
    expect(result.summary).toBe(
      "Warehouse Gamma inventory count is 6,412 units.",
    );
    expect(onStatus).toHaveBeenCalledWith(AgentStatus.IDLE, "Done");
    expect(onMessage).toHaveBeenCalledWith(
      "Warehouse Gamma inventory count is 6,412 units.",
      [],
    );
  });

  test("done rejects completed plan when planner validation rejects", async () => {
    mockCompleteStream.mockReset();
    mockCompleteStream.mockImplementation(
      (_request: any, _onTextDelta: (delta: string) => void) =>
        Promise.resolve({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "tc_done_rejected_plan",
              type: "function",
              function: {
                name: "done",
                arguments:
                  '{"summary":"Warehouse Gamma inventory count is 6,412 units."}',
              },
            },
          ],
          finish_reason: "tool_calls",
        }),
    );

    const onMessage = vi.fn();
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage,
        onStep: vi.fn(),
      },
      {
        taskId: "task-done-reject-1",
        initialPlanState: {
          currentIndex: 0,
          subtasks: [
            {
              description: "Report Warehouse Gamma count",
              status: "completed",
            },
          ],
        },
      },
    );
    (agent as any).hasReadPage = true;
    const validateDone = vi
      .fn()
      .mockResolvedValue({ approved: false, reason: "Need more evidence." });
    (agent as any).planner.validateDone = validateDone;
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

    expect(validateDone).toHaveBeenCalled();
    expect(result.outcome).not.toBe("error");
    expect(result.outcome).not.toBe("completed");
    expect((agent as any).doneRejections).toBeGreaterThan(0);
    expect(onMessage).not.toHaveBeenCalledWith(
      "Warehouse Gamma inventory count is 6,412 units.",
      [],
    );
  });

  test("done rejects incomplete plan when planner validation is unavailable", async () => {
    mockCompleteStream.mockReset();
    mockCompleteStream.mockImplementation(
      (_request: any, _onTextDelta: (delta: string) => void) =>
        Promise.resolve({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "tc_done_planner_unavailable",
              type: "function",
              function: {
                name: "done",
                arguments: '{"summary":"The final step is complete."}',
              },
            },
          ],
          finish_reason: "tool_calls",
        }),
    );

    const onMessage = vi.fn();
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage,
        onStep: vi.fn(),
      },
      {
        taskId: "task-done-reject-2",
        initialPlanState: {
          currentIndex: 1,
          subtasks: [
            {
              description: "Open the warehouse page",
              status: "pending",
            },
            {
              description: "Report the warehouse count",
              status: "running",
            },
          ],
        },
      },
    );
    (agent as any).hasReadPage = true;
    const validateDone = vi.fn().mockRejectedValue(new Error("planner down"));
    (agent as any).planner.validateDone = validateDone;
    (agent as any).planSteps = [
      { successCriteria: "Warehouse page opened" },
      { successCriteria: "Warehouse count reported" },
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

    expect(validateDone).toHaveBeenCalled();
    expect(result.outcome).not.toBe("completed");
    expect((agent as any).doneRejections).toBeGreaterThan(0);
    expect(onMessage).not.toHaveBeenCalledWith(
      "The final step is complete.",
      [],
    );
  });

  test("done hard gate blocks repeated done after max rejections", async () => {
    mockCompleteStream.mockReset();
    mockCompleteStream.mockImplementation(
      (_request: any, _onTextDelta: (delta: string) => void) =>
        Promise.resolve({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "tc_done_hard_gate",
              type: "function",
              function: {
                name: "done",
                arguments: '{"summary":"Trying to finish too early."}',
              },
            },
          ],
          finish_reason: "tool_calls",
        }),
    );

    const onMessage = vi.fn();
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage,
      onStep: vi.fn(),
    });
    (agent as any).limits.maxDoneRejections = 0;
    (agent as any).hasReadPage = true;

    const result = await agent.start("Try to finish repeatedly", 123);
    const messages = (agent as any).context.getMessages();

    expect(result.outcome).not.toBe("completed");
    expect(
      messages.some((message: any) =>
        String(message.content).includes("done() BLOCKED"),
      ),
    ).toBe(true);
    expect(onMessage).not.toHaveBeenCalledWith(
      "Trying to finish too early.",
      [],
    );
  });

  test("bypasses stale plan rejection for satisfied spreadsheet edit tasks", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        {
          description: "Update the Q1 Sales cell in row 1 to 999",
          status: "running",
        },
        {
          description: "Clear the previous cell value if needed",
          status: "pending",
        },
      ],
      planSteps: [
        {
          successCriteria:
            "Spreadsheet shows Q1 Sales value 999 in the first row",
        },
        {
          successCriteria: "Old value is no longer present in the edited cell",
        },
      ],
      snapshotText:
        "Spreadsheet row 1 Q1 Sales value 999 is visible in the edited cell.",
    });
    (agent as any).originalQuery =
      "In the spreadsheet, change the Q1 Sales value in the first row to 999.";

    const result = shouldBypassPlanIncompleteDoneRejection(agent as unknown as DonePlanValidationHost, {
      summary:
        "Updated the spreadsheet so the first-row Q1 Sales cell now shows 999.",
      currentStepIndex: 0,
    });

    expect(result).toBe(true);
  });

  test("bypasses stale plan rejection for grounded orchestrator node completion", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {
        nodeId: "node-1",
        taskId: "task-1",
      },
    );

    setPlanContext(agent, {
      subtasks: [
        {
          description:
            "Click the application navigator menu to access applications and modules",
          status: "running",
        },
        {
          description: "Search for or locate Configuration in the navigator",
          status: "pending",
        },
        {
          description: "Click Database Instances and HBase",
          status: "pending",
        },
      ],
      planSteps: [
        { successCriteria: "Application navigator menu is open" },
        { successCriteria: "Configuration appears in the navigator" },
        { successCriteria: "HBase Instances page is visible" },
      ],
      snapshotText:
        "Configuration Database Instances HBase Instances list showing 0 records. No records to display.",
    });
    (agent as any).originalQuery =
      'Navigate to the "Database Instances > HBase" module of the "Configuration" application.';

    const result = shouldBypassPlanIncompleteDoneRejection(agent as unknown as DonePlanValidationHost, {
      summary:
        "Successfully navigated to Configuration > Database Instances > HBase. The HBase Instances page displays no records.",
      currentStepIndex: 0,
    });

    expect(result).toBe(true);
  });

  test("does not treat a partially checked source list as completed work", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        { description: "Open the store in a new tab", status: "completed" },
        {
          description: "Switch to the newly opened store tab",
          status: "running",
        },
        {
          description: "Add the item to cart and place the order",
          status: "pending",
        },
      ],
      planSteps: [
        { successCriteria: "Store tab opened" },
        { successCriteria: "Store tab is active" },
        { successCriteria: "Order confirmation visible" },
      ],
      snapshotText:
        "Procurement List shows 1 of 3 items completed after returning from the store tab.",
    });
    (agent as any).selectedSkillId = "multi-tab-checklist-workflow";
    (agent as any).originalQuery =
      "Buy the first two items from the procurement list. Open each store in a new tab, purchase the item, then come back and check it off.";

    const result = shouldBypassPlanIncompleteDoneRejection(agent as unknown as DonePlanValidationHost, {
      summary:
        "Purchased the first procurement item, returned to the procurement list, and checked off the completed row.",
      currentStepIndex: 1,
    });

    expect(result).toBe(false);
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
        selectedSkillId: "multi-tab-checklist-workflow",
      },
    );
    (agent as any).originalQuery =
      "Buy the first two items from the procurement list and mark them complete.";

    expect(shouldBlockTabManagementTools({
      originalQuery: (agent as any).originalQuery,
      selectedSkillId: agent.selectedSkillId,
      planRequiresTabManagement: (agent as any).planRequiresTabManagement,
    })).toBe(false);
  });

  test("re-opens the tab-management gate when the plan later requires tabs (no session latch)", () => {
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
      },
      {},
    );
    // A generic query with no explicit tab phrasing and no skill: gate is closed.
    (agent as any).originalQuery = "Look at this page and tell me what it says.";
    expect(shouldBlockTabManagementTools({
      originalQuery: (agent as any).originalQuery,
      selectedSkillId: agent.selectedSkillId,
      planRequiresTabManagement: (agent as any).planRequiresTabManagement,
    })).toBe(true);

    // Once the planner declares multi-tab intent mid-run, the gate must re-open.
    // Blocking an earlier call must not have permanently disabled the tab tools.
    (agent as any).planRequiresTabManagement = true;
    expect(shouldBlockTabManagementTools({
      originalQuery: (agent as any).originalQuery,
      selectedSkillId: agent.selectedSkillId,
      planRequiresTabManagement: (agent as any).planRequiresTabManagement,
    })).toBe(false);
    expect((agent as any).disabledTools.size).toBe(0);
  });

  test("bypasses stale plan rejection when the page already shows final submission confirmation", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        {
          description: "Select Business for the category",
          status: "completed",
        },
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

    const result = shouldBypassPlanIncompleteDoneRejection(agent as unknown as DonePlanValidationHost, {
      summary:
        "Submitted the form successfully and reached the submission complete page with Bob's details and a reference number.",
      currentStepIndex: 1,
    });

    expect(result).toBe(true);
  });

  test("bypasses stale plan rejection when only a finalization step remains after destructive success", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        {
          description: "Confirm the account deletion and verify the result",
          status: "running",
        },
        {
          description:
            "Terminate task with success status since deletion is confirmed",
          status: "pending",
        },
      ],
      planSteps: [
        {
          successCriteria:
            "Confirmation button clicked, deletion success message or modal closure visible",
        },
        {
          successCriteria:
            "Task is finished after the deletion confirmation is visible",
        },
      ],
      snapshotText: "Account deleted successfully.",
    });
    (agent as any).originalQuery =
      "Dismiss the overlays, fill in the email, then delete the account and confirm it.";

    const result = shouldBypassPlanIncompleteDoneRejection(agent as unknown as DonePlanValidationHost, {
      summary:
        "Clicked Confirm Delete and verified the account was deleted successfully.",
      currentStepIndex: 0,
    });

    expect(result).toBe(true);
  });

  test("does not treat unfinished task-field work as a finalization step", () => {
    const agent = new AgentLoop("test-key", {
      onStatusUpdate: vi.fn(),
      onMessage: vi.fn(),
      onStep: vi.fn(),
    });

    setPlanContext(agent, {
      subtasks: [
        {
          description: "Complete the first form section",
          status: "running",
        },
        {
          description: "Finish populating the remaining task fields",
          status: "pending",
        },
      ],
      planSteps: [
        {
          successCriteria: "First form section completed successfully",
        },
        {
          successCriteria: "All remaining task fields are populated",
        },
      ],
      snapshotText: "First form section completed successfully.",
    });
    (agent as any).originalQuery =
      "Complete all form sections before submitting.";

    const result = shouldBypassPlanIncompleteDoneRejection(agent as unknown as DonePlanValidationHost, {
      summary: "Completed the first form section successfully.",
      currentStepIndex: 0,
    });

    expect(result).toBe(false);
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
        selectedSkillId: "multi-tab-checklist-workflow",
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
        selectedSkillId: "multi-tab-checklist-workflow",
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
        {
          description: "Update the Q1 Sales cell in row 1 to 999",
          status: "running",
        },
      ],
      planSteps: [
        {
          successCriteria:
            "Spreadsheet shows Q1 Sales value 999 in the first row",
        },
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
          attributes: {
            type: "text",
            value: "999",
            "aria-label": "Q1 Sales editor",
          },
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

    const result = agent.inlineEditVerification.getUncommittedInlineEditDoneRejection(0);

    expect(result).toContain("Commit the edit");
  });

  test("retargets inline-edit text entry from the cell tag to the active input", () => {
    const result = assessInlineEditTextEntryRetarget({
      activeToolProfile: "edit_surface",
      targetId: 37,
      snapshot: {
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
            attributes: {
              type: "text",
              value: "130",
              "aria-label": "Q1 Sales editor",
            },
          },
        ],
        pageContent:
          "Quarterly Sales spreadsheet. Row 1 Q1 Sales cell is in editing mode.",
        visibleContent:
          "Quarterly Sales spreadsheet. Row 1 Q1 Sales cell is in editing mode.",
        scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
        viewportHeight: 800,
        timestamp: Date.now(),
      },
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

    const mutationBlock = agent.inlineEditVerification.getPendingInlineEditVerificationBlock(
      ToolName.CLICK_ELEMENT,
      0,
    );
    expect(mutationBlock).toContain("Verify the committed page state");

    const readAllowed = agent.inlineEditVerification.getPendingInlineEditVerificationBlock(
      ToolName.READ_PAGE,
      0,
    );
    expect(readAllowed).toBeNull();

    const staleStep = agent.inlineEditVerification.getPendingInlineEditVerificationBlock(
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
    (chrome.runtime as any).sendMessage = vi.fn(async () => ({
      success: true,
    }));
  });

  test("short-circuits resumed terminal completion from turn checkpoint", async () => {
    const checkpoint: TurnCheckpoint = {
      version: TURN_CHECKPOINT_VERSION,
      workspaceId: "ws-1",
      nodeId: "node-done",
      savedAt: Date.now(),
      turnCount: 4,
      maxTurns: 10,
      currentPlanIndex: 0,
      turnsOnCurrentStep: 1,
      escalationsOnCurrentStep: 0,
      guardAfterDoneRejection: false,
      history: {
        recentMessages: [],
        olderSummaries: [],
        originalCount: 0,
      },
      planStatus: null,
      workingNotes: "",
      lastActionOutcome: null,
      modelTier: "executor",
      isFirstTurn: false,
      snapshotFingerprint: "https://example.com/quiz|0|123",
      pageUrl: "https://example.com/quiz",
      stepMutationLedger: [],
      sideEffectsLog: [],
      completedResult: {
        outcome: "completed",
        summary: "Selected the correct options.",
        completionEnvelope: {
          status: "completed",
          resultId: "completion-restored-1",
          source: "model_done",
          contractKind: "quiz_selection",
          decisionReason: "selected options match expected answers",
          evidenceKeys: ["quiz:question:32:selected:domain-adaptation"],
          evidenceEpoch: "turn:4",
        },
      },
    };
    const onMessage = vi.fn();
    const agent = new AgentLoop(
      "test-key",
      {
        onStatusUpdate: vi.fn(),
        onMessage,
        onStep: vi.fn(),
      },
      {
        workspaceId: "ws-1",
        nodeId: "node-done",
        turnCheckpoint: checkpoint,
      },
    );

    const result = await agent.start("Select the correct option/s", 123);

    expect(result).toMatchObject({
      outcome: "completed",
      turnCount: 4,
      summary: "Selected the correct options.",
      completionEnvelope: {
        resultId: "completion-restored-1",
        contractKind: "quiz_selection",
      },
    });
    expect(mockCompleteStream).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith("Selected the correct options.", []);
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

    const approvalRequests = (
      chrome.runtime.sendMessage as any
    ).mock.calls.filter((call: any[]) => call[0]?.type === "APPROVAL_REQUEST");
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

    const initialResult = await initialAgent.start(
      "Navigate to example.com",
      123,
    );
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
      makeToolCall("tc_nav_timeout", "navigate", {
        url: "https://example.com",
      }),
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

    const approvalRequests = (
      chrome.runtime.sendMessage as any
    ).mock.calls.filter((call: any[]) => call[0]?.type === "APPROVAL_REQUEST");
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
    const originalGet = chrome.tabs.get;
    const originalSendMessage = chrome.tabs.sendMessage;
    (chrome.tabs as any).get = vi.fn(async (id: number) => ({
      id,
      title: `Tab ${id}`,
      url: `https://example.com/${id}`,
      active: id === 123,
      groupId: 1,
    }));
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

    (chrome.tabs as any).get = originalGet;
    (chrome.tabs as any).sendMessage = originalSendMessage;
  });

  test("switch_tab rejects internal extension tabs in workspace", async () => {
    mockWorkspace(testWorkspace);

    const originalGet = chrome.tabs.get;
    const originalUpdate = chrome.tabs.update;
    (chrome.tabs as any).get = vi.fn(async (id: number) => ({
      id,
      title: id === 789 ? "E2E Helper" : `Tab ${id}`,
      url:
        id === 789
          ? "chrome-extension://abc123/e2e-helper.html"
          : `https://example.com/${id}`,
      active: id === 123,
      groupId: 1,
    }));
    const updateSpy = vi.fn();
    (chrome.tabs as any).update = updateSpy;

    setupLLMSequence([makeToolCall("tc_switch", "switch_tab", { tabId: 789 })]);

    const agent = createAgent("ws-1");
    await agent.start("Switch to tab 789", 123);

    const msgs = mockCompleteStream.mock.calls[1][0].messages;
    const toolResult = msgs.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_switch",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("Cannot switch to tab 789");
    expect(toolResult.content).toContain(
      "chrome-extension://abc123/e2e-helper.html",
    );
    expect(updateSpy).not.toHaveBeenCalled();

    (chrome.tabs as any).get = originalGet;
    (chrome.tabs as any).update = originalUpdate;
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

  test("list_tabs omits internal browser and extension tabs", async () => {
    mockWorkspace({
      ...testWorkspace,
      tabIds: [123, 789, 790],
    });

    const originalGet = chrome.tabs.get;
    (chrome.tabs as any).get = vi.fn(async (id: number) => ({
      id,
      title:
        id === 789 ? "E2E Helper" : id === 790 ? "Extensions" : `Tab ${id}`,
      url:
        id === 789
          ? "chrome-extension://abc123/e2e-helper.html"
          : id === 790
            ? "chrome://extensions"
            : `https://example.com/${id}`,
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
    expect(toolResult.content).not.toContain("Tab 789");
    expect(toolResult.content).not.toContain("Tab 790");
    expect(toolResult.content).toContain(
      "internal browser/extension tabs omitted",
    );

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

    const filtered = agent.skillTools.applyToolProfile(tools);
    expect(filtered).toHaveLength(tools.length); // all tools pass through
  });
});

describe("buildDomAwareProfile", () => {
  test("empty elements returns base set without extras", () => {
    const profile = buildDomAwareProfile([]);
    expect(profile.has(ToolName.CLICK_ELEMENT)).toBe(true);
    expect(profile.has(ToolName.TYPE_TEXT)).toBe(true);
    expect(profile.has(ToolName.DONE)).toBe(true);
    expect(profile.has(ToolName.SEARCH_KNOWLEDGE_BASE)).toBe(true);
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
