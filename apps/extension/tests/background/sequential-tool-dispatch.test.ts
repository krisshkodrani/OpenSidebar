import { describe, expect, test, vi } from "vitest";
import { RiskLevel, ToolCall, ToolName } from "../../src/types";
import {
  handleGenericSequentialToolCall,
  type AgentLoopToolHandlerHost,
  type GenericSequentialToolCallParams,
} from "../../src/background/agent/loop-tool-handlers";
import {
  executeSequentialToolCalls,
  type SequentialToolDispatchHost,
  type SequentialToolDispatchState,
} from "../../src/background/agent/sequential-tool-dispatch";
import { ToolResultCache } from "../../src/background/agent/tool-cache";

function toolCall(
  name: ToolName,
  args: Record<string, unknown> = {},
  id = `${name}-call`,
): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function baseState(
  overrides: Partial<SequentialToolDispatchState> = {},
): SequentialToolDispatchState {
  return {
    tabId: 1,
    prevElementCount: 0,
    escalationTier: 0,
    plannerModelStartTurn: 0,
    orientationPhase: false,
    recentToolCalls: [],
    verifiedFinalClickBypassKeys: new Set<string>(),
    lastReadElementId: null,
    consecutiveReadElementSameId: 0,
    blockedActions: [],
    recentSuccesses: [],
    discoveredTagIds: new Set<number>(),
    orientationToolsUsed: new Set<string>(),
    domModified: false,
    visuallyModified: false,
    lastDomAffectingToolName: null,
    doneSignaled: false,
    doneSummary: "",
    ...overrides,
  };
}

function createHost(): SequentialToolDispatchHost {
  return {
    context: {
      addMessage: vi.fn(),
      getCurrentUrl: () => "https://example.test",
      getMessages: () => [],
      getPlanStatusRaw: () => null,
      getSnapshot: () => null,
      getFieldReadLedger: () => new Map(),
    },
    disabledTools: new Set<ToolName>(),
    elementResolver: undefined,
    ensureToolApproval: vi.fn(async () => true),
    executeToolCall: vi.fn(),
    consecutiveAutoAdvances: 0,
    getActiveToolProfileForStep: () => null,
    getConsequentialActionTaskText: () => "finish the task",
    getPendingInlineEditVerificationBlock: () => null,
    getUncommittedInlineEditDoneRejection: () => null,
    getWorkflowTabToolRedirect: vi.fn(async () => null),
    hasExplicitPageRead: false,
    hasReadPage: false,
    handleClarifyToolCall: vi.fn(),
    handleDoneToolCall: vi.fn(async () => true),
    isRunning: true,
    lastDomStep: null,
    listDetailOpenedTargets: new Set<string>(),
    listDetailReviewedTargets: new Set<string>(),
    listDetailVisibleActionCount: 0,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    maxTurns: 10,
    maybeAdvanceTrustedFormFillStep: vi.fn(),
    maybeAutoSubmitTrustedServiceNowForm: vi.fn(async () => null),
    maybeCompleteTrustedFormSubmitStep: vi.fn(() => null),
    maybeCompleteTrustedListSortStep: vi.fn(() => null),
    maybeCompleteTrustedListFilterStep: vi.fn(() => null),
    maybeCompleteTrustedCatalogOrderSubmit: vi.fn(async () => null),
    maybeAutoSubmitConfiguredCatalogItem: vi.fn(async () => {}),
    middleware: {
      evaluatePreTool: (toolName: ToolName) => ({
        toolName,
        riskLevel: RiskLevel.LOW,
        allowed: true,
        requiresApproval: false,
        approvalMode: "none",
        approvalReason: "test",
      }),
      evaluatePostTool: vi.fn(),
    },
    originalQuery: "finish the task",
    pendingInlineEditVerification: null,
    planSubtasks: [],
    recordCompletionToolEvidence: vi.fn(),
    recordSkillToolSelection: vi.fn(),
    recordMutationSensitiveAction: vi.fn(),
    refreshPerceptionAndTriage: vi.fn(),
    refreshSnapshotWithRetry: vi.fn(async () => 0),
    requiresConsequentialActionApproval: vi.fn(() => false),
    replayMutationSensitiveAction: vi.fn(() => false),
    selectedSkillId: null,
    stepHandler: vi.fn(),
    throwIfGracefulStopRequested: vi.fn(),
    toolCache: new ToolResultCache(),
    trackListDetailToolSuccess: vi.fn(),
    traceRecorder: {
      recordEvent: vi.fn(),
      recordToolExecution: vi.fn(),
    },
    turnCount: 4,
    updateMoneyTableAggregate: vi.fn(() => null),
    workspaceId: null,
  } as unknown as SequentialToolDispatchHost;
}

