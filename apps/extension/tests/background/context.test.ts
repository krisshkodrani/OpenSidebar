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

/**
 * LP-21: volatile page state no longer lives in the system message — it is
 * emitted as a trailing user message so the system message stays byte-stable
 * across a run and the cache prefix survives.
 *
 * Assertions about rendered prompt CONTENT (does the text appear at all?) use
 * this helper. Assertions about PLACEMENT use systemOf/volatileTailOf — see
 * the "Stable prefix (LP-21)" block at the end of this file.
 */
function renderedPrompt(prompt: LLMMessage[]): string {
  return prompt
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
}

/** The run-stable system message (regions A + B). */
function systemOf(prompt: LLMMessage[]): string {
  return typeof prompt[0]?.content === "string" ? prompt[0].content : "";
}

/** The per-turn volatile tail (region C), or "" when absent. */
function volatileTailOf(prompt: LLMMessage[]): string {
  const last = prompt[prompt.length - 1];
  if (!last || last === prompt[0] || last.role !== "user") return "";
  return typeof last.content === "string" ? last.content : "";
}

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

      // Ceiling check: system + at most 30 history messages + the LP-21
      // volatile tail. (This bound was `< 32` before the tail existed; it has
      // always been a ceiling rather than proof that truncation fired.)
      expect(prompt.length).toBeLessThanOrEqual(32);
      const history = prompt.filter(
        (m, i) => m.role !== "system" && i !== prompt.length - 1,
      );
      expect(history.length).toBeLessThanOrEqual(30);
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
      const systemContent = renderedPrompt(prompt);
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
      const systemContent = renderedPrompt(prompt);
      expect(systemContent).toContain("at bottom of page");
      // The scroll indicator line should not contain "more content below"
      // (Note: the phrase may appear elsewhere in the prompt as instructional text)
      const scrollLine = systemContent.split("\n").find(l => l.includes("3000/3000px"));
      expect(scrollLine).toBeDefined();
      expect(scrollLine).not.toContain("more content below");
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
      const systemContent = renderedPrompt(prompt);
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
      const systemContent = renderedPrompt(prompt);
      expect(systemContent).toContain("50% down");
    });

    test("no scroll indicator when no snapshot", () => {
      const prompt = context.getPrompt();
      const systemContent = renderedPrompt(prompt);
      // Should not contain scroll info, and no leftover placeholder
      expect(systemContent).not.toContain("{{scrollIndicator}}");
    });
  });

  describe("Append-only tool results (LP-21 §6)", () => {
    test("keeps old tool results full — no in-place truncation", () => {
      // Several tool call/result pairs with long results, within the short-run
      // window (no threshold compaction fires).
      for (let i = 1; i <= 5; i++) {
        context.addMessage(toolCallMsg(`call_${i}`));
        const longResult = `Success: Step ${i} completed.\n${"Detail line.\n".repeat(50)}`;
        context.addMessage(toolResultMsg(`call_${i}`, longResult));
      }

      const prompt = context.getPrompt();
      const toolResults = prompt.filter((m) => m.role === "tool");

      // History is append-only: older tool results are NOT rewritten/truncated
      // in place. That per-turn mutation was the #1 cache-prefix breaker.
      for (const result of toolResults) {
        expect(result.content).not.toContain("[truncated]");
      }
      // The oldest result still in the window keeps its full bytes.
      const first = toolResults.find((m) => m.tool_call_id === "call_1");
      if (first && typeof first.content === "string") {
        expect(first.content.length).toBeGreaterThan(150);
      }
    });

    test("messages shared by two consecutive turns are byte-identical (§8.4 invariant)", () => {
      const keyOf = (m: LLMMessage): string =>
        m.role === "tool"
          ? `tool:${m.tool_call_id}`
          : `asst:${m.tool_calls?.[0]?.id ?? "none"}`;
      // Only tool/assistant history messages are subject to append-only; the
      // volatile tail (region C) and injected images are intentionally variable.
      const historyOf = (prompt: LLMMessage[]) => {
        const map = new Map<string, string>();
        for (const m of prompt) {
          if (m.role !== "tool" && m.role !== "assistant") continue;
          map.set(keyOf(m), JSON.stringify(m));
        }
        return map;
      };

      for (let i = 1; i <= 4; i++) {
        context.addMessage(toolCallMsg(`call_${i}`));
        context.addMessage(
          toolResultMsg(`call_${i}`, `Result ${i}\n${"line\n".repeat(20)}`),
        );
      }
      const turnN = historyOf(context.getPrompt());

      // Next turn: append one more interaction.
      context.addMessage(toolCallMsg("call_5"));
      context.addMessage(
        toolResultMsg("call_5", `Result 5\n${"line\n".repeat(20)}`),
      );
      const turnNext = historyOf(context.getPrompt());

      // Every message present in BOTH turns must be byte-identical.
      let shared = 0;
      for (const [key, serialized] of turnNext) {
        if (turnN.has(key)) {
          shared++;
          expect(serialized).toBe(turnN.get(key));
        }
      }
      expect(shared).toBeGreaterThan(2); // sanity: real overlap was checked
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

      // History should be empty. LP-21: the trailing volatile message carries
      // page state, not conversation history, so it is excluded from the count.
      const promptAfter = context.getPrompt();
      const history = promptAfter.filter(
        (m, i) => m.role !== "system" && i !== promptAfter.length - 1,
      );
      expect(history).toHaveLength(0);

      // Snapshot survives the clear — and now lives in the volatile tail
      // rather than the system message.
      expect(volatileTailOf(promptAfter)).toContain("example.com");
      expect(systemOf(promptAfter)).not.toContain("URL: https://example.com");
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
      // Conversation history is empty. The LP-21 volatile tail still renders
      // (with the snapshot cleared its sections are empty), so exclude it.
      const history = prompt.filter(
        (m, i) => m.role !== "system" && i !== prompt.length - 1,
      );
      expect(history).toHaveLength(0);

      // Neither region may carry the snapshot URL (note: the template has
      // "user@example.com" in tool examples, hence the specific prefix).
      expect(renderedPrompt(prompt)).not.toContain("URL: https://example.com");
    });
  });

  describe("Persona", () => {
    test("executor persona appears by default", () => {
      const prompt = context.getPrompt();
      const systemContent = renderedPrompt(prompt);
      expect(systemContent).toContain("You are the execution model");
      expect(systemContent).not.toContain("You are the reasoning model");
    });

    test("planner persona appears after setModelTier('planner')", () => {
      context.setModelTier("planner");
      const prompt = context.getPrompt();
      const systemContent = renderedPrompt(prompt);
      expect(systemContent).toContain("You are the reasoning model");
      expect(systemContent).not.toContain("You are the execution model");
    });
  });

  describe("Plan Instructions Conditionalization", () => {
    test("Multi-Step Planning section absent when no plan set", () => {
      const prompt = context.getPrompt();
      const systemContent = renderedPrompt(prompt);
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
      const systemContent = renderedPrompt(prompt);
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
      const systemContent = renderedPrompt(prompt);
      expect(systemContent).toContain("Discovery Rules");
      expect(systemContent).toContain("inspect_hidden");
      expect(systemContent).toContain("read_element");
    });

    test("system prompt contains page assist tool guidance", () => {
      const prompt = context.getPrompt();
      const systemContent = renderedPrompt(prompt);
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
        // Should have been masked (original was 409 chars)
        expect(earlyResult.content.length).toBeLessThan(400);
        // Observation masking format: [T{n}: tool_name → first line]
        expect(earlyResult.content).toMatch(/^\[T\d+:/);
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
      const systemContent = renderedPrompt(prompt);
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
      const systemContent = renderedPrompt(prompt);
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
      const sys = renderedPrompt(prompt);
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
      const sys = renderedPrompt(prompt);
      // The done-item line should NOT have a result arrow
      const doneLineMatch = sys.match(/1-Step 1.*/);
      expect(doneLineMatch).not.toBeNull();
      expect(doneLineMatch![0]).not.toContain("→");
    });

    test("formatPlanStatus hides next-step description", () => {
      context.setPlanStatus(
        [
          { description: "Step 1", status: "completed", completedAtUrl: "https://example.com/a" },
          { description: "Step 2", status: "running" },
          { description: "Step 3", status: "pending" },
        ],
        1,
      );

      const prompt = context.getPrompt();
      const sys = renderedPrompt(prompt);
      expect(sys).toContain("Remaining after this step: 1");
      expect(sys).not.toContain("Next:");
      expect(sys).not.toContain("Next: 3. Step 3");
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

  test("system prompt includes direct-action batching and repeated-click guidance", () => {
    const ctx = new ContextManager();
    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);

    expect(systemContent).toContain(
      "call multiple `type_text`, `select_option`, and `set_checkbox` tools in the same response",
    );
    expect(systemContent).toContain("They execute within one turn");
    expect(systemContent).toContain(
      "call `click_element` once with `count` set to that number",
    );
  });

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
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).toContain("Batch hint");
    expect(systemContent).toContain("4 form controls");
    expect(systemContent).toContain("type_text");
    expect(systemContent).toContain("select_option");
    expect(systemContent).toContain("set_checkbox");
    expect(systemContent).toContain("execute within one turn");
    expect(systemContent).toContain(
      "Do not click Next or Submit unless the user or the current plan step explicitly asks for it.",
    );
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
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).not.toContain("Batch hint");
  });

  test("system message does NOT contain batch hint with only 2 input fields", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot({
      title: "Login Page",
      url: "https://example.com/login",
      elements: [
        makeInputElement(1),
        makeInputElement(2),
      ],
      visibleContent: "Login",
      viewport: { width: 1280, height: 800 },
    });

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
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
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).toContain("Batch hint");
    expect(systemContent).toContain("3 form controls");
    expect(systemContent).toContain(
      "Do not click Next or Submit unless the user or the current plan step explicitly asks for it.",
    );
  });

  test("system message counts checkboxes and selects as batchable form controls", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot({
      title: "Login Page",
      url: "https://example.com/login",
      elements: [
        makeInputElement(1),
        makeInputElement(2, "select", "combobox"),
        {
          tag: 3,
          tagName: "input",
          role: "checkbox",
          text: "Remember me",
          attributes: { type: "checkbox" },
          rect: { x: 10, y: 150, width: 20, height: 20 },
          isVisible: true,
          isDisabled: false,
        },
      ],
      visibleContent: "Login",
      viewport: { width: 1280, height: 800 },
    });

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).toContain("Batch hint");
    expect(systemContent).toContain("3 form controls");
    expect(systemContent).toContain(
      "type_text, select_option, and set_checkbox actions in the same response",
    );
  });

  test("marks compressed textarea values as previews requiring read_element", () => {
    const ctx = new ContextManager(700);
    ctx.setSnapshot({
      title: "Email",
      url: "https://example.com/email",
      elements: [
        {
          ...makeInputElement(1, "textarea", "textbox"),
          text:
            "Hi David, Friday at 10 AM works for me. I reviewed the product roadmap, budget, and hiring agenda items.",
          attributes: { id: "reply-editor" },
        },
      ],
      visibleContent: "Reply composer",
      viewport: { width: 1280, height: 800 },
    });

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).toContain("[preview truncated; use read_element for exact value]");
    expect(systemContent).toContain("Long input and textarea values in Visible Elements may be previews");
  });
});

