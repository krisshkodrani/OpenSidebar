import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { MessageSource, RuntimeMessage } from "../../src/types";
import { AGENT_BORDER_ID } from "../../src/content/in-page-ui/agent-border";
import { FLOATING_WRAP_ID } from "../../src/content/in-page-ui/floating-action-hud";

describe("content agent activity cue with overlay panel", () => {
  let listener: (
    message: RuntimeMessage,
    sender: unknown,
    sendResponse: (value: unknown) => void,
  ) => void;
  const originalAnimate = HTMLElement.prototype.animate;

  beforeEach(async () => {
    vi.resetModules();
    document.documentElement.innerHTML = "<head></head><body></body>";
    chrome.runtime.onMessage.addListener = vi.fn((fn) => {
      listener = fn as typeof listener;
    }) as any;
    await import("../../src/content/content");
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: originalAnimate,
    });
  });

  test("keeps the page glow visible during overlay-driven page work without showing the floating HUD", () => {
    const overlay = document.createElement("div");
    overlay.id = "opensidebar-harness-host";
    document.documentElement.appendChild(overlay);

    listener(
      {
        type: "AGENT_ACTIVITY",
        requestId: "activity-start",
        source: MessageSource.BACKGROUND,
        payload: { active: true, pageActivity: false },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );

    expect(document.getElementById(AGENT_BORDER_ID)).toBeNull();
    expect(document.getElementById(FLOATING_WRAP_ID)).toBeNull();

    listener(
      {
        type: "AGENT_STEP_LABEL",
        requestId: "scroll-step",
        source: MessageSource.BACKGROUND,
        payload: { label: "Scroll page", status: "running" },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );

    expect(document.getElementById(AGENT_BORDER_ID)).toBeTruthy();
    expect(document.getElementById(FLOATING_WRAP_ID)).toBeNull();
  });

  test("removes the overlay-backed page glow when the task terminates", () => {
    vi.useFakeTimers();
    const animate = vi.fn(() => {
      const animation: { onfinish?: () => void } = {};
      setTimeout(() => animation.onfinish?.(), 0);
      return animation;
    });
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });

    const overlay = document.createElement("div");
    overlay.id = "opensidebar-harness-host";
    document.documentElement.appendChild(overlay);

    listener(
      {
        type: "AGENT_ACTIVITY",
        requestId: "activity-start",
        source: MessageSource.BACKGROUND,
        payload: { active: true, pageActivity: true },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );

    expect(document.getElementById(AGENT_BORDER_ID)).toBeTruthy();
    expect(document.getElementById(FLOATING_WRAP_ID)).toBeNull();

    listener(
      {
        type: "AGENT_ACTIVITY",
        requestId: "activity-complete",
        source: MessageSource.BACKGROUND,
        payload: { active: false, outcome: { status: "completed" } },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );
    vi.runAllTimers();

    expect(document.getElementById(AGENT_BORDER_ID)).toBeNull();
  });

  test("shows watch mode page glow without the floating HUD", () => {
    listener(
      {
        type: "PASSIVE_MONITOR_PAGE_ACTIVITY",
        requestId: "watch-start",
        source: MessageSource.BACKGROUND,
        payload: {
          active: true,
          status: "watching",
          sessionId: "watch-1",
        },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );

    expect(document.getElementById(AGENT_BORDER_ID)).toBeTruthy();
    expect(document.getElementById(FLOATING_WRAP_ID)).toBeNull();

    listener(
      {
        type: "PASSIVE_MONITOR_PAGE_ACTIVITY",
        requestId: "watch-stop",
        source: MessageSource.BACKGROUND,
        payload: {
          active: false,
          status: "stopped",
          sessionId: "watch-1",
        },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );

    expect(document.getElementById(AGENT_BORDER_ID)).toBeNull();
  });

  test("keeps watch mode page glow visible with the overlay panel mounted", () => {
    const overlay = document.createElement("div");
    overlay.id = "opensidebar-harness-host";
    document.documentElement.appendChild(overlay);

    listener(
      {
        type: "PASSIVE_MONITOR_PAGE_ACTIVITY",
        requestId: "watch-start",
        source: MessageSource.BACKGROUND,
        payload: {
          active: true,
          status: "watching",
          sessionId: "watch-1",
        },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );

    expect(document.getElementById(AGENT_BORDER_ID)).toBeTruthy();
    expect(document.getElementById(FLOATING_WRAP_ID)).toBeNull();
  });

  test("keeps watch mode page glow after an agent task ends", () => {
    vi.useFakeTimers();
    const animate = vi.fn(() => {
      const animation: { onfinish?: () => void } = {};
      setTimeout(() => animation.onfinish?.(), 0);
      return animation;
    });
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });

    listener(
      {
        type: "PASSIVE_MONITOR_PAGE_ACTIVITY",
        requestId: "watch-start",
        source: MessageSource.BACKGROUND,
        payload: {
          active: true,
          status: "watching",
          sessionId: "watch-1",
        },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );
    listener(
      {
        type: "AGENT_ACTIVITY",
        requestId: "activity-start",
        source: MessageSource.BACKGROUND,
        payload: { active: true, pageActivity: true },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );
    listener(
      {
        type: "AGENT_ACTIVITY",
        requestId: "activity-complete",
        source: MessageSource.BACKGROUND,
        payload: { active: false, outcome: { status: "completed" } },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );
    vi.runAllTimers();

    expect(document.getElementById(AGENT_BORDER_ID)).toBeTruthy();
    expect(document.getElementById(FLOATING_WRAP_ID)).toBeNull();
  });

  test("does not remove an agent-owned page glow when watch mode stops", () => {
    listener(
      {
        type: "AGENT_ACTIVITY",
        requestId: "activity-start",
        source: MessageSource.BACKGROUND,
        payload: { active: true, pageActivity: true },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );

    expect(document.getElementById(AGENT_BORDER_ID)).toBeTruthy();

    listener(
      {
        type: "PASSIVE_MONITOR_PAGE_ACTIVITY",
        requestId: "watch-stop",
        source: MessageSource.BACKGROUND,
        payload: {
          active: false,
          status: "stopped",
          sessionId: "watch-1",
        },
      } as RuntimeMessage,
      {},
      vi.fn(),
    );

    expect(document.getElementById(AGENT_BORDER_ID)).toBeTruthy();
  });
});