function genericParams(
  name: ToolName,
  args: Record<string, unknown> = {},
): GenericSequentialToolCallParams {
  return {
    toolCall: toolCall(name, args),
    toolName: name,
    args,
    tabId: 1,
    prevElementCount: 0,
    autocompleteRewriteReason: null,
    discoveredTagIds: new Set<number>(),
    preDecision: {
      toolName: name,
      riskLevel: RiskLevel.LOW,
      allowed: true,
      requiresApproval: false,
      approvalMode: "none",
      approvalReason: "test",
    },
    llmIntention: null,
    currentStepIndex: 0,
    shouldArmInlineEditVerification: false,
    cacheType: undefined,
    orientationPhase: false,
    orientationToolsUsed: new Set<string>(),
    domModified: false,
    visuallyModified: false,
    lastDomAffectingToolName: null,
  };
}

describe("executeSequentialToolCalls", () => {
  test("accepts done tool calls and returns completion state", async () => {
    const host = createHost();
    const completed = vi.fn();

    const output = await executeSequentialToolCalls.call(host, {
      toolCalls: [toolCall(ToolName.DONE, { summary: "All set." })],
      repeatActionWindow: 20,
      llmIntention: null,
      signalCompletedResult: completed,
      state: baseState(),
    });

    expect(host.handleDoneToolCall).toHaveBeenCalledWith(
      "done-call",
      "All set.",
      1,
    );
    expect(output.doneSignaled).toBe(true);
    expect(output.doneSummary).toBe("All set.");
    expect(completed).not.toHaveBeenCalled();
  });

  test("skips queued tools when the lane is already complete", async () => {
    const host = createHost();
    const completed = vi.fn();

    const output = await executeSequentialToolCalls.call(host, {
      toolCalls: [toolCall(ToolName.CLICK_ELEMENT, { id: 42 })],
      repeatActionWindow: 20,
      llmIntention: null,
      signalCompletedResult: completed,
      state: baseState({
        doneSignaled: true,
        doneSummary: "Already complete.",
      }),
    });

    expect(host.executeToolCall).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
    expect(output.doneSignaled).toBe(true);
    expect(output.doneSummary).toBe("Already complete.");
    expect(host.traceRecorder?.recordEvent).toHaveBeenCalledWith(
      "sequential_tools_skipped_after_completion",
      expect.objectContaining({
        queuedToolCount: 1,
        mode: "sequential",
      }),
    );
  });

  test("stops queued tools in the same lane after accepted done", async () => {
    const host = createHost();
    const completed = vi.fn();

    const output = await executeSequentialToolCalls.call(host, {
      toolCalls: [
        toolCall(ToolName.DONE, { summary: "All set." }, "done-1"),
        toolCall(ToolName.CLICK_ELEMENT, { id: 42 }, "click-after-done"),
      ],
      repeatActionWindow: 20,
      llmIntention: null,
      signalCompletedResult: completed,
      state: baseState(),
    });

    expect(host.handleDoneToolCall).toHaveBeenCalledWith(
      "done-1",
      "All set.",
      1,
    );
    expect(host.executeToolCall).not.toHaveBeenCalled();
    expect(output.doneSignaled).toBe(true);
    expect(output.doneSummary).toBe("All set.");
    expect(completed).not.toHaveBeenCalled();
  });

  test("stops queued tools in the same lane after trusted completion", async () => {
    const host = createHost();
    const completed = vi.fn();
    (host.executeToolCall as any).mockResolvedValue("Clicked sort header.");
    (host.maybeCompleteTrustedListSortStep as any).mockReturnValue({
      finalSummary: "The list is sorted.",
    });

    const output = await executeSequentialToolCalls.call(host, {
      toolCalls: [
        toolCall(ToolName.CLICK_ELEMENT, { id: 1 }, "trusted-sort-click"),
        toolCall(ToolName.CLICK_ELEMENT, { id: 2 }, "click-after-trusted"),
      ],
      repeatActionWindow: 20,
      llmIntention: null,
      signalCompletedResult: completed,
      state: baseState(),
    });

    expect(host.executeToolCall).toHaveBeenCalledTimes(1);
    expect(host.maybeCompleteTrustedListSortStep).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: ToolName.CLICK_ELEMENT,
        toolResult: "Clicked sort header.",
        mode: "sequential",
      }),
    );
    expect(completed).toHaveBeenCalledWith("The list is sorted.", {
      completionCandidate: undefined,
    });
    expect(output.doneSignaled).toBe(true);
    expect(output.doneSummary).toBe("The list is sorted.");
  });

  test("attaches read_answer completion candidate for grounded knowledge answers", async () => {
    const host = createHost() as unknown as AgentLoopToolHandlerHost;
    host.selectedSkillId = "search-answer-extraction";
    host.originalQuery =
      'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."';
    (host.executeToolCall as any).mockResolvedValue(
      [
        "Knowledge base search result.",
        "Answer candidate: 100",
        "Evidence sentence: The average number of yearly hires is 100.",
      ].join("\n"),
    );

    const output = await handleGenericSequentialToolCall(
      host,
      genericParams(ToolName.SEARCH_KNOWLEDGE_BASE, { query: "hires" }),
    );

    expect(output.breakLoop).toBe(true);
    expect(output.completedSummary).toBe("100");
    expect(output.completionCandidate).toMatchObject({
      contractKind: "read_answer",
      decisionReason: expect.stringContaining(
        "grounded knowledge base search evidence",
      ),
      evidence: [
        expect.objectContaining({
          type: "answer_state",
          confidence: "high",
          logicalKey: expect.stringContaining(
            "trusted:search-answer-extraction:answer",
          ),
          detail: expect.objectContaining({
            answer: "100",
            source: "knowledge_base_search",
          }),
        }),
      ],
    });
  });

  test("attaches read_answer completion candidate for knowledge page reads", async () => {
    const host = createHost() as unknown as AgentLoopToolHandlerHost;
    host.selectedSkillId = "search-answer-extraction";
    host.originalQuery =
      'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."';
    (host.executeToolCall as any).mockResolvedValue(
      [
        "Page: Knowledge Article",
        "The average number of yearly hires is 100, reflecting sustained growth.",
      ].join(" "),
    );

    const output = await handleGenericSequentialToolCall(
      host,
      genericParams(ToolName.READ_PAGE),
    );

    expect(output.breakLoop).toBe(true);
    expect(output.completedSummary).toBe("100");
    expect(output.completionCandidate).toMatchObject({
      contractKind: "read_answer",
      evidence: [
        expect.objectContaining({
          type: "answer_state",
          detail: expect.objectContaining({
            answer: "100",
            source: "page_read",
          }),
        }),
      ],
    });
  });

  test("blocks same-page anchor clicks before execution", async () => {
    const host = createHost();
    (host.context as any).getCurrentUrl = () => "https://example.test/form";
    (host.context as any).getSnapshot = () =>
      ({
        elements: [
          {
            tag: 1,
            tagName: "a",
            role: "link",
            text: "Form",
            attributes: { href: "/form" },
            rect: { width: 80, height: 24 },
            isVisible: true,
            isDisabled: false,
          },
        ],
      }) as any;

    await executeSequentialToolCalls.call(host, {
      toolCalls: [toolCall(ToolName.CLICK_ELEMENT, { id: 1 })],
      repeatActionWindow: 20,
      llmIntention: null,
      signalCompletedResult: vi.fn(),
      state: baseState(),
    });

    expect(host.executeToolCall).not.toHaveBeenCalled();
    expect(host.context.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "tool",
        tool_call_id: "click_element-call",
        content: expect.stringContaining("link to the current page"),
      }),
    );
    expect(host.traceRecorder?.recordEvent).toHaveBeenCalledWith(
      "same_page_anchor_click_blocked",
      expect.objectContaining({
        targetUrl: "https://example.test/form",
        mode: "sequential",
      }),
    );
  });

  test("blocks duplicate click_element calls in the same response", async () => {
    const host = createHost();
    (host.executeToolCall as any).mockResolvedValue(
      'Clicked [42] button "Add experience"',
    );

    await executeSequentialToolCalls.call(host, {
      toolCalls: [
        toolCall(ToolName.CLICK_ELEMENT, { id: 42 }, "click-1"),
        toolCall(ToolName.CLICK_ELEMENT, { id: 42 }, "click-2"),
      ],
      repeatActionWindow: 20,
      llmIntention: null,
      signalCompletedResult: vi.fn(),
      state: baseState(),
    });

    expect(host.executeToolCall).toHaveBeenCalledTimes(1);
    expect(host.context.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "tool",
        tool_call_id: "click-2",
        content: expect.stringContaining("duplicate click_element"),
      }),
    );
    expect(host.traceRecorder?.recordEvent).toHaveBeenCalledWith(
      "same_response_click_blocked",
      expect.objectContaining({ tool: ToolName.CLICK_ELEMENT }),
    );
  });

  test("enables cart checkout handoff for catalog-order submissions", async () => {
    const host = createHost();
    host.selectedSkillId = "catalog-order-workflow";
    host.originalQuery = 'Order 10 "Standard Laptop" from the hardware store.';
    (host.executeToolCall as any).mockResolvedValue("Configured catalog item.");
    const call = toolCall(ToolName.CONFIGURE_CATALOG_ITEM, {
      quantity: "10",
      submit: true,
      submitButton: "Add to Cart",
    });

    await executeSequentialToolCalls.call(host, {
      toolCalls: [call],
      repeatActionWindow: 20,
      llmIntention: null,
      signalCompletedResult: vi.fn(),
      state: baseState(),
    });

    expect(host.executeToolCall).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        (host.executeToolCall as any).mock.calls[0][0].function.arguments,
      ),
    ).toEqual({
      quantity: "10",
      submit: true,
      submitButton: "Add to Cart",
      continueToCheckout: true,
    });
    expect(host.traceRecorder?.recordEvent).toHaveBeenCalledWith(
      "catalog_cart_handoff_enabled",
      expect.objectContaining({ mode: "sequential" }),
    );
  });

  test("passes catalog-order trusted completion candidate to completion signal", async () => {
    const host = createHost();
    const completed = vi.fn();
    const completionCandidate = {
      contractKind: "workflow_confirmation",
      decisionReason: "Catalog order submitted by trusted workflow.",
      evidence: [
        {
          type: "confirmation_state",
          confidence: "high",
          logicalKey: "trusted:catalog-order:completion",
          turn: 4,
          source: "tool_result",
          detail: {
            source: "trusted_workflow",
            message: "Catalog order submitted.",
          },
        },
      ],
    };
    (host.executeToolCall as any).mockResolvedValue("Order placed.");
    (host.maybeCompleteTrustedCatalogOrderSubmit as any).mockResolvedValue({
      finalSummary: "Catalog order submitted.",
      completionCandidate,
    });

    const output = await executeSequentialToolCalls.call(host, {
      toolCalls: [toolCall(ToolName.CLICK_ELEMENT, { id: 7 }, "submit-order")],
      repeatActionWindow: 20,
      llmIntention: null,
      signalCompletedResult: completed,
      state: baseState(),
    });

    expect(completed).toHaveBeenCalledWith("Catalog order submitted.", {
      completionCandidate,
    });
    expect(output.doneSignaled).toBe(true);
    expect(output.doneSummary).toBe("Catalog order submitted.");
  });
});

