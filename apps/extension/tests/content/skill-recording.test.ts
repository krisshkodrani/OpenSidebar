import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { MessageSource, RuntimeMessage } from "../../src/types";

describe("content skill recording overlay", () => {
  let listener: (message: RuntimeMessage, sender: unknown, sendResponse: (value: unknown) => void) => void;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    document.documentElement.innerHTML = "<head></head><body></body>";
    sendMessage = vi.fn(async () => ({}));
    chrome.runtime.sendMessage = sendMessage as any;
    chrome.runtime.onMessage.addListener = vi.fn((fn) => {
      listener = fn as typeof listener;
    }) as any;
    await import("../../src/content/content");
  });

  test("renders HUD and border, emits click events, and cleans up on stop", () => {
    listener(
      {
        type: "SKILL_RECORDING_START",
        requestId: "start",
        source: MessageSource.BACKGROUND,
        payload: { tabId: 1 },
      },
      {},
      vi.fn(),
    );

    expect(document.getElementById("opensidebar-recording-hud")).toBeTruthy();
    expect(document.getElementById("opensidebar-recording-border")).toBeTruthy();
    expect(document.getElementById("opensidebar-recording-style")?.textContent).toContain(
      "@media (prefers-reduced-motion: reduce)",
    );

    const button = document.createElement("button");
    button.textContent = "Create order";
    document.body.appendChild(button);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".opensidebar-recording-feedback")).toBeTruthy();
    expect(
      sendMessage.mock.calls.some(
        ([message]) =>
          message.type === "SKILL_RECORDING_EVENT" &&
          message.payload.event.timelineText === 'Clicked "Create order"',
      ),
    ).toBe(true);

    listener(
      {
        type: "SKILL_RECORDING_STOP",
        requestId: "stop",
        source: MessageSource.BACKGROUND,
        payload: { tabId: 1 },
      },
      {},
      vi.fn(),
    );

    expect(document.getElementById("opensidebar-recording-hud")).toBeNull();
    expect(document.getElementById("opensidebar-recording-border")).toBeNull();
  });

  test("captures checkable controls once with control type", () => {
    listener(
      {
        type: "SKILL_RECORDING_START",
        requestId: "start",
        source: MessageSource.BACKGROUND,
        payload: { tabId: 1 },
      },
      {},
      vi.fn(),
    );

    const label = document.createElement("label");
    label.textContent = "AWS Trainium";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    label.appendChild(checkbox);
    document.body.appendChild(label);

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    const checkboxEvents = sendMessage.mock.calls
      .map(([message]) => message)
      .filter(
        (message) =>
          message.type === "SKILL_RECORDING_EVENT" &&
          message.payload.event.kind === "checkbox" &&
          message.payload.event.label === "AWS Trainium",
      );

    expect(checkboxEvents).toHaveLength(1);
    expect(checkboxEvents[0].payload.event).toMatchObject({
      checked: true,
      controlType: "checkbox",
      inputType: "checkbox",
      timelineText: 'Checked "AWS Trainium"',
    });
  });
});
