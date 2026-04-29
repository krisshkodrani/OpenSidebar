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
});
