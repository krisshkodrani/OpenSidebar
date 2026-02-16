/**
 * Context Manager Tests
 * Tests for token-based sliding window, message grouping,
 * scroll indicator, and action trace summarization.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";

// Mock chrome APIs
globalThis.chrome = {
  storage: {
    session: {
      get: mock(async () => ({})),
      set: mock(async () => {}),
    },
  },
} as any;

// Import after mocking
import { ContextManager } from "../../src/background/agent/context";
import { LLMMessage } from "../../src/background/llm/types";

describe("ContextManager", () => {
  let context: ContextManager;

  beforeEach(() => {
    context = new ContextManager();
    // Reset mocks
    (chrome.storage.session.set as any).mockClear();
  });

  // Helper to create messages
  const userMsg = (content: string): LLMMessage => ({
    role: "user",
    content,
  });
  const asstMsg = (content: string): LLMMessage => ({
    role: "assistant",
    content,
  });
  const toolCallMsg = (toolId: string, fnName: string = "test"): LLMMessage => ({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: toolId,
        type: "function",
        function: { name: fnName, arguments: "{}" },
      },
    ],
  });
  const toolResultMsg = (toolId: string, content: string): LLMMessage => ({
    role: "tool",
    tool_call_id: toolId,
    content,
  });

  describe("Token Estimation (Basic)", () => {
    test("getPrompt returns system message", () => {
      const prompt = context.getPrompt();
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt[0].role).toBe("system");
    });

    test("respects token budget (simulated)", () => {
      // Add many long messages
      const longText = "a".repeat(1000); // ~250 tokens
      for (let i = 0; i < 30; i++) {
        context.addMessage(userMsg(longText));
      }

      const prompt = context.getPrompt();

      // Total should be around 6000 tokens max.
      // 30 * 250 = 7500 tokens > 6000.
      // Should truncate.
      expect(prompt.length).toBeLessThan(32); // System + 30 user messages = 31. Should be less.
    });
  });

  describe("Goal Amnesia Prevention", () => {
    test("always keeps the first user message", () => {
      context.addMessage(userMsg("FIRST_MESSAGE"));

      // Fill with filler
      const longText = "a".repeat(1000);
      for (let i = 0; i < 50; i++) {
        context.addMessage(asstMsg(longText));
      }

      const prompt = context.getPrompt();
      // Index 0 is system, Index 1 should be first user message
      expect(prompt[1].content).toBe("FIRST_MESSAGE");
    });
  });

  describe("Tool Grouping", () => {
    test("keeps tool call and result together", () => {
      context.addMessage(userMsg("Hi"));
      context.addMessage(toolCallMsg("call_1"));
      context.addMessage(toolResultMsg("call_1", "result"));

      const prompt = context.getPrompt();
      // Should contain both
      const hasCall = prompt.some((m) =>
        m.tool_calls?.some((tc) => tc.id === "call_1"),
      );
      const hasResult = prompt.some(
        (m) => m.role === "tool" && m.tool_call_id === "call_1",
      );

      expect(hasCall).toBe(true);
      expect(hasResult).toBe(true);
    });

    test("retains order of grouped messages", () => {
      context.addMessage(toolCallMsg("call_1"));
      context.addMessage(toolResultMsg("call_1", "result"));

      const prompt = context.getPrompt();
      // Find indices
      const callIdx = prompt.findIndex((m) =>
        m.tool_calls?.some((tc) => tc.id === "call_1"),
      );
      const resIdx = prompt.findIndex(
        (m) => m.role === "tool" && m.tool_call_id === "call_1",
      );

      expect(callIdx).toBeLessThan(resIdx);
    });
  });

  describe("Scroll Indicator", () => {
    test("shows 'more content below' when not at bottom", () => {
      context.setSnapshot({
        title: "Test Page",
        url: "https://example.com",
        elements: [],
        viewportText: "Some text",
        viewport: { width: 1280, height: 800 },
        scroll: { x: 0, y: 500, maxY: 3000 },
      });

      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("more content below");
      expect(systemContent).toContain("500/3000px");
    });

    test("shows 'at bottom of page' when scrolled to end", () => {
      context.setSnapshot({
        title: "Test Page",
        url: "https://example.com",
        elements: [],
        viewportText: "Some text",
        viewport: { width: 1280, height: 800 },
        scroll: { x: 0, y: 3000, maxY: 3000 },
      });

      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("at bottom of page");
      expect(systemContent).not.toContain("more content below");
    });

    test("shows 'all content visible' when page fits viewport", () => {
      context.setSnapshot({
        title: "Test Page",
        url: "https://example.com",
        elements: [],
        viewportText: "Some text",
        viewport: { width: 1280, height: 800 },
        scroll: { x: 0, y: 0, maxY: 0 },
      });

      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("all content visible");
    });

    test("shows correct percentage", () => {
      context.setSnapshot({
        title: "Test Page",
        url: "https://example.com",
        elements: [],
        viewportText: "",
        viewport: { width: 1280, height: 800 },
        scroll: { x: 0, y: 1500, maxY: 3000 },
      });

      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("50% down");
    });

    test("no scroll indicator when no snapshot", () => {
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      // Should not contain scroll info, and no leftover placeholder
      expect(systemContent).not.toContain("{{scrollIndicator}}");
    });
  });

  describe("Action Trace Summarization", () => {
    test("compresses old tool results beyond 2 most recent", () => {
      // Add 4 tool call/result pairs
      for (let i = 1; i <= 4; i++) {
        context.addMessage(toolCallMsg(`call_${i}`));
        const longResult = `Success: Step ${i} completed.\n${"Detail line.\n".repeat(50)}`;
        context.addMessage(toolResultMsg(`call_${i}`, longResult));
      }

      const prompt = context.getPrompt();
      const toolResults = prompt.filter((m) => m.role === "tool");

      // The 2 most recent should be preserved (call_3, call_4)
      // Older ones should be truncated
      for (const result of toolResults) {
        if (
          result.tool_call_id === "call_3" ||
          result.tool_call_id === "call_4"
        ) {
          // Recent — should be full
          expect(result.content!.length).toBeGreaterThan(150);
        } else if (
          result.tool_call_id === "call_1" ||
          result.tool_call_id === "call_2"
        ) {
          // Old — should be truncated
          expect(result.content).toContain("[truncated]");
          expect(result.content!.length).toBeLessThan(200);
        }
      }
    });

    test("preserves all results when only 2 tool calls exist", () => {
      const longResult = `Success: completed.\n${"Detail line.\n".repeat(50)}`;

      context.addMessage(toolCallMsg("call_1"));
      context.addMessage(toolResultMsg("call_1", longResult));
      context.addMessage(toolCallMsg("call_2"));
      context.addMessage(toolResultMsg("call_2", longResult));

      const prompt = context.getPrompt();
      const toolResults = prompt.filter((m) => m.role === "tool");

      // Both should be fully preserved (only 2, within threshold)
      for (const result of toolResults) {
        expect(result.content).not.toContain("[truncated]");
      }
    });

    test("does not truncate short tool results", () => {
      // Add 5 pairs but with short results
      for (let i = 1; i <= 5; i++) {
        context.addMessage(toolCallMsg(`call_${i}`));
        context.addMessage(toolResultMsg(`call_${i}`, `OK step ${i}`));
      }

      const prompt = context.getPrompt();
      const toolResults = prompt.filter((m) => m.role === "tool");

      // All short results should be preserved (< 150 chars)
      for (const result of toolResults) {
        expect(result.content).not.toContain("[truncated]");
      }
    });

    test("preserves discovery tool results with higher limit", () => {
      // Old discovery tool call with a 400-char result (under 500 limit)
      context.addMessage(toolCallMsg("call_disc", "inspect_hidden"));
      const discoveryResult = "Found 5 hidden elements:\n" + "x".repeat(374);
      context.addMessage(toolResultMsg("call_disc", discoveryResult)); // 400 chars

      // Add 3 more tool results to push the discovery one past preserveRecent=2
      for (let i = 1; i <= 3; i++) {
        context.addMessage(toolCallMsg(`call_${i}`, "click_element"));
        context.addMessage(toolResultMsg(`call_${i}`, `Clicked element ${i}`));
      }

      const prompt = context.getPrompt();
      const discResult = prompt.find(
        (m) => m.role === "tool" && m.tool_call_id === "call_disc",
      );

      // 400 chars < 500 limit — should NOT be truncated
      expect(discResult).toBeDefined();
      expect(discResult!.content).not.toContain("[truncated]");
    });

    test("truncates discovery tool results above 500 chars", () => {
      // Old discovery tool call with a 600-char single-line result (over 500 limit)
      context.addMessage(toolCallMsg("call_js", "execute_js"));
      const longResult = "Computed values: " + "y".repeat(583);
      context.addMessage(toolResultMsg("call_js", longResult)); // 600 chars

      // Push past preserveRecent
      for (let i = 1; i <= 3; i++) {
        context.addMessage(toolCallMsg(`call_${i}`, "click_element"));
        context.addMessage(toolResultMsg(`call_${i}`, `Clicked element ${i}`));
      }

      const prompt = context.getPrompt();
      const jsResult = prompt.find(
        (m) => m.role === "tool" && m.tool_call_id === "call_js",
      );

      expect(jsResult).toBeDefined();
      expect(jsResult!.content).toContain("[truncated]");
      // Snippet should be 400 chars (discovery snippet limit), longer than action's 100
      const snippetLength = jsResult!.content!.replace(" [truncated]", "").length;
      expect(snippetLength).toBeGreaterThan(100);
      expect(snippetLength).toBeLessThanOrEqual(400);
    });

    test("action tool results still truncate at 150 chars", () => {
      // Old action tool call with a 200-char result
      context.addMessage(toolCallMsg("call_click", "click_element"));
      const actionResult = "Clicked successfully.\n" + "z".repeat(179);
      context.addMessage(toolResultMsg("call_click", actionResult)); // 200 chars

      // Push past preserveRecent
      for (let i = 1; i <= 3; i++) {
        context.addMessage(toolCallMsg(`call_${i}`, "type_text"));
        context.addMessage(toolResultMsg(`call_${i}`, `Typed text ${i}`));
      }

      const prompt = context.getPrompt();
      const clickResult = prompt.find(
        (m) => m.role === "tool" && m.tool_call_id === "call_click",
      );

      expect(clickResult).toBeDefined();
      expect(clickResult!.content).toContain("[truncated]");
      // Snippet should be at most 100 chars + " [truncated]"
      expect(clickResult!.content!.length).toBeLessThanOrEqual(112);
    });
  });

  describe("clearHistory", () => {
    test("clears history but preserves snapshot", () => {
      // Add some messages
      context.addMessage(userMsg("Hello"));
      context.addMessage(asstMsg("Hi there"));

      // Set a snapshot
      context.setSnapshot({
        url: "https://example.com",
        title: "Example",
        elements: [
          { tagName: "button", id: 1, text: "Click me", isVisible: true, attributes: {} },
        ],
        viewportText: "Some text",
        scrollPosition: { scrollTop: 0, scrollHeight: 1000, clientHeight: 800 },
      });

      // Verify we have messages + snapshot
      const promptBefore = context.getPrompt();
      expect(promptBefore.length).toBeGreaterThan(1); // system + user + assistant

      // Clear history
      context.clearHistory();

      // History should be empty (only system prompt remains)
      const promptAfter = context.getPrompt();
      const nonSystemMessages = promptAfter.filter(m => m.role !== "system");
      expect(nonSystemMessages).toHaveLength(0);

      // Snapshot should still be present (system prompt mentions elements)
      const systemPrompt = promptAfter.find(m => m.role === "system");
      expect(systemPrompt!.content).toContain("example.com");
    });

    test("clear() wipes both history and snapshot", () => {
      context.addMessage(userMsg("Hello"));
      context.setSnapshot({
        url: "https://example.com",
        title: "Example",
        elements: [
          { tagName: "button", id: 1, text: "Click me", isVisible: true, attributes: {} },
        ],
        viewportText: "content",
        scrollPosition: { scrollTop: 0, scrollHeight: 1000, clientHeight: 800 },
      });

      context.clear();

      const prompt = context.getPrompt();
      const nonSystem = prompt.filter(m => m.role !== "system");
      expect(nonSystem).toHaveLength(0);

      // System prompt should NOT contain snapshot data
      const system = prompt.find(m => m.role === "system");
      expect(system!.content).not.toContain("example.com");
    });
  });

  describe("Persona", () => {
    test("fast persona appears by default", () => {
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("sharp, resourceful web automation expert");
      expect(systemContent).not.toContain("seasoned systems thinker");
    });

    test("smart persona appears after setModelTier('smart')", () => {
      context.setModelTier("smart");
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("seasoned systems thinker");
      expect(systemContent).not.toContain("sharp, resourceful web automation expert");
    });
  });

  describe("Plan Instructions Conditionalization", () => {
    test("Multi-Step Planning section absent when no plan set", () => {
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).not.toContain("Multi-Step Planning");
      expect(systemContent).not.toContain("Active Plan");
    });

    test("Multi-Step Planning section present when plan is set", () => {
      context.setPlanStatus(
        [
          { description: "Step 1", status: "running" },
          { description: "Step 2", status: "pending" },
        ],
        0,
      );
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("Multi-Step Planning");
      expect(systemContent).toContain("Only call done() when ALL steps are completed");
      // Also verify the Active Plan section is present
      expect(systemContent).toContain("Active Plan");
      expect(systemContent).toContain("Step 1");
    });
  });

  describe("Investigation Guidance", () => {
    test("system prompt contains investigation guidance", () => {
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("Investigation:");
      expect(systemContent).toContain("inspect_hidden");
      expect(systemContent).toContain("read_element reads attributes");
    });

    test("system prompt contains React toolkit guidance", () => {
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("React:");
      expect(systemContent).toContain("inspect_react");
      expect(systemContent).toContain("react_set_input");
      expect(systemContent).toContain("inspect_react_tree");
    });

    test("system prompt contains page assist tool guidance", () => {
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("xray_page");
      expect(systemContent).toContain("fast_forward");
      expect(systemContent).toContain("countdown");
    });
  });
});
