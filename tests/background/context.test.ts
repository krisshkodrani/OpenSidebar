/**
 * Context Manager Tests
 * Tests for token-based sliding window, message grouping,
 * scroll indicator, and action trace summarization.
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
        visibleContent: "Some text",
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
        visibleContent: "Some text",
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
        visibleContent: "Some text",
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
        visibleContent: "",
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
        visibleContent: "Some text",
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
        visibleContent: "content",
        scrollPosition: { scrollTop: 0, scrollHeight: 1000, clientHeight: 800 },
      });

      context.clear();

      const prompt = context.getPrompt();
      const nonSystem = prompt.filter(m => m.role !== "system");
      expect(nonSystem).toHaveLength(0);

      // System prompt should NOT contain snapshot URL (note: template has "user@example.com" in tool examples)
      const system = prompt.find(m => m.role === "system");
      expect(system!.content).not.toContain("URL: https://example.com");
    });
  });

  describe("Persona", () => {
    test("executor persona appears by default", () => {
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("You are the execution model");
      expect(systemContent).not.toContain("You are the reasoning model");
    });

    test("planner persona appears after setModelTier('planner')", () => {
      context.setModelTier("planner");
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("You are the reasoning model");
      expect(systemContent).not.toContain("You are the execution model");
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
      expect(systemContent).toContain("Investigation protocol");
      expect(systemContent).toContain("inspect_hidden");
      expect(systemContent).toContain("read_element reads attributes");
    });

    test("system prompt contains page assist tool guidance", () => {
      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("xray_page");
    });
  });

  describe("Turn-Count Compression Triggers", () => {
    test("LIGHT triggers at 30 messages", () => {
      // Use a large context window so utilization-based compression won't trigger
      const bigContext = new ContextManager(500000);
      bigContext.setSnapshot({
        title: "Test",
        url: "https://example.com",
        elements: [],
        visibleContent: "text",
        viewport: { width: 1280, height: 800 },
      });

      // Add 30 messages to reach the LIGHT threshold
      for (let i = 0; i < 30; i++) {
        bigContext.addMessage(userMsg(`msg ${i}`));
      }

      const level = bigContext.getCompressionLevel();
      expect(level).toBe("light");
    });

    test("MEDIUM triggers at 60 messages", () => {
      const bigContext = new ContextManager(500000);
      bigContext.setSnapshot({
        title: "Test",
        url: "https://example.com",
        elements: [],
        visibleContent: "text",
        viewport: { width: 1280, height: 800 },
      });

      for (let i = 0; i < 60; i++) {
        bigContext.addMessage(userMsg(`msg ${i}`));
      }

      const level = bigContext.getCompressionLevel();
      expect(level).toBe("medium");
    });

    test("HEAVY triggers at 100 messages and reduces history", () => {
      const bigContext = new ContextManager(500000);
      bigContext.setSnapshot({
        title: "Test",
        url: "https://example.com",
        elements: [],
        visibleContent: "text",
        viewport: { width: 1280, height: 800 },
      });

      // Add first user message
      bigContext.addMessage(userMsg("ORIGINAL GOAL"));

      // Add enough messages to guarantee HEAVY triggers
      // Need to keep adding until we actually hit HEAVY (prior compressions reduce count)
      for (let i = 1; i < 200; i++) {
        bigContext.addMessage(userMsg(`msg ${i}`));
      }

      // After all the compressions, history should be heavily compacted
      const messages = bigContext.getMessages();
      expect(messages.length).toBeLessThan(100);

      // First user message should be preserved
      const firstUser = messages.find(m => m.role === "user" && m.content === "ORIGINAL GOAL");
      expect(firstUser).toBeDefined();
    });

    test("turn-count overrides utilization when context window is large", () => {
      // Even with a massive context window (low utilization), 60 messages should trigger MEDIUM
      const hugeContext = new ContextManager(1000000);
      hugeContext.setSnapshot({
        title: "Test",
        url: "https://example.com",
        elements: [],
        visibleContent: "text",
        viewport: { width: 1280, height: 800 },
      });

      for (let i = 0; i < 60; i++) {
        hugeContext.addMessage(userMsg(`short msg ${i}`));
      }

      // Utilization would be ~0.01 (well below 0.5), but turn count forces MEDIUM
      const level = hugeContext.getCompressionLevel();
      expect(level).toBe("medium");
    });

    test("MEDIUM truncates old tool results", () => {
      const bigContext = new ContextManager(500000);
      bigContext.setSnapshot({
        title: "Test",
        url: "https://example.com",
        elements: [],
        visibleContent: "text",
        viewport: { width: 1280, height: 800 },
      });

      // Add an early tool call/result pair with a long result
      bigContext.addMessage(toolCallMsg("early_call", "click_element"));
      const longResult = "Success: " + "x".repeat(400);
      bigContext.addMessage(toolResultMsg("early_call", longResult));

      // Add 5 more tool call/result pairs so 'early_call' falls outside preserveRecent=4
      for (let i = 1; i <= 5; i++) {
        bigContext.addMessage(toolCallMsg(`filler_call_${i}`, "scroll_page"));
        bigContext.addMessage(toolResultMsg(`filler_call_${i}`, `Scrolled ${i}`));
      }

      // Fill to 60 to trigger MEDIUM (LIGHT at 30 will have run first with limit=300)
      for (let i = 12; i < 60; i++) {
        bigContext.addMessage(userMsg(`filler ${i}`));
      }

      // After both LIGHT (300 limit) and MEDIUM (100 limit), early tool result should be compressed
      const messages = bigContext.getMessages();
      const earlyResult = messages.find(
        m => m.role === "tool" && m.tool_call_id === "early_call",
      );
      if (earlyResult && typeof earlyResult.content === "string") {
        // Should have been compressed (original was 409 chars)
        expect(earlyResult.content.length).toBeLessThan(400);
        expect(earlyResult.content).toMatch(/\[(truncated|compressed)\]/);
      }
    });
  });

  describe("Valid Element IDs", () => {
    test("valid IDs line appears in system prompt when elements exist", () => {
      context.setSnapshot({
        title: "Test",
        url: "https://example.com",
        elements: [
          { tagName: "button", tag: 5, text: "Submit", isVisible: true, attributes: {} },
          { tagName: "input", tag: 12, text: "", isVisible: true, attributes: { type: "text" } },
        ],
        visibleContent: "content",
        viewport: { width: 1280, height: 800 },
      });

      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).toContain("Valid element IDs: [5,12]");
    });

    test("valid IDs line absent when no elements", () => {
      context.setSnapshot({
        title: "Test",
        url: "https://example.com",
        elements: [],
        visibleContent: "content",
        viewport: { width: 1280, height: 800 },
      });

      const prompt = context.getPrompt();
      const systemContent = prompt[0].content as string;
      expect(systemContent).not.toContain("Valid element IDs:");
    });
  });

  describe("Plan Status with Results", () => {
    test("formatPlanStatus shows result arrows for completed steps", () => {
      context.setPlanStatus(
        [
          { description: "Step 1", status: "completed", completedAtUrl: "https://example.com/a", result: "Found the button" },
          { description: "Step 2", status: "completed", completedAtUrl: "https://example.com/b", result: "Clicked submit" },
          { description: "Step 3", status: "running" },
        ],
        2,
      );

      const prompt = context.getPrompt();
      const sys = prompt[0].content as string;
      expect(sys).toContain("→ Found the button");
      expect(sys).toContain("→ Clicked submit");
      expect(sys).toContain("Step 3");
    });

    test("formatPlanStatus omits arrow when no result", () => {
      context.setPlanStatus(
        [
          { description: "Step 1", status: "completed", completedAtUrl: "https://example.com/a" },
          { description: "Step 2", status: "running" },
        ],
        1,
      );

      const prompt = context.getPrompt();
      const sys = prompt[0].content as string;
      // The done-item line should NOT have a result arrow
      const doneLineMatch = sys.match(/1-Step 1.*/);
      expect(doneLineMatch).not.toBeNull();
      expect(doneLineMatch![0]).not.toContain("→");
    });

    test("summarizeTrajectory includes plan state", () => {
      context.setPlanStatus(
        [
          { description: "Step A", status: "completed", result: "Done" },
          { description: "Step B", status: "running" },
        ],
        1,
      );
      context.addMessage(userMsg("Do the task"));

      context.summarizeTrajectory("Do the task");

      const messages = context.getMessages();
      const planMsg = messages.find(
        (m) => typeof m.content === "string" && m.content.includes("Plan"),
      );
      expect(planMsg).toBeDefined();
      expect(planMsg!.content as string).toContain("Step A");
      expect(planMsg!.content as string).toContain("Step B");
    });
  });
});

