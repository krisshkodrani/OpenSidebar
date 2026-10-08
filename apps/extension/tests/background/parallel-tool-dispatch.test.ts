import { describe, expect, test, vi } from "vitest";
import { RiskLevel, ToolCall, ToolName } from "../../src/types";
import {
  executeParallelToolCalls,
  type ParallelToolDispatchHost,
  type ParallelToolDispatchState,
} from "../../src/background/agent/parallel-tool-dispatch";
import { ToolResultCache } from "../../src/background/agent/tool-cache";

function toolCall(
  name: ToolName,
  args: Record<string, unknown> = {},
): ToolCall {
  return {
    id: `${name}-call`,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function baseState(
  overrides: Partial<ParallelToolDispatchState> = {},
): ParallelToolDispatchState {
  return {
    recentToolCalls: [],
    verifiedFinalClickBypassKeys: new Set<string>(),
    lastReadElementId: null,
    consecutiveReadElementSameId: 0,
    blockedActions: [],
    recentSuccesses: [],
    discoveredTagIds: new Set<number>(),
    orientationPhase: false,
    orientationToolsUsed: new Set<string>(),
    domModified: false,
    visuallyModified: false,
    lastDomAffectingToolName: null,
    ...overrides,
  };
}

function createHost(
  executeToolCall = vi.fn(async (call: ToolCall) => `${call.function.name} ok`),
): ParallelToolDispatchHost {
  return {
    context: {
      getSnapshot: () => null,
      getFieldReadLedger: () => new Map(),
      getMessages: () => [],
      getCurrentUrl: () => "https://example.test",
      getPlanStatusRaw: () => null,
      addMessage: vi.fn(),
    },
    elementResolver: undefined,
    executeToolCall,
    getActiveToolProfileForStep: () => null,



    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
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
    originalQuery: "test task",
    recordSkillToolSelection: vi.fn(),
    selectedSkillId: null,
    stepHandler: vi.fn(),
    toolCache: new ToolResultCache(),
    traceRecorder: {
      recordEvent: vi.fn(),
      recordToolExecution: vi.fn(),
    },

    turnCount: 3,
  } as unknown as ParallelToolDispatchHost;
}

describe("executeParallelToolCalls", () => {
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
    await executeParallelToolCalls(host, { toolCalls: [requested], tabId: 1, repeatActionWindow: 20, llmIntention: null, state: baseState() });
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
    await executeParallelToolCalls(host, { toolCalls: [requested], tabId: 1, repeatActionWindow: 20, llmIntention: null, state: baseState() });
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
    await executeParallelToolCalls(host, { toolCalls: [requested], tabId: 1, repeatActionWindow: 20, llmIntention: null, state: baseState() });
    expect(host.executeToolCall).toHaveBeenCalledWith(requested, 1);
    expect(host.traceRecorder?.recordToolExecution).toHaveBeenCalledWith(
      requested.id, ToolName.TYPE_TEXT, { id: 126, text: requestedText }, expect.any(String), true, expect.any(Number), RiskLevel.LOW,
    );
  });

  test("inline editor adaptation preserves the model request and records actual execution", async () => {
    const host = createHost();
    Object.assign(host, { getActiveToolProfileForStep: () => "edit_surface" });
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
    await executeParallelToolCalls(host, { toolCalls: [requested], tabId: 1, repeatActionWindow: 20, llmIntention: null, state: baseState() });
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
    const result = await executeParallelToolCalls(host, { toolCalls: [requested], tabId: 1, repeatActionWindow: 20, llmIntention: null, state: baseState() });
    expect(result.results[0]?.error).toBeNull();
    expect(host.executeToolCall).toHaveBeenCalledWith(requested, 1);
  });

  test("executes allowed calls and preserves result order", async () => {
    const calls = [
      toolCall(ToolName.GET_COOKIES, { url: "https://a.example" }),
      toolCall(ToolName.DOWNLOAD_FILE, { url: "https://b.example/file.txt" }),
    ];
    const host = createHost();

    const output = await executeParallelToolCalls(host, {
      toolCalls: calls,
      tabId: 1,
      repeatActionWindow: 20,
      llmIntention: "parallel test",
      state: baseState(),
    });

    expect(output.results).toEqual([
      { toolCall: calls[0], result: "get_cookies ok", error: null },
      { toolCall: calls[1], result: "download_file ok", error: null },
    ]);
    expect(host.executeToolCall).toHaveBeenCalledTimes(2);
    expect(host.recordSkillToolSelection).toHaveBeenCalledWith(
      ToolName.GET_COOKIES,
      "parallel",
    );
    expect(host.recordSkillToolSelection).toHaveBeenCalledWith(
      ToolName.DOWNLOAD_FILE,
      "parallel",
    );
  });

  test("blocks same-page anchor clicks before execution", async () => {
    const call = toolCall(ToolName.CLICK_ELEMENT, { id: 1 });
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

    const output = await executeParallelToolCalls(host, {
      toolCalls: [call],
      tabId: 1,
      repeatActionWindow: 20,
      llmIntention: null,
      state: baseState(),
    });

    expect(output.results).toEqual([
      {
        toolCall: call,
        result: null,
        error: expect.stringContaining("link to the current page"),
      },
    ]);
    expect(host.executeToolCall).not.toHaveBeenCalled();
    expect(host.traceRecorder?.recordEvent).toHaveBeenCalledWith(
      "same_page_anchor_click_blocked",
      expect.objectContaining({
        targetUrl: "https://example.test/form",
        mode: "parallel",
      }),
    );
  });

  test("blocks exact repeated non-exempt actions before execution", async () => {
    const args = { url: "https://example.test/file.txt" };
    const call = toolCall(ToolName.DOWNLOAD_FILE, args);
    const argsKey = call.function.arguments.slice(0, 100);
    const host = createHost();

    const output = await executeParallelToolCalls(host, {
      toolCalls: [call],
      tabId: 1,
      repeatActionWindow: 20,
      llmIntention: null,
      state: baseState({
        recentToolCalls: [
          { tool: ToolName.DOWNLOAD_FILE, argsKey },
          { tool: ToolName.DOWNLOAD_FILE, argsKey },
        ],
      }),
    });

    expect(output.results[0].result).toContain(
      "BLOCKED: You already called download_file",
    );
    expect(output.results[0].error).toBeNull();
    expect(host.executeToolCall).not.toHaveBeenCalled();
  });
});