describe("fill-checklist re-read note (LP-17)", () => {
  const emailField = {
    tag: 3,
    tagName: "input",
    role: "textbox",
    text: "kris@example.test",
    attributes: {
      id: "email",
      name: "email",
      type: "text",
      value: "kris@example.test",
      label: "Email",
    },
    rect: { x: 0, y: 60, width: 180, height: 24 },
    isVisible: true,
    isDisabled: false,
  };
  const formSnapshot = {
    title: "Apply",
    url: "https://example.test/apply",
    visibleContent: "Application",
    pageContent: "Application",
    elements: [
      emailField,
      { ...emailField, tag: 1, text: "Kris", attributes: { ...emailField.attributes, id: "first-name", name: "first-name", value: "Kris", label: "First name" } },
      { ...emailField, tag: 2, text: "", attributes: { ...emailField.attributes, id: "phone", name: "phone", value: "", label: "Phone" } },
    ],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
  };

  test("second unchanged read_element gets the note appended; the real result survives", async () => {
    const host = createHost();
    const ledger = new Map();
    (host.context as any).getSnapshot = () => formSnapshot;
    (host.context as any).getFieldReadLedger = () => ledger;
    (host.executeToolCall as any).mockResolvedValue(
      '[3] <input> "Email" value="kris@example.test"',
    );

    await handleGenericSequentialToolCall(
      host,
      genericParams(ToolName.READ_ELEMENT, { id: 3 }),
    );
    await handleGenericSequentialToolCall(
      host,
      genericParams(ToolName.READ_ELEMENT, { id: 3 }),
    );

    const toolMessages = (host.context.addMessage as any).mock.calls
      .map((c: any[]) => c[0])
      .filter((m: any) => m.role === "tool");
    expect(toolMessages[0].content).toBe(
      '[3] <input> "Email" value="kris@example.test"',
    );
    expect(toolMessages[1].content).toContain(
      '[3] <input> "Email" value="kris@example.test"',
    );
    expect(toolMessages[1].content).toContain('[note] You already read "Email" on turn 4');
  });
});
