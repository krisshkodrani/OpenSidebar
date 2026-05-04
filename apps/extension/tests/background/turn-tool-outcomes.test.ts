import { describe, expect, test } from "vitest";
import { ToolCall, ToolName } from "../../src/types";
import { collectTurnToolOutcomeRecords } from "../../src/background/agent/turn-tool-outcomes";

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

describe("collectTurnToolOutcomeRecords", () => {
  test("parses tool args and attaches matching tool result content", () => {
    const calls = [
      toolCall(ToolName.DOWNLOAD_FILE, { url: "https://example.test/a.txt" }),
      toolCall(ToolName.GET_COOKIES, { url: "https://example.test" }),
    ];

    expect(
      collectTurnToolOutcomeRecords({
        toolCalls: calls,
        snapshot: null,
        messages: [
          { role: "tool", tool_call_id: calls[1].id, content: "cookies" },
          { role: "tool", tool_call_id: calls[0].id, content: "downloaded" },
        ],
      }),
    ).toEqual([
      {
        toolCall: calls[0],
        toolName: ToolName.DOWNLOAD_FILE,
        args: { url: "https://example.test/a.txt" },
        argsKey: calls[0].function.arguments,
        resultContent: "downloaded",
      },
      {
        toolCall: calls[1],
        toolName: ToolName.GET_COOKIES,
        args: { url: "https://example.test" },
        argsKey: calls[1].function.arguments,
        resultContent: "cookies",
      },
    ]);
  });
});