// --- Attribute Pruning Tests ---
describe("Attribute Pruning Whitelist", () => {
  test("NONE level preserves all attributes including data-* and class", () => {
    const ctx = new ContextManager(500000); // Large window = NONE compression
    ctx.setSnapshot({
      title: "Test",
      url: "https://example.com",
      elements: [
        {
          tag: 1,
          tagName: "button",
          role: "button",
          text: "Submit",
          attributes: {
            type: "submit",
            class: "btn btn-primary",
            "data-testid": "submit-btn",
            "data-analytics": "click-submit",
            style: "color: red",
          },
          rect: { x: 10, y: 100, width: 80, height: 30 },
          isVisible: true,
          isDisabled: false,
        },
      ],
      visibleContent: "content",
      viewport: { width: 1280, height: 800 },
    });

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    // NONE compression: all attributes pass through unfiltered
    expect(systemContent).toContain("type=submit");
    expect(systemContent).toContain("btn-primary");
    expect(systemContent).toContain("data-testid");
    expect(systemContent).toContain("data-analytics");
    expect(systemContent).toContain("style");
  });

  test("action-relevant attrs like href, placeholder are preserved at NONE", () => {
    const ctx = new ContextManager(500000);
    ctx.setSnapshot({
      title: "Test",
      url: "https://example.com",
      elements: [
        {
          tag: 1,
          tagName: "input",
          role: "textbox",
          text: "",
          attributes: {
            type: "email",
            placeholder: "Enter email",
            name: "email",
            required: "true",
            "aria-label": "Email address",
          },
          rect: { x: 10, y: 100, width: 200, height: 30 },
          isVisible: true,
          isDisabled: false,
        },
      ],
      visibleContent: "content",
      viewport: { width: 1280, height: 800 },
    });

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).toContain("type=email");
    expect(systemContent).toContain("placeholder=");
    expect(systemContent).toContain("name=email");
    expect(systemContent).toContain("required=");
    expect(systemContent).toContain("aria-label=");
  });
});

