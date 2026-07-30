import { describe, expect, test, vi } from "vitest";
import "../setup";

describe("passive content-script safety", () => {
  test("startup and passive snapshots do not click or hide page controls", async () => {
    let messageListener:
      | ((
          message: any,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response: any) => void,
        ) => boolean | void)
      | undefined;
    (chrome.runtime.onMessage as any).addListener = vi.fn((listener) => {
      messageListener = listener;
    });

    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 768,
      configurable: true,
    });

    const overlay = document.createElement("div");
    overlay.className = "consent-overlay";
    overlay.style.position = "fixed";
    overlay.style.zIndex = "9999";
    overlay.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 1024,
        height: 768,
        top: 0,
        left: 0,
        right: 1024,
        bottom: 768,
        toJSON: () => {},
      }) as DOMRect;

    const accept = document.createElement("button");
    accept.className = "accept";
    accept.setAttribute("aria-label", "Accept all");
    accept.textContent = "Accept all";
    accept.getBoundingClientRect = () =>
      ({
        x: 900,
        y: 20,
        width: 100,
        height: 40,
        top: 20,
        left: 900,
        right: 1000,
        bottom: 60,
        toJSON: () => {},
      }) as DOMRect;
    const clickSpy = vi.spyOn(accept, "click");
    overlay.appendChild(accept);
    document.body.appendChild(overlay);

    await import("../../src/content/content");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clickSpy).not.toHaveBeenCalled();
    expect(overlay.hasAttribute("data-osb-dismissed")).toBe(false);
    expect(messageListener).toBeTypeOf("function");

    await new Promise<void>((resolve) => {
      messageListener!(
        {
          type: "DOM_SNAPSHOT_REQUEST",
          requestId: "passive-snapshot",
          source: "background",
          payload: { refresh: true },
        },
        {} as chrome.runtime.MessageSender,
        () => resolve(),
      );
    });

    expect(clickSpy).not.toHaveBeenCalled();
    expect(overlay.hasAttribute("data-osb-dismissed")).toBe(false);
  });
});