// --- Position hint tests (formatElementCompact) ---
import {
  formatElementCompact,
  formatSnapshotElements,
} from "../../src/background/agent/context";
import { TaggedElement } from "../../src/types";

function makeElement(
  overrides: Partial<TaggedElement> = {},
): TaggedElement {
  return {
    tag: 1,
    tagName: "button",
    role: "button",
    text: "Submit",
    attributes: {},
    rect: { x: 100, y: 200, width: 80, height: 30 },
    isVisible: true,
    isDisabled: false,
    ...overrides,
  };
}

describe("formatElementCompact position hints", () => {
  test("no annotation for elements in the viewport", () => {
    const el = makeElement({ rect: { x: 10, y: 300, width: 80, height: 30 } });
    const result = formatElementCompact(el, "Submit", null, 800);
    expect(result).not.toContain("@y");
    expect(result).not.toContain("^above");
    expect(result).not.toMatch(/v\d+px/);
  });

  test("@y hint for elements above viewport (with pageY)", () => {
    const el = makeElement({ rect: { x: 10, y: -50, width: 80, height: 30, pageY: 950 } });
    const result = formatElementCompact(el, "Header", null, 800);
    expect(result).toContain("@y950");
    expect(result).not.toContain("^above");
  });

  test("@y hint for elements below viewport (with pageY)", () => {
    const el = makeElement({ rect: { x: 10, y: 920, width: 80, height: 30, pageY: 1920 } });
    const result = formatElementCompact(el, "Footer", null, 800);
    expect(result).toContain("@y1920");
    expect(result).not.toMatch(/v\d+px/);
  });

  test("^above fallback for elements above viewport (no pageY)", () => {
    const el = makeElement({ rect: { x: 10, y: -50, width: 80, height: 30 } });
    const result = formatElementCompact(el, "Header", null, 800);
    expect(result).toContain("^above");
  });

  test("v{N}px fallback for elements below viewport (no pageY)", () => {
    const el = makeElement({ rect: { x: 10, y: 920, width: 80, height: 30 } });
    const result = formatElementCompact(el, "Footer", null, 800);
    expect(result).toContain("v120px");
  });

  test("no annotation when viewportHeight is not provided", () => {
    const el = makeElement({ rect: { x: 10, y: 920, width: 80, height: 30 } });
    const result = formatElementCompact(el, "Footer", null);
    expect(result).not.toContain("v120px");
    expect(result).not.toContain("^above");
    expect(result).not.toContain("@y");
  });

  test("element exactly at viewport bottom gets @y hint (with pageY)", () => {
    const el = makeElement({ rect: { x: 10, y: 800, width: 80, height: 30, pageY: 1800 } });
    const result = formatElementCompact(el, "Edge", null, 800);
    expect(result).toContain("@y1800");
  });

  test("element exactly at viewport bottom gets v0px (no pageY)", () => {
    const el = makeElement({ rect: { x: 10, y: 800, width: 80, height: 30 } });
    const result = formatElementCompact(el, "Edge", null, 800);
    expect(result).toContain("v0px");
  });
});