// --- Working Notes Tests ---
describe("Working Notes", () => {
  test("appendWorkingNote adds note and renders in system prompt", () => {
    const ctx = new ContextManager();
    ctx.appendWorkingNote("Element [5] is the submit button");

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).toContain("## Working Notes");
    expect(systemContent).toContain("Element [5] is the submit button");
  });

  test("working notes placeholder removed when no notes", () => {
    const ctx = new ContextManager();
    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).not.toContain("{{workingNotes}}");
    expect(systemContent).not.toContain("## Working Notes");
  });

  test("appendWorkingNote caps at 500 chars", () => {
    const ctx = new ContextManager();
    ctx.appendWorkingNote("A".repeat(300));
    ctx.appendWorkingNote("B".repeat(300));

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    // Should have Working Notes section
    expect(systemContent).toContain("## Working Notes");
    // Total should be capped at 500 chars
    const notesMatch = systemContent.match(/## Working Notes\n([\s\S]*?)(?:\n## |$)/);
    expect(notesMatch).not.toBeNull();
    const notesContent = notesMatch![1].trim();
    expect(notesContent.length).toBeLessThanOrEqual(500);
  });

  test("multiple notes are joined with newlines", () => {
    const ctx = new ContextManager();
    ctx.appendWorkingNote("Note 1: first");
    ctx.appendWorkingNote("Note 2: second");

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).toContain("Note 1: first");
    expect(systemContent).toContain("Note 2: second");
  });
});

