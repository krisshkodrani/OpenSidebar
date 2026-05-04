import { describe, expect, test, vi } from "vitest";
import { RiskLevel, ToolCall, ToolName } from "../../src/types";
import {
  executeSequentialToolCalls,
  type SequentialToolDispatchHost,
  type SequentialToolDispatchState,
} from "../../src/background/agent/sequential-tool-dispatch";
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
    },
    disabledTools: new Set<ToolName>(),
    elementResolver: undefined,
    ensureToolApproval: vi.fn(async () => true),
    executeToolCall: vi.fn(),
    getActiveToolProfileForStep: () => null,
    getPendingInlineEditVerificationBlock: () => null,
    getUncommittedInlineEditDoneRejection: () => null,
    getWorkflowTabToolRedirect: vi.fn(async () => null),
    handleClarifyToolCall: vi.fn(),
    handleDoneToolCall: vi.fn(async () => true),
    isRunning: true,
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
    originalQuery: "finish the task",
    recordSkillToolSelection: vi.fn(),
    requiresConsequentialActionApproval: vi.fn(() => false),
    selectedSkillId: null,
    stepHandler: vi.fn(),
    throwIfGracefulStopRequested: vi.fn(),
    toolCache: new ToolResultCache(),
    traceRecorder: {
      recordEvent: vi.fn(),
    },
    turnCount: 4,
  } as unknown as SequentialToolDispatchHost;
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
});
