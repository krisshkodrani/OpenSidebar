import { describe, expect, test } from "vitest";
import { ToolCall, ToolName } from "../../src/types";
import {
  addParallelToolResultsToContext,
  assessParallelToolCalls,
  handleParallelVerificationGate,
} from "../../src/background/agent/parallel-tool-execution";

function toolCall(name: ToolName, args: Record<string, unknown> = {}): ToolCall {
  return {
    id: `${name}-call`,
    type: "function",
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

describe("parallel tool execution assessment", () => {
  test("allows multiple low-risk read-only tools", () => {
    expect(
      assessParallelToolCalls([
        toolCall(ToolName.GET_COOKIES),
        toolCall(ToolName.SEARCH_HISTORY, { query: "example" }),
      ]),
    ).toMatchObject({
      canParallelize: true,
      hasSequentialTool: false,
      hasHighRiskTool: false,
      hasDomModifyingTool: false,
    });
  });

  test("blocks single-tool batches", () => {
    expect(
      assessParallelToolCalls([toolCall(ToolName.READ_PAGE)]).canParallelize,
    ).toBe(false);
  });

  test("blocks sequential tools", () => {
    expect(
      assessParallelToolCalls([
        toolCall(ToolName.READ_PAGE),
        toolCall(ToolName.WAIT, { seconds: 1 }),
      ]),
    ).toMatchObject({
      canParallelize: false,
      hasSequentialTool: true,
    });
  });

  test("blocks high-risk tools", () => {
    expect(
      assessParallelToolCalls([
        toolCall(ToolName.READ_PAGE),
        toolCall(ToolName.NAVIGATE, { url: "https://example.com" }),
      ]),
    ).toMatchObject({
      canParallelize: false,
      hasHighRiskTool: true,
    });
  });

  test("blocks DOM-modifying tools", () => {
    expect(
      assessParallelToolCalls([
        toolCall(ToolName.READ_PAGE),
        toolCall(ToolName.CLICK_ELEMENT, { id: 1 }),
      ]),
    ).toMatchObject({
      canParallelize: false,
      hasDomModifyingTool: true,
      });
  });

  test("adds parallel tool results to context in tool-call order", () => {
    const messages: unknown[] = [];
    const calls = [toolCall(ToolName.READ_PAGE), toolCall(ToolName.GET_COOKIES)];

    addParallelToolResultsToContext(
      {
        addMessage: (message) => messages.push(message),
      },
      [
        { toolCall: calls[0], result: "page result", error: null },
        { toolCall: calls[1], result: null, error: "cookie error" },
      ],
    );

    expect(messages).toEqual([
      {
        role: "tool",
        tool_call_id: calls[0].id,
        content: "page result",
      },
      {
        role: "tool",
        tool_call_id: calls[1].id,
        content: "Error: cookie error",
      },
    ]);
  });

  test("advances a parallel verification gate when evidence matches", () => {
    const userMessages: string[] = [];
    const synced: unknown[] = [];
    const broadcasted: number[] = [];
    const logged: unknown[] = [];
    const recorded: unknown[] = [];

    handleParallelVerificationGate({
      planStatus: {
        currentIndex: 0,
        subtasks: [
          {
            description: "Find confirmation",
            status: "running",
            verificationGate: {
              trigger: "confirmation",
              action: "advance_step",
            },
          },
        ],
      },
      currentUrl: "https://example.com",
      results: [
        {
          toolCall: toolCall(ToolName.READ_PAGE),
          result: "The confirmation is visible",
          error: null,
        },
      ],
      host: {
        advanceCompletedSubtasks: () => 1,
        resetConsecutiveAutoAdvances: () => undefined,
        syncPlanStatus: (...args) => synced.push(args),
        broadcastTaskProgress: (currentIndex) => broadcasted.push(currentIndex),
        addUserMessage: (content) => userMessages.push(content),
        logVerificationGate: (data) => logged.push(data),
        recordVerificationGate: (data) => recorded.push(data),
      },
    });

    expect(synced).toEqual([
      [
        1,
        "step_advanced_by_gate",
        {
          evidence: "The confirmation is visibl",
          mode: "parallel",
          advancedTo: 1,
        },
      ],
    ]);
    expect(broadcasted).toEqual([1]);
    expect(userMessages).toEqual([
      "STEP ADVANCED: 'The confirmation is visibl' matched. Now on step 2.",
    ]);
    expect(logged).toEqual([
      {
        action: "advance_step",
        evidence: "The confirmation is visibl",
        mode: "parallel",
      },
    ]);
    expect(recorded).toEqual(logged);
  });
});