// --- Turn Budget Tests ---
describe("Turn Budget", () => {
  test("turnBudget appears in system prompt when time context is set", () => {
    const ctx = new ContextManager();
    ctx.setTimeContext(5, 30, Date.now() - 10000); // 10s ago

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).toContain("Turn 5/30");
    expect(systemContent).toContain("Elapsed:");
    expect(systemContent).toContain("Budget: 25 turns left");
  });

  test("turnBudget placeholder removed when no time context", () => {
    const ctx = new ContextManager();
    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).not.toContain("{{turnBudget}}");
    expect(systemContent).not.toContain("Turn 0/0");
  });
});

describe("Last Action Outcome", () => {
  test("renders normalized last action outcome in system prompt", () => {
    const ctx = new ContextManager();
    ctx.setLastActionOutcome({
      toolName: "click_element",
      deltaPercent: 0.34,
      urlChanged: false,
      currentUrl: "https://example.com/dashboard",
      elementsAdded: 2,
      elementsRemoved: 1,
    });

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).toContain("## Last Action Outcome");
    expect(systemContent).toContain("Tool: click_element");
    expect(systemContent).toContain("Result: Observable page change detected.");
    expect(systemContent).toContain("Signals: 34% DOM delta | same URL | +2 | -1");
  });

  test("shows no recent action outcome when cleared", () => {
    const ctx = new ContextManager();
    ctx.setLastActionOutcome(null);

    const prompt = ctx.getPrompt();
    const systemContent = renderedPrompt(prompt);
    expect(systemContent).toContain("## Last Action Outcome");
    expect(systemContent).toContain(
      "No recent DOM-affecting action recorded.",
    );
  });
});

