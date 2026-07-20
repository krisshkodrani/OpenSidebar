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
    getWorkflowTabToolRedirect: vi.fn(async () => null),
    listDetailOpenedTargets: new Set<string>(),
    listDetailReviewedTargets: new Set<string>(),
    listDetailVisibleActionCount: 0,
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
    trackListDetailToolSuccess: vi.fn(),
    turnCount: 3,
  } as unknown as ParallelToolDispatchHost;
}

describe("executeParallelToolCalls", () => {
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
