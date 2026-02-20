import { describe, test, expect } from "bun:test";
import "../setup";
import {
  actionToToolCall,
  buildGoldenCases,
  buildConversationHistory,
} from "../../src/background/golden/builder";
import type { GoldenAction, DomSnapshot, DemoAction, TaggedElement } from "../../src/types";

function makeSnapshot(overrides?: Partial<DomSnapshot>): DomSnapshot {
  return {
    title: "Test Page",
    url: "https://example.com",
    elements: [
      {
        tag: 1,
        tagName: "button",
        role: "button",
        text: "Submit",
        attributes: { type: "submit" },
        rect: { x: 0, y: 0, width: 100, height: 30 },
        isVisible: true,
        isDisabled: false,
      },
      {
        tag: 2,
        tagName: "input",
        role: "textbox",
        text: "",
        attributes: { type: "text", name: "email", placeholder: "Email" },
        rect: { x: 0, y: 40, width: 200, height: 30 },
        isVisible: true,
        isDisabled: false,
      },
    ],
    viewportText: "Welcome to the test page",
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 2000 },
    ...overrides,
  };
}

function makeAction(type: DemoAction["type"], overrides?: Partial<DemoAction>): DemoAction {
  return {
    type,
    timestamp: Date.now(),
    url: "https://example.com",
    ...overrides,
  };
}

function makeGoldenAction(
  actionType: DemoAction["type"],
  tagId: number | null,
  actionOverrides?: Partial<DemoAction>,
): GoldenAction {
  return {
    action: makeAction(actionType, actionOverrides),
    tagId,
    snapshot: makeSnapshot(),
  };
}

describe("actionToToolCall", () => {
  test("maps click to click_element", () => {
    const result = actionToToolCall(makeAction("click"), 5);
    expect(result).toEqual({
      toolName: "click_element",
      args: { id: 5 },
    });
  });

  test("returns null for click without tagId", () => {
    const result = actionToToolCall(makeAction("click"), null);
    expect(result).toBeNull();
  });

  test("maps type to type_text", () => {
    const result = actionToToolCall(makeAction("type", { value: "hello" }), 2);
    expect(result).toEqual({
      toolName: "type_text",
      args: { id: 2, text: "hello" },
    });
  });

  test("returns null for type without value", () => {
    const result = actionToToolCall(makeAction("type"), 2);
    expect(result).toBeNull();
  });

  test("maps scroll down", () => {
    const result = actionToToolCall(makeAction("scroll", { scrollDelta: 300 }), null);
    expect(result).toEqual({
      toolName: "scroll_page",
      args: { direction: "down", amount: 300 },
    });
  });

  test("maps scroll up", () => {
    const result = actionToToolCall(makeAction("scroll", { scrollDelta: -200 }), null);
    expect(result).toEqual({
      toolName: "scroll_page",
      args: { direction: "up", amount: 200 },
    });
  });

  test("maps select to select_option", () => {
    const result = actionToToolCall(makeAction("select", { value: "Option A" }), 3);
    expect(result).toEqual({
      toolName: "select_option",
      args: { id: 3, value: "Option A" },
    });
  });

  test("maps press_key", () => {
    const result = actionToToolCall(makeAction("press_key", { key: "Enter" }), null);
    expect(result).toEqual({
      toolName: "press_key",
      args: { key: "Enter" },
    });
  });

  test("maps press_key with modifiers", () => {
    const result = actionToToolCall(
      makeAction("press_key", { key: "a", value: "ctrl+shift" }),
      null,
    );
    expect(result).toEqual({
      toolName: "press_key",
      args: { key: "a", modifiers: ["ctrl", "shift"] },
    });
  });

  test("maps navigate to go_to_url (navigate)", () => {
    const result = actionToToolCall(
      makeAction("navigate", { url: "https://example.com/page" }),
      null,
    );
    expect(result).toEqual({
      toolName: "navigate",
      args: { url: "https://example.com/page" },
    });
  });
});

describe("buildConversationHistory", () => {
  test("returns user query for first turn (no prior actions)", () => {
    const history = buildConversationHistory([], "Test query");
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("Test query");
  });

  test("includes prior tool calls for subsequent turns", () => {
    const priorActions: GoldenAction[] = [
      makeGoldenAction("click", 1),
      makeGoldenAction("type", 2, { value: "hello" }),
    ];
    const history = buildConversationHistory(priorActions, "Fill the form");
    // user + (assistant + tool) * 2 = 5
    expect(history).toHaveLength(5);
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
    expect(history[1].tool_calls).toHaveLength(1);
    expect(history[1].tool_calls![0].function.name).toBe("click_element");
    expect(history[2].role).toBe("tool");
    expect(history[2].content).toBe("OK");
    expect(history[3].role).toBe("assistant");
    expect(history[3].tool_calls![0].function.name).toBe("type_text");
    expect(history[4].role).toBe("tool");
  });
});

describe("buildGoldenCases", () => {
  test("builds eval cases from golden actions", () => {
    const actions: GoldenAction[] = [
      makeGoldenAction("click", 1),
      makeGoldenAction("type", 2, { value: "test@example.com" }),
    ];

    const cases = buildGoldenCases(actions, "Login test", null, []);
    expect(cases).toHaveLength(2);

    // First case
    expect(cases[0].id).toBe("golden-login-test-001");
    expect(cases[0].strategy).toBe("golden");
    expect(cases[0].sourceTurn).toBe(1);
    expect(cases[0].expected.toolCalls).toEqual([
      { toolName: "click_element", args: { id: 1 } },
    ]);
    expect(cases[0].metadata.difficulty).toBe("easy");
    expect(cases[0].metadata.tags).toContain("golden");

    // Second case has conversation history from prior actions
    expect(cases[1].id).toBe("golden-login-test-002");
    expect(cases[1].sourceTurn).toBe(2);
    expect(cases[1].expected.toolCalls).toEqual([
      { toolName: "type_text", args: { id: 2, text: "test@example.com" } },
    ]);
    expect(cases[1].metadata.difficulty).toBe("medium");
    expect(cases[1].input.conversationHistory.length).toBeGreaterThan(1);
  });

  test("skips actions that cannot be mapped to tool calls", () => {
    const actions: GoldenAction[] = [
      makeGoldenAction("click", null), // no tag ID — skipped
      makeGoldenAction("click", 3),
    ];
    const cases = buildGoldenCases(actions, "Test", null, []);
    expect(cases).toHaveLength(1);
    expect(cases[0].expected.toolCalls[0].args).toEqual({ id: 3 });
  });

  test("system prompt includes page title and elements", () => {
    const actions: GoldenAction[] = [makeGoldenAction("click", 1)];
    const cases = buildGoldenCases(actions, "Test", null, []);
    expect(cases[0].input.systemPrompt).toContain("Test Page");
    expect(cases[0].input.systemPrompt).toContain("https://example.com");
    expect(cases[0].input.systemPrompt).toContain("[1] button");
  });

  test("case IDs are sanitized from name", () => {
    const actions: GoldenAction[] = [makeGoldenAction("click", 1)];
    const cases = buildGoldenCases(actions, "My Demo (v2)!", null, []);
    expect(cases[0].id).toMatch(/^golden-my-demo--v2---001$/);
    expect(cases[0].sourceSessionId).toMatch(/^golden-my-demo--v2-/);
  });
});