describe("formatElementCompact new-element marking (LP-10)", () => {
  test("prefixes * when isNew is set", () => {
    const el = makeElement({ tag: 42, isNew: true });
    const result = formatElementCompact(el, "Submit", null, 800);
    expect(result.startsWith("*[42] ")).toBe(true);
  });

  test("no prefix when isNew is absent", () => {
    const el = makeElement({ tag: 42 });
    const result = formatElementCompact(el, "Submit", null, 800);
    expect(result.startsWith("[42] ")).toBe(true);
  });
});

describe("Fill checklist (LP-17)", () => {
  const formField = (tag: number, label: string, value = "") => {
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      tag,
      tagName: "input",
      role: "textbox",
      text: value,
      attributes: { id: key, name: key, type: "text", value, label },
      rect: { x: 0, y: tag * 20, width: 180, height: 24 },
      isVisible: true,
      isDisabled: false,
    };
  };
  const formSnapshot = () => ({
    title: "Apply",
    url: "https://example.com/apply",
    elements: [
      formField(1, "First name", "Kris"),
      formField(2, "Email", "k@example.com"),
      formField(3, "Phone"),
    ],
    visibleContent: "Application",
    viewport: { width: 1280, height: 800 },
    scroll: { x: 0, y: 0, maxY: 0 },
  });

  test("system prompt carries the Form status line for a form snapshot", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot(formSnapshot() as any);
    const systemContent = renderedPrompt(ctx.getPrompt());
    expect(systemContent).toContain("Form status: 2/3 fields hold confirmed values");
    expect(systemContent).toContain("Still empty: Phone");
    // Placed above the elements list.
    expect(systemContent.indexOf("Form status:")).toBeLessThan(
      systemContent.indexOf("## Visible Elements"),
    );
  });

  test("no Form status line on a non-form snapshot", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot({
      title: "Article",
      url: "https://example.com/post",
      elements: [],
      visibleContent: "Text",
      viewport: { width: 1280, height: 800 },
      scroll: { x: 0, y: 0, maxY: 0 },
    } as any);
    expect(renderedPrompt(ctx.getPrompt())).not.toContain("Form status:");
  });

  test("consumeChecklistFeedbackLine fires once per filled-set change", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot(formSnapshot() as any);
    const first = ctx.consumeChecklistFeedbackLine();
    expect(first).toContain("2/3 fields hold confirmed values");
    // Same state → no second injection.
    expect(ctx.consumeChecklistFeedbackLine()).toBeNull();
    // Fill the remaining field → new signature → fires again.
    const snapshot = formSnapshot();
    snapshot.elements[2] = formField(3, "Phone", "+43 1 234");
    ctx.setSnapshot(snapshot as any);
    expect(ctx.consumeChecklistFeedbackLine()).toContain("3/3 fields");
  });

  test("clear() resets the checklist state", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot(formSnapshot() as any);
    expect(ctx.consumeChecklistFeedbackLine()).not.toBeNull();
    ctx.clear();
    ctx.setSnapshot(formSnapshot() as any);
    // Same signature as before clear, but state was reset → fires again.
    expect(ctx.consumeChecklistFeedbackLine()).not.toBeNull();
  });
});

