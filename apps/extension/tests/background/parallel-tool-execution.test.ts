import { describe, expect, test } from "vitest";
import { ToolCall, ToolName } from "../../src/types";
import { assessParallelToolCalls } from "../../src/background/agent/parallel-tool-execution";

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
});
