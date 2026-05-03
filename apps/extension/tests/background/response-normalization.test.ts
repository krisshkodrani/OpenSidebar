import { describe, expect, test } from "vitest";
import { CompletionResponse } from "../../src/background/llm/types";
import {
  isEmptyCompletionResponse,
  normalizeResponseContent,
  recoverResponseToolCallsFromText,
  summarizeToolCalls,
} from "../../src/background/agent/response-normalization";

describe("response normalization", () => {
  test("detects empty assistant responses", () => {
    expect(
      isEmptyCompletionResponse({
        role: "assistant",
        content: null,
        finish_reason: "stop",
      }),
    ).toBe(true);

    expect(
      isEmptyCompletionResponse({
        role: "assistant",
        content: "Thinking",
        finish_reason: "stop",
      }),
    ).toBe(false);
  });

  test("normalizes think-tag content", () => {
    const normalized = normalizeResponseContent({
      role: "assistant",
      content: "<think>private</think>Use read_page next.",
      finish_reason: "stop",
    });

    expect(normalized.rawContent).toContain("<think>");
    expect(normalized.cleanContent).toBe("Use read_page next.");
    expect(normalized.thinkingContent).toBe("private");
    expect(normalized.hadThinking).toBe(true);
  });

  test("summarizes tool calls with bounded arguments", () => {
    expect(
      summarizeToolCalls(
        [
          {
            id: "call-1",
            type: "function",
            function: { name: "click_element", arguments: '{"id":123}' },
          },
        ],
        6,
      ),
    ).toEqual(['click_element({"id":)']);
  });

  test("recovers tool calls from JSON text and clears assistant content", () => {
    const response: CompletionResponse = {
      role: "assistant",
      content: '{"function":"read_page","arguments":{}}',
      finish_reason: "stop",
    };

    const recovery = recoverResponseToolCallsFromText(
      response,
      response.content,
    );

    expect(recovery.recovered).toBe(true);
    expect(recovery.cleanContent).toBeNull();
    expect(response.content).toBeNull();
    expect(response.tool_calls?.[0].function.name).toBe("read_page");
  });
});