describe("Page-content unchanged marker (LP-17)", () => {
  const pageSnapshot = (pageContent: string, url = "https://example.com/doc") => ({
    title: "Doc",
    url,
    elements: [],
    visibleContent: "Body",
    pageContent,
    viewport: { width: 1280, height: 800 },
    scroll: { x: 0, y: 0, maxY: 0 },
  });

  test("second turn with identical content gets the marker; first gets full text", () => {
    const ctx = new ContextManager();
    const body = "UNIQUE-PAGE-BODY " + "filler ".repeat(100);
    ctx.setSnapshot(pageSnapshot(body) as any);
    ctx.setTimeContext(1, 30, Date.now());
    const first = renderedPrompt(ctx.getPrompt());
    expect(first).toContain("UNIQUE-PAGE-BODY");
    expect(first).not.toContain("«Page Content unchanged");

    ctx.setFirstTurnDone();
    ctx.setSnapshot(pageSnapshot(body) as any);
    ctx.setTimeContext(2, 30, Date.now());
    const second = renderedPrompt(ctx.getPrompt());
    expect(second).toContain("«Page Content unchanged since turn 1");
    // The excerpt still grounds the marker.
    expect(second).toContain("Excerpt: UNIQUE-PAGE-BODY");
  });

  test("changed content re-emits in full", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot(pageSnapshot("BODY-ONE " + "x ".repeat(400)) as any);
    ctx.setTimeContext(1, 30, Date.now());
    ctx.getPrompt();
    ctx.setFirstTurnDone();
    ctx.setSnapshot(pageSnapshot("BODY-TWO " + "y ".repeat(400)) as any);
    ctx.setTimeContext(2, 30, Date.now());
    const second = renderedPrompt(ctx.getPrompt());
    expect(second).toContain("BODY-TWO");
    expect(second).not.toContain("«Page Content unchanged");
  });

  test("clearHistory forces a full re-emit (fresh subtask never saw the block)", () => {
    const ctx = new ContextManager();
    const body = "SUBTASK-BODY " + "z ".repeat(400);
    ctx.setSnapshot(pageSnapshot(body) as any);
    ctx.setTimeContext(1, 30, Date.now());
    ctx.getPrompt();
    ctx.setFirstTurnDone();
    ctx.clearHistory();
    ctx.setSnapshot(pageSnapshot(body) as any);
    ctx.setTimeContext(2, 30, Date.now());
    const afterClear = renderedPrompt(ctx.getPrompt());
    expect(afterClear).toContain("SUBTASK-BODY");
    expect(afterClear).not.toContain("«Page Content unchanged");
  });
});

describe("System prompt block order (LP-17 P3, template v6)", () => {
  const fullSnapshot = () => ({
    title: "Order page",
    url: "https://example.com/order",
    elements: [
      {
        tag: 1,
        tagName: "button",
        role: "button",
        text: "Buy",
        attributes: {},
        rect: { x: 0, y: 0, width: 100, height: 30 },
        isVisible: true,
        isDisabled: false,
      },
    ],
    visibleContent: "Order things",
    pageContent: "Order page body text",
    viewport: { width: 1280, height: 800 },
    scroll: { x: 0, y: 500, maxY: 3000 },
  });

  function builtSystem(): string {
    const ctx = new ContextManager();
    ctx.setOriginalQuery("Buy the blue widget");
    ctx.setSnapshot(fullSnapshot() as any);
    ctx.setTimeContext(3, 30, Date.now() - 10_000);
    ctx.setLastActionOutcome({
      tool: "click_element",
      target: "[1]",
      observedEffect: "navigation",
      detail: "clicked Buy",
    } as any);
    return renderedPrompt(ctx.getPrompt());
  }

  test("stable-per-run content precedes page state; volatile turn status is last", () => {
    const content = builtSystem();
    // lastIndexOf: the rules body also contains an instructional
    // "## Page Interpretation" section — we assert on the data sections.
    const order = [
      "## Current Task",
      "## Page Context",
      "## Visible Elements",
      "## Page Content",
      "## Page Interpretation",
      "## Turn Status",
      "## Last Action Outcome",
    ].map((h) => ({ h, i: content.lastIndexOf(h) }));
    for (const { h, i } of order) {
      expect(i, `${h} missing from system prompt`).toBeGreaterThanOrEqual(0);
    }
    for (let k = 1; k < order.length; k++) {
      expect(
        order[k].i,
        `${order[k].h} should come after ${order[k - 1].h}`,
      ).toBeGreaterThan(order[k - 1].i);
    }
    // The every-turn counter lives under Turn Status at the tail.
    expect(content.indexOf("Turn 3/30")).toBeGreaterThan(
      content.indexOf("## Turn Status"),
    );
  });

  test("no unsubstituted {{placeholders}} remain — snapshot branch", () => {
    expect(builtSystem()).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
  });

  test("no unsubstituted {{placeholders}} remain — no-snapshot branch", () => {
    const ctx = new ContextManager();
    ctx.setOriginalQuery("Buy the blue widget");
    const content = renderedPrompt(ctx.getPrompt());
    expect(content).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
  });

  test("first-turn grounding block points below and precedes the element sections", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot(fullSnapshot() as any);
    const content = renderedPrompt(ctx.getPrompt());
    expect(content).toContain("Grounding Check — First-Turn Protocol");
    expect(content).toContain("provided below");
    expect(content.indexOf("Grounding Check")).toBeLessThan(
      content.indexOf("## Visible Elements"),
    );
  });
});

