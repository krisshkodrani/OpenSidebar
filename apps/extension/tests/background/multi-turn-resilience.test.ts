/**
 * Multi-Turn Conversation Resilience Tests
 * Tests for S1 (rolling distillation), S2 (pinned goal), S5 (causal chain summary).
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

// Mock chrome APIs
globalThis.chrome = {
  storage: {
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
    },
  },
} as any;

// Import after mocking
import { ContextManager, summarizeCausalChain } from "../../src/background/agent/context";
import { LLMMessage } from "../../src/background/llm/types";

// Helper message builders
const userMsg = (content: string): LLMMessage => ({ role: "user", content });
const asstMsg = (content: string): LLMMessage => ({ role: "assistant", content });
const toolCallMsg = (toolId: string, fnName: string, args = "{}"): LLMMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id: toolId, type: "function", function: { name: fnName, arguments: args } }],
});
const toolResultMsg = (toolId: string, content: string): LLMMessage => ({
  role: "tool",
  tool_call_id: toolId,
  content,
});

describe("summarizeCausalChain", () => {
  test("returns empty array for empty messages", () => {
    expect(summarizeCausalChain([])).toEqual([]);
  });

  test("returns empty array for messages with no tool calls", () => {
    const msgs: LLMMessage[] = [
      userMsg("hello"),
      asstMsg("hi there"),
    ];
    expect(summarizeCausalChain(msgs)).toEqual([]);
  });

  test("groups action+result into single lines", () => {
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "click_element", '{"id": 5}'),
      toolResultMsg("tc1", "Clicked element [5]"),
      toolCallMsg("tc2", "type_text", '{"id": 3, "text": "hello world"}'),
      toolResultMsg("tc2", "Typed text into element [3]"),
    ];
    const result = summarizeCausalChain(msgs);
    const joined = result.join("\n");
    expect(joined).toContain("T1: click_element [5]");
    expect(joined).toContain("Clicked element [5]");
    expect(joined).toContain("T2: type_text [3]");
    expect(joined).toContain('"hello world"');
  });

  test("marks errors in result text", () => {
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "click_element", '{"id": 99}'),
      toolResultMsg("tc1", "Error: Element not found"),
    ];
    const result = summarizeCausalChain(msgs);
    const joined = result.join("\n");
    expect(joined).toContain("Error:");
    expect(joined).toContain("Element not found");
  });

  test("skips wait tool", () => {
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "wait", '{"ms": 1000}'),
      toolResultMsg("tc1", "Waited 1000ms"),
      toolCallMsg("tc2", "click_element", '{"id": 1}'),
      toolResultMsg("tc2", "Clicked"),
    ];
    const result = summarizeCausalChain(msgs);
    const joined = result.join("\n");
    expect(joined).not.toContain("wait");
    expect(joined).toContain("T1: click_element");
  });

  test("respects maxEntries cap", () => {
    const msgs: LLMMessage[] = [];
    for (let i = 0; i < 20; i++) {
      msgs.push(toolCallMsg(`tc${i}`, "click_element", `{"id": ${i}}`));
      msgs.push(toolResultMsg(`tc${i}`, `Clicked element [${i}]`));
    }
    const result = summarizeCausalChain(msgs, 5);
    expect(result.length).toBe(5);
    expect(result[0]).toContain("T1:");
    expect(result[4]).toContain("T5:");
  });

  test("resolves url arguments", () => {
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "navigate", '{"url": "https://example.com/page"}'),
      toolResultMsg("tc1", "Navigated to https://example.com/page"),
    ];
    const result = summarizeCausalChain(msgs);
    const joined = result.join("\n");
    expect(joined).toContain("https://example.com/page");
  });

  test("handles malformed JSON args gracefully", () => {
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "click_element", "not json"),
      toolResultMsg("tc1", "Clicked"),
    ];
    const result = summarizeCausalChain(msgs);
    const joined = result.join("\n");
    expect(joined).toContain("T1: click_element");
    expect(joined).toContain("Clicked");
  });
});

describe("ContextManager.rollingDistill", () => {
  let context: ContextManager;

  beforeEach(() => {
    context = new ContextManager();
    (chrome.storage.session.set as any).mockClear();
  });

  test("returns false when history is too short", () => {
    context.addMessage(userMsg("hello"));
    context.addMessage(asstMsg("hi"));
    expect(context.rollingDistill(6, 15)).toBe(false);
  });

  test("preserves original query (first user message)", () => {
    // Add enough messages to trigger distillation
    context.addMessage(userMsg("Find the blue button"));
    for (let i = 0; i < 10; i++) {
      context.addMessage(toolCallMsg(`tc${i}`, "click_element", `{"id": ${i}}`));
      context.addMessage(toolResultMsg(`tc${i}`, `Clicked [${i}]`));
    }

    const result = context.rollingDistill(4, 15);
    expect(result).toBe(true);

    const messages = context.getMessages();
    // First message should be the original query
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Find the blue button");
  });

  test("keeps recent messages verbatim", () => {
    context.addMessage(userMsg("original query"));
    for (let i = 0; i < 12; i++) {
      context.addMessage(toolCallMsg(`tc${i}`, "click_element", `{"id": ${i}}`));
      context.addMessage(toolResultMsg(`tc${i}`, `Clicked [${i}]`));
    }
    // Last two tool result messages
    const lastToolResult = toolResultMsg("tc_last", "Final result");
    context.addMessage(toolCallMsg("tc_last", "read_page", "{}"));
    context.addMessage(lastToolResult);

    const beforeCount = context.getMessages().length;
    const result = context.rollingDistill(4, 15);
    expect(result).toBe(true);

    const messages = context.getMessages();
    // LP-21 §6: the shape is [pinned goal, ...summary chain, ...4 recent].
    // The chain can hold more than one entry — a threshold compaction may
    // already have written one — but the goal and the recent tail are fixed.
    expect(messages.length).toBeLessThan(beforeCount);
    expect(messages[0].content).toBe("original query");
    expect(messages[messages.length - 1]).toBe(lastToolResult);
    const summaries = messages.slice(1, -4);
    expect(summaries.length).toBeGreaterThanOrEqual(1);
    for (const s of summaries) {
      expect(s.role).toBe("user");
      expect(String(s.content)).toMatch(/^\[(DISTILLED|COMPRESSED) HISTORY/);
    }
  });

  test("inserts distilled summary block", () => {
    context.addMessage(userMsg("original query"));
    for (let i = 0; i < 10; i++) {
      context.addMessage(toolCallMsg(`tc${i}`, "click_element", `{"id": ${i}}`));
      context.addMessage(toolResultMsg(`tc${i}`, `Clicked [${i}]`));
    }

    context.rollingDistill(4, 15);

    const messages = context.getMessages();
    // The distilled block is APPENDED to the summary chain, so it is the newest
    // summary rather than always index 1 (LP-21 §6 rule 3: summaries are
    // immutable — a later pass never rewrites an earlier one).
    const summaryMsg = messages.find((m) =>
      String(m.content).includes("[DISTILLED HISTORY"),
    );
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg!.role).toBe("user");
    expect(summaryMsg!.content).toContain("click_element");
  });
});

describe("Pinned Goal (S2)", () => {
  let context: ContextManager;

  beforeEach(() => {
    context = new ContextManager();
    (chrome.storage.session.set as any).mockClear();
  });

  test("system prompt contains pinned goal when set", () => {
    context.setOriginalQuery("Click the submit button");
    const prompt = context.getPrompt();
    const systemContent = prompt[0].content as string;
    expect(systemContent).toContain("## Current Task");
    expect(systemContent).toContain("Click the submit button");
    expect(systemContent).toContain("Stay focused on this goal");
  });

  test("system prompt has no pinned goal when not set", () => {
    const prompt = context.getPrompt();
    const systemContent = prompt[0].content as string;
    expect(systemContent).not.toContain("## Current Task");
    expect(systemContent).not.toContain("Stay focused on this goal");
  });

  test("pinned goal updates when setOriginalQuery is called again", () => {
    context.setOriginalQuery("First task");
    let prompt = context.getPrompt();
    expect((prompt[0].content as string)).toContain("First task");

    context.setOriginalQuery("Second task");
    prompt = context.getPrompt();
    expect((prompt[0].content as string)).toContain("Second task");
    expect((prompt[0].content as string)).not.toContain("First task");
  });
});

describe("summarizeCausalChain failure highlighting", () => {
  test("prefixes failures with warning symbol", () => {
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "click_element", '{"id": 5}'),
      toolResultMsg("tc1", "Error: Click intercepted! Element [5] is covered by [10] <div>."),
    ];
    const result = summarizeCausalChain(msgs);
    expect(result[0]).toMatch(/^\u26A0 T1:/);
  });

  test("uses 160 char limit for failure outcomes", () => {
    const longError = "Error: " + "x".repeat(200);
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "click_element", '{"id": 5}'),
      toolResultMsg("tc1", longError),
    ];
    const result = summarizeCausalChain(msgs);
    // Outcome should be truncated to 160 chars (from first line)
    const arrowIdx = result[0].indexOf("\u2192");
    const outcome = result[0].slice(arrowIdx + 2);
    expect(outcome.length).toBeLessThanOrEqual(160);
    expect(outcome.length).toBeGreaterThan(80);
  });

  test("uses 80 char limit for success outcomes", () => {
    const longSuccess = "Clicked " + "x".repeat(200);
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "click_element", '{"id": 5}'),
      toolResultMsg("tc1", longSuccess),
    ];
    const result = summarizeCausalChain(msgs);
    const arrowIdx = result[0].indexOf("\u2192");
    const outcome = result[0].slice(arrowIdx + 2);
    expect(outcome.length).toBeLessThanOrEqual(80);
  });

  test("does not prefix success entries with warning", () => {
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "click_element", '{"id": 5}'),
      toolResultMsg("tc1", "Clicked element [5]"),
    ];
    const result = summarizeCausalChain(msgs);
    expect(result[0]).not.toContain("\u26A0");
    expect(result[0]).toMatch(/^T1:/);
  });

  test("detects 'No element with tag' as failure", () => {
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "click_element", '{"id": 99}'),
      toolResultMsg("tc1", "No element with tag [99]. Nearby IDs: [1], [2]."),
    ];
    const result = summarizeCausalChain(msgs);
    expect(result[0]).toMatch(/^\u26A0 T1:/);
  });

  test("detects 'does not appear to be' as failure", () => {
    const msgs: LLMMessage[] = [
      toolCallMsg("tc1", "type_text", '{"id": 5, "text": "hello"}'),
      toolResultMsg("tc1", "Element [5] does not appear to be a text input"),
    ];
    const result = summarizeCausalChain(msgs);
    expect(result[0]).toMatch(/^\u26A0 T1:/);
  });
});
