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
    hasExplicitPageRead: false,
    hasReadPage: false,
    handleClarifyToolCall: vi.fn(),
    handleDoneToolCall: vi.fn(async () => true),
    isRunning: true,
    lastDomStep: null,



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
  test.each(["receipt detail", "manual option", "related item", "input focus"])("allows model-owned workflow action: %s", async (scenario) => {
    const host = createHost();
    const receipt = scenario === "receipt detail";
    const option = scenario === "manual option";
    const focus = scenario === "input focus";
    const query = focus ? "Set the email address with user@example.com" : option ? "Order the monitor with 'Warranty': 'Extended'." : receipt ? "Order the monitor and read the requested-item details for its delivery information." : "Order 'Laptop'; first inspect the related monitor for compatibility.";
    Object.assign(host, { originalQuery: query, getConsequentialActionTaskText: () => query, selectedSkillId: focus ? null : "catalog-order-workflow" });
    const target = { tag: 7, tagName: focus || option ? "input" : "a", role: focus ? "textbox" : option ? "radio" : "link", text: focus ? "" : option ? "Extended" : receipt ? "RITM001234" : "Monitor", attributes: focus ? { type: "email", placeholder: "Email" } : option ? { type: "radio", label: "Extended" } : { href: receipt ? "/sc_req_item.do?sys_id=1234" : "/catalog_item?sys_id=monitor" }, rect: { x: 10, y: 10, width: 120, height: 30 }, isVisible: true, isDisabled: false };
    Object.assign(host.context, { getSnapshot: () => ({ url: option ? "https://instance.test/servicecatalog_cat_item" : "https://instance.test/catalog", title: receipt ? "Order status REQ001234" : "Catalog", pageContent: receipt ? "Order status REQ001234" : option ? "Order this item" : "Laptop and Monitor", visibleContent: "", timestamp: Date.now(), elements: [target] }) });
    const requested = toolCall(receipt ? ToolName.READ_ELEMENT : ToolName.CLICK_ELEMENT, { id: 7 });
    vi.mocked(host.executeToolCall).mockResolvedValue("Requested page action completed.");
    await executeSequentialToolCalls.call(host, { toolCalls: [requested], repeatActionWindow: 20, llmIntention: null, signalCompletedResult: vi.fn(), state: baseState() });
    expect(host.executeToolCall).toHaveBeenCalledWith(requested, 1);
  });

  test.each(["Acme Corporation", "Acme"])("types the model's chosen autocomplete query unchanged: %s", async (text) => {
    const host = createHost();
    Object.assign(host, { originalQuery: "Choose Acme Corporation from the account suggestions.", llm: { hasWriterModel: () => false } });
    Object.assign(host.context, { getSnapshot: () => ({
      url: "https://example.test/accounts", title: "Account lookup", timestamp: Date.now(),
      elements: [{ tag: 31, tagName: "input", role: "combobox", text: "", attributes: { "aria-autocomplete": "list", "aria-label": "Account" }, rect: { x: 10, y: 10, width: 200, height: 30 }, isVisible: true, isDisabled: false }],
    }) });
    const requested = toolCall(ToolName.TYPE_TEXT, { id: 31, text });
    vi.mocked(host.executeToolCall).mockResolvedValue("Input updated; matching suggestions are visible.");
    await executeSequentialToolCalls.call(host, { toolCalls: [requested], repeatActionWindow: 20, llmIntention: null, signalCompletedResult: vi.fn(), state: baseState() });
    expect(host.executeToolCall).toHaveBeenCalledWith(requested, 1);
    expect(host.traceRecorder?.recordToolExecution).toHaveBeenCalledWith(requested.id, ToolName.TYPE_TEXT, { id: 31, text }, expect.any(String), true, expect.any(Number), RiskLevel.LOW);
  });

  test("preserves a requested shortened profile summary during repeated-form entry", async () => {
    const host = createHost();
    const requestedText = "Built workflow tools.";
    Object.assign(host, {
      selectedSkillId: "progressive-repeatable-form",
      originalQuery: `Fill the experience form from my profile, but shorten the first summary to "${requestedText}".`,
      llm: { hasWriterModel: () => false },
    });
    Object.assign(host.context, {
      getMessages: () => [{ role: "tool", content: 'PROFILE FIELDS:\n- experience.roles: [{"summary":"Built React and TypeScript workflow tools for enterprise teams."}]' }],
      getSnapshot: () => ({ url: "https://example.test/form", title: "Experience", timestamp: Date.now(), elements: [{
        tag: 126, tagName: "textarea", role: "textbox", text: "", attributes: { name: "experiences[0].summary", "aria-label": "Experience 1 summary" },
        rect: { x: 10, y: 10, width: 300, height: 80 }, isVisible: true, isDisabled: false,
      }] }),
    });
    const requested = toolCall(ToolName.TYPE_TEXT, { id: 126, text: requestedText });
    vi.mocked(host.executeToolCall).mockResolvedValue("Typed requested summary.");
    await executeSequentialToolCalls.call(host, { toolCalls: [requested], repeatActionWindow: 20, llmIntention: null, signalCompletedResult: vi.fn(), state: baseState() });
    expect(host.executeToolCall).toHaveBeenCalledWith(requested, 1);
    expect(host.traceRecorder?.recordToolExecution).toHaveBeenCalledWith(
      requested.id, ToolName.TYPE_TEXT, { id: 126, text: requestedText }, expect.any(String), true, expect.any(Number), RiskLevel.LOW,
    );
  });

  test("inline editor adaptation preserves the model request and records actual execution", async () => {
    const host = createHost();
    Object.assign(host, { llm: { hasWriterModel: () => false }, getActiveToolProfileForStep: () => "edit_surface" });
    Object.assign(host.context, { getSnapshot: () => ({
      url: "https://example.test", title: "Sheet", timestamp: Date.now(),
      elements: [
        { tag: 37, tagName: "td", role: "gridcell", text: "130", attributes: {}, isVisible: true, isDisabled: false, rect: { x: 10, y: 10, width: 80, height: 24 } },
        { tag: 44, tagName: "input", role: "textbox", text: "130", attributes: { type: "text", value: "130", "aria-label": "Sales editor" }, isVisible: true, isDisabled: false, rect: { x: 12, y: 12, width: 76, height: 20 } },
      ],
    }) });
    vi.mocked(host.executeToolCall).mockResolvedValue("Typed 200 into the editor.");
    const requested = toolCall(ToolName.TYPE_TEXT, { id: 37, text: "200" });
    const original = structuredClone(requested);
    await executeSequentialToolCalls.call(host, { toolCalls: [requested], repeatActionWindow: 20, llmIntention: null, signalCompletedResult: vi.fn(), state: baseState() });
    expect(host.executeToolCall).toHaveBeenCalledWith({ ...original, function: {
      ...original.function, arguments: JSON.stringify({ id: 44, text: "200" }),
    } }, 1);
    expect(host.traceRecorder?.recordToolExecution).toHaveBeenCalledWith(
      original.id, ToolName.TYPE_TEXT, { id: 44, text: "200" }, expect.any(String), true, expect.any(Number), RiskLevel.LOW,
    );
    expect(requested).toEqual(original);
  });

  test.each(["Compare Alpha and Beta only; ignore the other listings.", "Review all listings before recommending one."])("allows evidence gathering without a list-detail sequence: %s", async (query) => {
    const host = createHost();
    Object.assign(host, { selectedSkillId: "list-detail-review-loop", originalQuery: query });
    Object.assign(host.context, { getSnapshot: () => ({ url: "https://example.test/list", title: "Results", timestamp: Date.now(), elements: ["Alpha", "Beta", "Gamma"].map((name, i) => ({ tag: i + 1, tagName: "button", text: `View details for ${name}`, attributes: {}, isVisible: true, isDisabled: false })) }) });
    const requested = toolCall(ToolName.READ_PAGE);
    vi.mocked(host.executeToolCall).mockResolvedValue("Page evidence.");
    await executeSequentialToolCalls.call(host, { toolCalls: [requested], repeatActionWindow: 20, llmIntention: null, signalCompletedResult: vi.fn(), state: baseState() });
    expect(host.executeToolCall).toHaveBeenCalledWith(requested, 1);
  });

  test.each(["first navigation", "refined search", "rendered results"])("preserves executor choice during knowledge workflow: %s", async (scenario) => {
    const host = createHost();
    const currentUrl = scenario === "rendered results"
      ? "https://example.test/kb?id=kb_search&query=audit"
      : "https://example.test/kb";
    const messages = scenario === "first navigation" ? [] : [{ role: "tool", content:
      scenario === "refined search"
        ? "Knowledge base search result. No answer candidate found. Rendered results: https://example.test/kb?id=kb_search&query=audit"
        : "Page: Knowledge Search\n[Audit article](https://example.test/kb?id=kb_article_view&sys_kb_id=42)\nFinancial audit requirements."
    }];
    Object.assign(host, { selectedSkillId: "search-answer-extraction", originalQuery: "Find the audit requirements in the knowledge base." });
    Object.assign(host.context, { getCurrentUrl: () => currentUrl, getMessages: () => messages });
    vi.mocked(host.executeToolCall).mockResolvedValue("No answer candidate found.");
    const requested = scenario === "first navigation"
      ? toolCall(ToolName.NAVIGATE, { url: "https://example.test/other-source" })
      : toolCall(ToolName.SEARCH_KNOWLEDGE_BASE, { question: "What are the audit requirements?", query: "audit requirements 2026" });
    const original = structuredClone(requested);
    await executeSequentialToolCalls.call(host, {
      toolCalls: [requested], repeatActionWindow: 20, llmIntention: null,
      signalCompletedResult: vi.fn(), state: baseState(),
    });
    expect(requested).toEqual(original);
    expect(host.executeToolCall).toHaveBeenCalledWith(original, 1);
    expect(host.handleDoneToolCall).not.toHaveBeenCalled();
  });

  test.each(["ranked candidate", "exhausted results"])("preserves requested navigation after %s", async (scenario) => {
    const host = createHost();
    const currentUrl = "https://example.test/search?q=audit";
    const content = `Page: Search Results\nURL: ${currentUrl}\n` + (scenario === "ranked candidate"
      ? "Search Results: [Audit guide](https://example.test/audit-guide)"
      : "0 results for audit. No results found.");
    const observation = { role: "tool", content };
    const messages = [observation, { role: "assistant", content: "I will try another source." }, observation];
    Object.assign(host, { selectedSkillId: "search-answer-extraction", originalQuery: "Find the audit requirements." });
    Object.assign(host.context, { getCurrentUrl: () => currentUrl, getMessages: () => messages });
    vi.mocked(host.executeToolCall).mockResolvedValue("Navigated successfully.");
    const requested = toolCall(ToolName.NAVIGATE, { url: "https://example.test/other-source" });
    const original = structuredClone(requested);
    const completed = vi.fn();
    await executeSequentialToolCalls.call(host, {
      toolCalls: [requested], repeatActionWindow: 20, llmIntention: null,
      signalCompletedResult: completed, state: baseState(),
    });
    expect(requested).toEqual(original);
    expect(host.executeToolCall).toHaveBeenCalledWith(original, 1);
    expect(host.handleDoneToolCall).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
  });

  test.each([
    ["https://example.test/app#/account/details", "https://example.test/app#/account/activity"],
    ["https://example.test/receipt/42", "https://example.test/receipt/42"],
    ["https://instance.test/incident.do?sys_id=record-42", "https://instance.test/incident.do?sys_id=record-42"],
  ])("allows objective-driven navigation after a completed step at %s", async (completedAtUrl, url) => {
    const host = createHost();
    Object.assign(host, { planSubtasks: [
      { description: "Read the saved record", status: "completed", turnsUsed: 1, turnBudget: 10, completedAtUrl },
      { description: "Revisit the record and verify its activity", status: "running", turnsUsed: 0, turnBudget: 10 },
    ] });
    vi.mocked(host.executeToolCall).mockResolvedValue("Navigated successfully.");
    const requested = toolCall(ToolName.NAVIGATE, { url });
    await executeSequentialToolCalls.call(host, {
      toolCalls: [requested], repeatActionWindow: 20, llmIntention: null,
      signalCompletedResult: vi.fn(), state: baseState(),
    });
    expect(host.executeToolCall).toHaveBeenCalledWith(requested, 1);
    expect(host.context.addMessage).not.toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("would undo progress") }));
  });

  test.each(["approval", "pending edit", "stop"])("preserves %s protection before navigation", async (protection) => {
    const host = createHost();
    if (protection === "approval") {
      Object.assign(host.middleware, { evaluatePreTool: (toolName: ToolName) => ({
        toolName, riskLevel: RiskLevel.HIGH, allowed: true, requiresApproval: true,
        approvalMode: "always", approvalReason: "test",
      }) });
      vi.mocked(host.ensureToolApproval).mockResolvedValue(false);
    }
    if (protection === "pending edit") Object.assign(host, { getPendingInlineEditVerificationBlock: () => "Verify the pending edit before leaving." });
    if (protection === "stop") vi.mocked(host.throwIfGracefulStopRequested).mockImplementation(() => { throw new Error("Stopped"); });
    const run = executeSequentialToolCalls.call(host, {
      toolCalls: [toolCall(ToolName.NAVIGATE, { url: "https://example.test/receipt/42" })],
      repeatActionWindow: 20, llmIntention: null, signalCompletedResult: vi.fn(), state: baseState(),
    });
    if (protection === "stop") await expect(run).rejects.toThrow("Stopped");
    else await run;
    expect(host.executeToolCall).not.toHaveBeenCalled();
  });

  test.each([
    [ToolName.CLICK_ELEMENT, "continuation-edit"],
    [ToolName.TYPE_TEXT, null],
    [ToolName.SELECT_OPTION, "multi-step-form-wizard"],
  ] as const)("reports DOM growth without inventing autocomplete after %s", async (name, skill) => {
    const host = createHost() as unknown as AgentLoopToolHandlerHost;
    host.selectedSkillId = skill;
    vi.mocked(host.executeToolCall).mockResolvedValue("Action completed.");
    vi.mocked(host.refreshSnapshotWithRetry).mockResolvedValue(3);

    await handleGenericSequentialToolCall(host, genericParams(name, { id: 1, text: "AB" }));

    const notices = vi.mocked(host.context.addMessage).mock.calls
      .map(([message]) => String(message.content))
      .filter((content) => content.includes("new elements appeared"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("after the action");
    expect(notices[0]).toContain("unless a matching option list is visible");
    expect(notices[0]).not.toMatch(/after typing|Do NOT type the full value|dropdown detected/);
  });

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

describe("grounding rejection batch abort (issue #117)", () => {
  const groundedSnapshot = {
    elements: [
      {
        tag: 1,
        tagName: "button",
        role: "button",
        text: "Advance",
        attributes: {},
        rect: { width: 80, height: 24 },
        isVisible: true,
        isDisabled: false,
      },
    ],
  } as any;

  test("aborts the batch after 5 consecutive invalid element ids and stubs the rest", async () => {
    const host = createHost();
    (host.context as any).getSnapshot = () => groundedSnapshot;

    const calls = Array.from({ length: 8 }, (_, i) =>
      toolCall(ToolName.READ_ELEMENT, { id: 100 + i }, `read-${i}`),
    );
    await executeSequentialToolCalls.call(host, {
      toolCalls: calls,
      repeatActionWindow: 20,
      llmIntention: null,
      signalCompletedResult: vi.fn(),
      state: baseState(),
    });

    expect(host.executeToolCall).not.toHaveBeenCalled();
    const toolMessages = (host.context.addMessage as any).mock.calls
      .map((c: any[]) => c[0])
      .filter((m: any) => m.role === "tool");
    // 5 grounding rejections answered, then 3 remaining calls stubbed.
    expect(toolMessages).toHaveLength(8);
    expect(toolMessages[4].content).toContain("does not exist");
    expect(toolMessages[5].tool_call_id).toBe("read-5");
    expect(toolMessages[5].content).toContain("Not executed");
    expect(toolMessages[7].tool_call_id).toBe("read-7");
    expect(host.traceRecorder?.recordEvent).toHaveBeenCalledWith(
      "grounding_rejection_batch_abort",
      expect.objectContaining({
        consecutiveRejections: 5,
        skippedCalls: 3,
        mode: "sequential",
      }),
    );
  });

  test("a valid call between rejections resets the abort counter", async () => {
    const host = createHost();
    (host.context as any).getSnapshot = () => groundedSnapshot;
    (host.executeToolCall as any).mockResolvedValue("ok");

    const calls = [
      toolCall(ToolName.READ_ELEMENT, { id: 100 }, "bad-0"),
      toolCall(ToolName.READ_ELEMENT, { id: 101 }, "bad-1"),
      toolCall(ToolName.READ_ELEMENT, { id: 102 }, "bad-2"),
      toolCall(ToolName.READ_ELEMENT, { id: 103 }, "bad-3"),
      toolCall(ToolName.READ_ELEMENT, { id: 1 }, "good-0"),
      toolCall(ToolName.READ_ELEMENT, { id: 104 }, "bad-4"),
    ];
    await executeSequentialToolCalls.call(host, {
      toolCalls: calls,
      repeatActionWindow: 20,
      llmIntention: null,
      signalCompletedResult: vi.fn(),
      state: baseState(),
    });

    expect(
      (host.traceRecorder?.recordEvent as any).mock.calls.map(
        (c: any[]) => c[0],
      ),
    ).not.toContain("grounding_rejection_batch_abort");
  });
});
