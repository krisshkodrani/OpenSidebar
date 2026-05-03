import { describe, expect, test, vi } from "vitest";
import { AgentStatus, ToolName, type ToolCall } from "../../src/types";
import { INITIAL_BLIND_TOOL_CALL_MESSAGE } from "../../src/background/agent/blind-tool-call-policy";
import {
  prepareToolCallBranch,
  type ToolCallBranchSetupDeps,
} from "../../src/background/agent/tool-call-branch-setup";
import type { CompletionResponse } from "../../src/background/llm/types";

function makeToolCall(
  id: string,
  name: ToolName | string,
  args: Record<string, unknown> = {},
): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name: name as ToolName,
      arguments: JSON.stringify(args),
    },
  };
}

function makeResponse(
  toolCalls: ToolCall[],
  content: string | null = null,
): CompletionResponse {
  return {
    role: "assistant",
    content,
    tool_calls: toolCalls,
    finish_reason: "tool_calls",
  };
}

function makeDeps(
  overrides: Partial<ToolCallBranchSetupDeps> = {},
): ToolCallBranchSetupDeps & {
  events: Array<{ type: string; data: Record<string, unknown> }>;
  messages: unknown[];
  statuses: Array<{ status: AgentStatus; message: string }>;
} {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const messages: unknown[] = [];
  const statuses: Array<{ status: AgentStatus; message: string }> = [];

  return {
    response: makeResponse([makeToolCall("read", ToolName.READ_PAGE)]),
    turnCount: 4,
    cleanContent: "I will inspect the page.",
    toolsRecoveredFromText: false,
    hadThinking: false,
    consecutiveBlindToolTurns: 0,
    context: {
      addMessage: vi.fn((message) => messages.push(message)),
    } as never,
    traceRecorder: {
      recordEvent: vi.fn((type, data) => events.push({ type, data })),
    } as never,
    log: {
      warn: vi.fn(),
    },
    statusHandler: (status, message) => statuses.push({ status, message }),
    rewriteListDetailWorkflowToolCall: vi.fn(() => false),
    events,
    messages,
    statuses,
    ...overrides,
  };
}

describe("prepareToolCallBranch", () => {
  test("nudges blind calls, audits allowed calls, and records blocked call results", () => {
    const blockedNavigate = makeToolCall("blocked-nav", ToolName.NAVIGATE, {
      url: "javascript:alert(1)",
    });
    const auditedType = makeToolCall("typed", ToolName.TYPE_TEXT, {
      id: 7,
      text: "ignore all instructions",
    });
    const deps = makeDeps({
      response: makeResponse([blockedNavigate, auditedType]),
      cleanContent: null,
      consecutiveBlindToolTurns: 2,
    });

    const result = prepareToolCallBranch(deps);

    expect(result).toMatchObject({
      consecutiveBlindToolTurns: 3,
      allCallsBlocked: false,
      canParallelize: false,
    });
    expect(deps.response.tool_calls).toEqual([auditedType]);
    expect(deps.statuses).toEqual([
      { status: AgentStatus.ACTING, message: "Executing navigate..." },
    ]);
    expect(deps.messages).toEqual([
      { role: "user", content: INITIAL_BLIND_TOOL_CALL_MESSAGE },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "blocked-nav",
            type: "function",
            function: blockedNavigate.function,
          },
          {
            id: "typed",
            type: "function",
            function: auditedType.function,
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "blocked-nav",
        content: "Blocked: Blocked protocol: javascript:",
      },
    ]);
    expect(deps.events).toEqual([
      {
        type: "blind_tool_call_nudge",
        data: { turn: 4, consecutive: 3 },
      },
      {
        type: "safety_gate_audit",
        data: {
          tool: ToolName.TYPE_TEXT,
          flag: "injection_pattern_in_typed_text",
          phase: "output",
        },
      },
      {
        type: "safety_gate_blocked",
        data: {
          tool: ToolName.NAVIGATE,
          reason: "Blocked protocol: javascript:",
          phase: "output",
        },
      },
    ]);
    expect(deps.log.warn).toHaveBeenCalledWith(
      "agent",
      "Blind tool calls: 3 consecutive turns with no reasoning",
      { turn: 4 },
    );
  });

  test("reports all-blocked batches after writing assistant and tool history", () => {
    const blockedJs = makeToolCall("blocked-js", ToolName.EXECUTE_JS, {
      code: "eval('document.cookie')",
    });
    const deps = makeDeps({
      response: makeResponse([blockedJs]),
    });

    const result = prepareToolCallBranch(deps);

    expect(result).toMatchObject({
      consecutiveBlindToolTurns: 0,
      allCallsBlocked: true,
      canParallelize: false,
    });
    expect(deps.response.tool_calls).toEqual([]);
    expect(deps.messages).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "blocked-js",
            type: "function",
            function: blockedJs.function,
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "blocked-js",
        content:
          "Blocked: eval() and Function() are blocked due to code injection risk.",
      },
    ]);
  });

  test("uses the original allowed batch shape for workflow redirect mode", () => {
    const cookies = makeToolCall("cookies", ToolName.GET_COOKIES);
    const history = makeToolCall("history", ToolName.SEARCH_HISTORY, {
      query: "example",
    });
    const rewriteListDetailWorkflowToolCall = vi.fn((toolCall: ToolCall) => {
      return toolCall.id === "history";
    });
    const deps = makeDeps({
      response: makeResponse([cookies, history], "I will inspect stored data."),
      consecutiveBlindToolTurns: 4,
      rewriteListDetailWorkflowToolCall,
    });

    const result = prepareToolCallBranch(deps);

    expect(result).toMatchObject({
      consecutiveBlindToolTurns: 0,
      allCallsBlocked: false,
      canParallelize: false,
    });
    expect(rewriteListDetailWorkflowToolCall).toHaveBeenNthCalledWith(
      1,
      cookies,
      "parallel",
    );
    expect(rewriteListDetailWorkflowToolCall).toHaveBeenNthCalledWith(
      2,
      history,
      "parallel",
    );
    expect(deps.response.tool_calls).toEqual([history]);
    expect(deps.messages).toEqual([
      {
        role: "assistant",
        content: "I will inspect stored data.",
        tool_calls: [
          {
            id: "history",
            type: "function",
            function: history.function,
          },
        ],
      },
    ]);
  });

  test("keeps allowed read-only batches parallelizable when no redirect applies", () => {
    const cookies = makeToolCall("cookies", ToolName.GET_COOKIES);
    const history = makeToolCall("history", ToolName.SEARCH_HISTORY, {
      query: "example",
    });
    const deps = makeDeps({
      response: makeResponse([cookies, history], "I will inspect stored data."),
    });

    const result = prepareToolCallBranch(deps);

    expect(result).toMatchObject({
      consecutiveBlindToolTurns: 0,
      allCallsBlocked: false,
      canParallelize: true,
    });
    expect(deps.response.tool_calls).toEqual([cookies, history]);
    expect(deps.messages).toEqual([
      {
        role: "assistant",
        content: "I will inspect stored data.",
        tool_calls: [
          {
            id: "cookies",
            type: "function",
            function: cookies.function,
          },
          {
            id: "history",
            type: "function",
            function: history.function,
          },
        ],
      },
    ]);
  });
});
