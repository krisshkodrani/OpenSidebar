import { describe, test, expect } from "vitest";
import "../setup";
import {
  actionToToolCall,
} from "../../src/background/golden/builder";
import type { DemoAction } from "../../src/types";

function makeAction(type: DemoAction["type"], overrides?: Partial<DemoAction>): DemoAction {
  return {
    type,
    timestamp: Date.now(),
    url: "https://example.com",
    ...overrides,
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
