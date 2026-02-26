import { describe, expect, test, vi, beforeEach } from "vitest";
import { extractGoldenCase } from "../../evals/extractor";

// Mock the utils module
vi.mock("../../evals/utils", () => ({
  resolveSessionId: vi.fn((prefix: string) => {
    if (prefix === "missing") throw new Error("No session found matching: missing");
    return "test-session-001";
  }),
  readTrace: vi.fn((sessionId: string) => {
    if (sessionId === "test-session-001") {
      return [
        {
          traceKind: "agent.turn",
          turnNumber: 1,
          snapshot: { url: "https://example.com/step1" },
          llmRequest: {
            model: "openai/gpt-oss-120b",
            messages: [
              { role: "system", content: "You are OpenSidebar, an autonomous browser agent.\n\n## Visible Elements\n[1] <button> \"Submit\"\n[2] <input> \"Search\"\n\n## Page Interpretation\nLAYOUT: Form page" },
              { role: "user", content: "Click the submit button" },
            ],
          },
          llmResponse: {
            content: "I see a submit button at [1]. Let me click it.",
            toolCalls: [
              {
                id: "call_123",
                type: "function",
                function: { name: "click_element", arguments: '{"id": 1}' },
              },
            ],
          },
        },
        {
          traceKind: "agent.turn",
          turnNumber: 2,
          snapshot: { url: "https://example.com/step2" },
          llmRequest: {
            model: "openai/gpt-oss-120b",
            messages: [
              { role: "system", content: "You are OpenSidebar.\n\n## Visible Elements\n[3] <div> \"Success\"" },
              { role: "user", content: "Verify result" },
              { role: "assistant", content: "Clicked submit" },
            ],
          },
          llmResponse: {
            content: null,
            toolCalls: [
              {
                id: "call_456",
                type: "function",
                function: { name: "done", arguments: '{"summary":"Submitted form"}' },
              },
            ],
          },
        },
        // Turn with no system prompt (edge case)
        {
          traceKind: "agent.turn",
          turnNumber: 99,
          snapshot: { url: "" },
          llmRequest: { model: "unknown", messages: [{ role: "user", content: "test" }] },
          llmResponse: { content: "no tools", toolCalls: [] },
        },
      ];
    }
    return [];
  }),
  readSessionIndex: vi.fn(() => [
    {
      sessionId: "test-session-001",
      query: "Click the submit button",
      outcome: "completed",
      startUrl: "https://example.com/step1",
    },
  ]),
}));

describe("extractGoldenCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("produces valid EvalCase with real system prompt", () => {
    const result = extractGoldenCase("test-session", 1);

    expect(result.id).toBe("golden-test-ses-t1");
    expect(result.sourceSessionId).toBe("test-session-001");
    expect(result.sourceTurn).toBe(1);
    expect(result.strategy).toBe("golden");
    expect(result.input.systemPrompt).toContain("You are OpenSidebar");
    expect(result.input.systemPrompt).toContain("## Visible Elements");
    expect(result.input.conversationHistory).toHaveLength(2);
    expect(result.input.model).toBe("openai/gpt-oss-120b");
    expect(result.expected.toolCalls).toHaveLength(1);
    expect(result.expected.toolCalls[0].toolName).toBe("click_element");
    expect(result.expected.toolCalls[0].args).toEqual({ id: 1 });
    expect(result.metadata.url).toBe("https://example.com/step1");
    expect(result.metadata.query).toBe("Click the submit button");
    expect(result.metadata.tags).toContain("golden");
  });

  test("--correct-tool override replaces expected tool calls", () => {
    const result = extractGoldenCase("test-session", 1, {
      correctTool: "find_element",
      correctArgs: { searchText: "Submit" },
    });

    expect(result.expected.toolCalls).toHaveLength(1);
    expect(result.expected.toolCalls[0].toolName).toBe("find_element");
    expect(result.expected.toolCalls[0].args).toEqual({ searchText: "Submit" });
  });

  test("--correct-tool creates tool call when none existed", () => {
    const result = extractGoldenCase("test-session", 2, {
      correctTool: "read_page",
      correctArgs: {},
    });

    // Turn 2 has done() but we override to read_page
    expect(result.expected.toolCalls).toHaveLength(1);
    expect(result.expected.toolCalls[0].toolName).toBe("read_page");
  });

  test("pathology tag is set in metadata", () => {
    const result = extractGoldenCase("test-session", 1, {
      tag: "find_element_loop",
    });

    expect(result.metadata.pathology).toBe("find_element_loop");
    expect(result.metadata.tags).toContain("find_element_loop");
    expect(result.metadata.tags).toContain("golden");
  });

  test("missing session throws descriptive error", () => {
    expect(() => extractGoldenCase("missing", 1)).toThrow(
      "No session found matching: missing",
    );
  });

  test("missing turn throws descriptive error with available turns", () => {
    expect(() => extractGoldenCase("test-session", 999)).toThrow(
      /Turn 999 not found/,
    );
  });

  test("turn with no system prompt throws error", () => {
    expect(() => extractGoldenCase("test-session", 99)).toThrow(
      /no system prompt/,
    );
  });

  test("custom id is used when provided", () => {
    const result = extractGoldenCase("test-session", 1, {
      id: "custom-case-id-001",
    });

    expect(result.id).toBe("custom-case-id-001");
  });
});
