import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import "../setup";
import { startRecording, stopRecording, isRecording } from "../../src/content/recorder";

describe("recorder", () => {
  beforeEach(() => {
    // Ensure clean state
    if (isRecording()) stopRecording();
  });

  afterEach(() => {
    if (isRecording()) stopRecording();
  });

  test("startRecording sets recording state", () => {
    expect(isRecording()).toBe(false);
    startRecording();
    expect(isRecording()).toBe(true);
  });

  test("stopRecording returns captured actions and resets state", () => {
    startRecording();
    const actions = stopRecording();
    expect(Array.isArray(actions)).toBe(true);
    expect(isRecording()).toBe(false);
  });

  test("stopRecording returns empty array when not recording", () => {
    const actions = stopRecording();
    expect(actions).toEqual([]);
  });

  test("captures click events", () => {
    startRecording();

    const button = document.createElement("button");
    button.textContent = "Submit";
    button.setAttribute("type", "submit");
    document.body.appendChild(button);

    button.click();

    const actions = stopRecording();
    expect(actions.length).toBeGreaterThanOrEqual(1);
    const clickAction = actions.find((a) => a.type === "click");
    expect(clickAction).toBeDefined();
    expect(clickAction!.element?.tagName).toBe("button");
    expect(clickAction!.element?.text).toBe("Submit");
    expect(clickAction!.url).toBeDefined();

    document.body.removeChild(button);
  });

  test("captures input events with debouncing", async () => {
    startRecording();

    const input = document.createElement("input");
    input.setAttribute("type", "text");
    input.setAttribute("placeholder", "Enter name");
    document.body.appendChild(input);

    // Simulate typing
    input.value = "hello";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 600));

    const actions = stopRecording();
    const typeAction = actions.find((a) => a.type === "type");
    expect(typeAction).toBeDefined();
    expect(typeAction!.value).toBe("hello");
    expect(typeAction!.element?.tagName).toBe("input");

    document.body.removeChild(input);
  });

  test("masks password input values", async () => {
    startRecording();

    const input = document.createElement("input");
    input.setAttribute("type", "password");
    document.body.appendChild(input);

    input.value = "secret123";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 600));

    const actions = stopRecording();
    const typeAction = actions.find((a) => a.type === "type");
    expect(typeAction).toBeDefined();
    expect(typeAction!.value).toBe("[password]");

    document.body.removeChild(input);
  });

  test("captures select change events", () => {
    startRecording();

    const select = document.createElement("select");
    const opt1 = document.createElement("option");
    opt1.textContent = "Option A";
    opt1.value = "a";
    const opt2 = document.createElement("option");
    opt2.textContent = "Option B";
    opt2.value = "b";
    select.appendChild(opt1);
    select.appendChild(opt2);
    document.body.appendChild(select);

    select.value = "b";
    select.selectedIndex = 1;
    select.dispatchEvent(new Event("change", { bubbles: true }));

    const actions = stopRecording();
    const selectAction = actions.find((a) => a.type === "select");
    expect(selectAction).toBeDefined();
    expect(selectAction!.value).toBe("Option B");

    document.body.removeChild(select);
  });

  test("captures special keydown events", () => {
    startRecording();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    // Regular key should NOT be captured
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );

    const actions = stopRecording();
    const keyActions = actions.filter((a) => a.type === "press_key");
    expect(keyActions.length).toBe(2);
    expect(keyActions[0].key).toBe("Enter");
    expect(keyActions[1].key).toBe("Escape");

    document.body.removeChild(input);
  });

  test("builds element descriptor correctly", () => {
    startRecording();

    const button = document.createElement("button");
    button.setAttribute("id", "submit-btn");
    button.setAttribute("aria-label", "Submit form");
    button.textContent = "Go";
    document.body.appendChild(button);

    button.click();

    const actions = stopRecording();
    const clickAction = actions.find((a) => a.type === "click");
    expect(clickAction!.element).toBeDefined();
    expect(clickAction!.element!.attributes.id).toBe("submit-btn");
    expect(clickAction!.element!.attributes["aria-label"]).toBe("Submit form");
    expect(clickAction!.element!.selector).toBe("#submit-btn");
    expect(clickAction!.element!.domPath).toContain("button");

    document.body.removeChild(button);
  });

  test("double start is idempotent", () => {
    startRecording();
    startRecording(); // should not throw
    expect(isRecording()).toBe(true);
    stopRecording();
  });
});
