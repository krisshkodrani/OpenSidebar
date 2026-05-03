import { describe, expect, test, vi } from "vitest";
import {
  recordFailedToolExecution,
  recordSuccessfulToolExecution,
  storeSuccessfulToolResult,
  type AgentLoopToolHandlerHost,
} from "../../src/background/agent/loop-tool-handlers";
import { RiskLevel, ToolName, type AgentStep, type ToolCall } from "../../src/types";
import type { PreToolDecision } from "../../src/background/agent/middleware";

function host(): AgentLoopToolHandlerHost {
  return {
    checkNavigateGuard: vi.fn(),
    consecutiveAutoAdvances: 0,
    context: {
      getSnapshot: vi.fn(() => null),
    },
    disabledTools: new Set(),
    elementResolver: {},
    escalateModel: vi.fn(),
    executeToolCall: vi.fn(),
    getWorkspaceTabIds: vi.fn(),
    hasReadPage: false,
    lastDomStep: null,
    llm: {},
    log: {
      info: vi.fn(),
      error: vi.fn(),
    },
    maxTurns: 10,
    maybeAdvanceTrustedFormFillStep: vi.fn(),
    maybeAutoSubmitTrustedServiceNowForm: vi.fn(),
    maybeCompleteTrustedFormSubmitStep: vi.fn(),
    middleware: {
      evaluatePostTool: vi.fn(),
    },
    originalQuery: "",
    pendingInlineEditVerification: null,
    planSubtasks: [],
    recordMutationSensitiveAction: vi.fn(),
    refreshPerceptionAndTriage: vi.fn(),
    refreshSnapshotWithRetry: vi.fn(),
    replayMutationSensitiveAction: vi.fn(),
    shouldBlockTabManagementTools: vi.fn(),
    statusHandler: vi.fn(),
    stepHandler: vi.fn(),
    toolCache: {
      set: vi.fn(),
    },
    traceRecorder: {
      recordToolExecution: vi.fn(),
    },
    trackListDetailToolSuccess: vi.fn(),
    turnCount: 4,
    updateMoneyTableAggregate: vi.fn(),
    workspaceId: null,
  };
}

function toolCall(): ToolCall {
  return {
    id: "call-1",
    type: "function",
    function: {
      name: ToolName.FIND_ELEMENT,
      arguments: "{}",
    },
  };
}

function toolStep(): AgentStep {
  return {
    id: "step-1",
    type: "tool",
    label: "find_element",
    toolName: ToolName.FIND_ELEMENT,
    status: "running",
    timestamp: 100,
  };
}

function preDecision(): PreToolDecision {
  return {
    toolName: ToolName.FIND_ELEMENT,
    riskLevel: RiskLevel.LOW,
    allowed: true,
    requiresApproval: false,
    approvalMode: "none",
    approvalReason: "test",
  };
}

describe("tool result recording", () => {
  test("records successful tool execution side effects", () => {
    vi.spyOn(Date, "now").mockReturnValue(145);
    const loop = host();
    const discoveredTagIds = new Set<number>();

    const duration = recordSuccessfulToolExecution(loop, {
      toolCall: toolCall(),
      toolName: ToolName.FIND_ELEMENT,
      args: {},
      result: "Found near [12]",
      toolStep: toolStep(),
      preDecision: preDecision(),
      discoveredTagIds,
      llmIntention: "find target",
      mode: "parallel",
    });

    expect(duration).toBe(45);
    expect([...discoveredTagIds]).toEqual([12]);
    expect(loop.middleware.evaluatePostTool).toHaveBeenCalledWith(
      ToolName.FIND_ELEMENT,
      "Found near [12]",
      null,
      45,
      4,
    );
    expect(loop.stepHandler).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done", durationMs: 45 }),
      true,
    );
    expect(loop.traceRecorder?.recordToolExecution).toHaveBeenCalledWith(
      "call-1",
      ToolName.FIND_ELEMENT,
      {},
      "Found near [12]",
      true,
      45,
      RiskLevel.LOW,
    );
  });

  test("records failed tool execution side effects", () => {
    vi.spyOn(Date, "now").mockReturnValue(150);
    const loop = host();

    const duration = recordFailedToolExecution(loop, {
      toolCall: toolCall(),
      toolName: ToolName.FIND_ELEMENT,
      args: {},
      errorMsg: "No element",
      toolStep: toolStep(),
      preDecision: preDecision(),
      llmIntention: "find target",
      mode: "sequential",
    });

    expect(duration).toBe(50);
    expect(loop.middleware.evaluatePostTool).toHaveBeenCalledWith(
      ToolName.FIND_ELEMENT,
      null,
      "No element",
      50,
      4,
    );
    expect(loop.stepHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        durationMs: 50,
        errorMessage: "No element",
      }),
      true,
    );
    expect(loop.traceRecorder?.recordToolExecution).toHaveBeenCalledWith(
      "call-1",
      ToolName.FIND_ELEMENT,
      {},
      "No element",
      false,
      50,
      RiskLevel.LOW,
      "No element",
    );
  });

  test("stores successful cacheable tool results", () => {
    const loop = host();

    storeSuccessfulToolResult(loop, {
      toolName: ToolName.FIND_ELEMENT,
      args: { text: "Save" },
      result: "Found [12]",
      cacheType: "dom",
    });

    expect(loop.toolCache.set).toHaveBeenCalledWith(
      'find_element:{"text":"Save"}',
      "Found [12]",
      "none|0|0",
      "dom",
    );
  });

  test("does not store error tool results", () => {
    const loop = host();

    storeSuccessfulToolResult(loop, {
      toolName: ToolName.FIND_ELEMENT,
      args: { text: "Save" },
      result: "Error: missing",
      cacheType: "dom",
    });

    expect(loop.toolCache.set).not.toHaveBeenCalled();
  });
});