/**
 * LP-21 — the stable-prefix contract.
 *
 * Prefix caching keeps everything before the first byte that changed, so the
 * system message must be byte-identical for a whole run. These are the tests
 * that would have caught the `## Page Interpretation` replace() collision:
 * the element-ID list is per-turn data that used to land in the static rules
 * section, above the cache breakpoint.
 */
describe("Stable prefix (LP-21)", () => {
  const snapshotWith = (ids: number[], url: string, body: string) => ({
    title: "Shop",
    url,
    elements: ids.map((n) => ({
      tag: n,
      tagName: "button",
      text: `Item ${n}`,
      isVisible: true,
      attributes: {},
    })),
    visibleContent: body,
    pageContent: body,
    viewport: { width: 1280, height: 800 },
    scroll: { x: 0, y: 0, maxY: 0 },
  });

  function systemFor(snapshot: unknown): string {
    const ctx = new ContextManager();
    ctx.setOriginalQuery("Buy the blue widget");
    ctx.setSnapshot(snapshot as any);
    return systemOf(ctx.getPrompt());
  }

  test("system message is byte-identical when only the page changes", () => {
    const a = systemFor(snapshotWith([1, 2, 3], "https://shop.test/a", "PAGE-A"));
    const b = systemFor(
      snapshotWith([7, 8, 9, 10], "https://shop.test/b", "PAGE-B"),
    );
    expect(a).toBe(b);
  });

  test("volatile page state is absent from the system message", () => {
    const prompt = (() => {
      const ctx = new ContextManager();
      ctx.setOriginalQuery("Buy the blue widget");
      ctx.setSnapshot(
        snapshotWith([4, 5], "https://shop.test/x", "UNIQUE-BODY") as any,
      );
      return ctx.getPrompt();
    })();

    const system = systemOf(prompt);
    const tail = volatileTailOf(prompt);

    for (const marker of [
      "## Page Context",
      "## Visible Elements",
      "## Page Content",
      "## Turn Status",
      "UNIQUE-BODY",
      "https://shop.test/x",
    ]) {
      expect(system, `${marker} must not be in the system message`).not.toContain(
        marker,
      );
      expect(tail, `${marker} must be in the volatile tail`).toContain(marker);
    }
  });

  test("the volatile tail is the last message", () => {
    const ctx = new ContextManager();
    ctx.setOriginalQuery("Buy the blue widget");
    ctx.addMessage({ role: "user", content: "first" });
    ctx.addMessage({ role: "assistant", content: "ack" });
    ctx.setSnapshot(snapshotWith([1], "https://shop.test/z", "BODY-Z") as any);

    const prompt = ctx.getPrompt();
    const last = prompt[prompt.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("## Page Context");
  });

  test("element IDs render in the volatile tail, not the static rules", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot(snapshotWith([42, 43], "https://shop.test/i", "B") as any);
    const prompt = ctx.getPrompt();

    expect(volatileTailOf(prompt)).toContain("Valid element IDs: [42,43]");
    expect(systemOf(prompt)).not.toContain("Valid element IDs");
    // The static rules keep their own (renamed) heading, and it must not be a
    // substitution target: `replace()` takes the FIRST match.
    expect(systemOf(prompt)).toContain("## Reading The Page Interpretation");
  });

  test("no unsubstituted placeholders survive in either region", () => {
    const ctx = new ContextManager();
    ctx.setSnapshot(snapshotWith([1], "https://shop.test/p", "B") as any);
    const prompt = ctx.getPrompt();
    expect(systemOf(prompt)).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
    expect(volatileTailOf(prompt)).not.toMatch(/\{\{[a-zA-Z]+\}\}/);
  });
});