describe("formatSnapshotElements with viewport", () => {
  test("passes viewportHeight to each element", () => {
    const elements: TaggedElement[] = [
      makeElement({ tag: 1, rect: { x: 10, y: 100, width: 80, height: 30 } }),
      makeElement({
        tag: 2,
        tagName: "input",
        role: "textbox",
        text: "Email",
        rect: { x: 10, y: 900, width: 200, height: 30, pageY: 2100 },
      }),
    ];
    const result = formatSnapshotElements(elements, 600);
    // First element in viewport — no hint
    expect(result).toContain('[1] button "Submit"');
    // Second element off-screen — @y hint from pageY
    expect(result).toContain("@y2100");
  });
});

// --- Form batch hint tests ---
describe("Form batch hint", () => {
  function makeInputElement(tag: number, tagName = "input", role = "textbox"): TaggedElement {
    return {
      tag,
      tagName,
      role,
      text: "",
      attributes: { type: "text" },
      rect: { x: 10, y: tag * 50, width: 200, height: 30 },
      isVisible: true,
      isDisabled: false,
    };
  }

  test("system message contains batch hint when 4 input fields visible", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot({
      title: "Signup Form",
      url: "https://example.com/signup",
      elements: [
        makeInputElement(1),
        makeInputElement(2),
        makeInputElement(3),
        makeInputElement(4),
        { tag: 5, tagName: "button", role: "button", text: "Submit", attributes: {}, rect: { x: 10, y: 250, width: 80, height: 30 }, isVisible: true, isDisabled: false },
      ],
      visibleContent: "Sign up for an account",
      viewport: { width: 1280, height: 800 },
    });

    const prompt = ctx.getPrompt();
    const systemContent = prompt[0].content as string;
    expect(systemContent).toContain("Batch hint");
    expect(systemContent).toContain("4 input fields");
    expect(systemContent).toContain("type_text");
  });

  test("system message does NOT contain batch hint with only 1 input field", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot({
      title: "Search Page",
      url: "https://example.com/search",
      elements: [
        makeInputElement(1),
        { tag: 2, tagName: "button", role: "button", text: "Search", attributes: {}, rect: { x: 10, y: 100, width: 80, height: 30 }, isVisible: true, isDisabled: false },
      ],
      visibleContent: "Search results",
      viewport: { width: 1280, height: 800 },
    });

    const prompt = ctx.getPrompt();
    const systemContent = prompt[0].content as string;
    expect(systemContent).not.toContain("Batch hint");
  });

  test("system message contains batch hint with 3 textarea elements", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot({
      title: "Feedback Form",
      url: "https://example.com/feedback",
      elements: [
        makeInputElement(1, "textarea", "textbox"),
        makeInputElement(2, "textarea", "textbox"),
        makeInputElement(3, "textarea", "textbox"),
      ],
      visibleContent: "Tell us what you think",
      viewport: { width: 1280, height: 800 },
    });

    const prompt = ctx.getPrompt();
    const systemContent = prompt[0].content as string;
    expect(systemContent).toContain("Batch hint");
    expect(systemContent).toContain("3 input fields");
  });
});
