import { describe, expect, test, vi } from "vitest";
import { AgentStatus, MessageSource } from "../../src/types";
import {
  createOverlayUiRuntimeHarness,
  OVERLAY_SEND_MESSAGE_EVENT,
} from "../../src/overlay/runtime";

describe("overlay UI runtime", () => {
  test("provides active tab metadata from the page context", async () => {
    const harness = createOverlayUiRuntimeHarness({
      tab: {
        id: 7,
        url: "https://example.com/page",
        title: "Fixture page",
        windowId: 3,
      },
    });

    await expect(harness.port.getActiveTab()).resolves.toMatchObject({
      id: 7,
      url: "https://example.com/page",
      title: "Fixture page",
      active: true,
      windowId: 3,
    });
    await expect(harness.port.getCurrentWindow()).resolves.toEqual({ id: 3 });
  });

  test("stores values in memory with Chrome-compatible get semantics", async () => {
    const harness = createOverlayUiRuntimeHarness({
      storage: {
        local: { existing: "value" },
      },
    });

    await harness.port.storage.local.set({ next: 42 });
    await expect(harness.port.storage.local.get("existing")).resolves.toEqual({
      existing: "value",
    });
    await expect(
      harness.port.storage.local.get({
        existing: "fallback",
        missing: "fallback",
      }),
    ).resolves.toEqual({
      existing: "value",
      missing: "fallback",
    });
    await harness.port.storage.local.remove(["existing"]);

    expect(harness.getStorageSnapshot("local")).toEqual({ next: 42 });
  });

  test("records outbound messages and delivers background messages to subscribers", async () => {
    const onSendMessage = vi.fn(async () => ({ ok: true }));
    const harness = createOverlayUiRuntimeHarness({ onSendMessage });
    const received: string[] = [];
    const unsubscribe = harness.port.subscribeMessages((message) => {
      received.push(message.type);
    });
    const eventSpy = vi.fn();
    window.addEventListener(OVERLAY_SEND_MESSAGE_EVENT, eventSpy);

    await expect(
      harness.port.sendMessage({
        type: "USER_CHAT",
        source: MessageSource.SIDEPANEL,
        requestId: "request-1",
        payload: { text: "Summarize this page", tabId: 1 },
      }),
    ).resolves.toEqual({ ok: true });

    harness.emitMessage({
      type: "AGENT_STATUS",
      source: MessageSource.BACKGROUND,
      requestId: "status-1",
      payload: { status: AgentStatus.THINKING, detail: "Working" },
    });
    unsubscribe();
    harness.emitMessage({
      type: "AGENT_STATUS",
      source: MessageSource.BACKGROUND,
      requestId: "status-2",
      payload: { status: AgentStatus.IDLE, detail: "Done" },
    });

    expect(harness.sentMessages).toHaveLength(1);
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(received).toEqual(["AGENT_STATUS"]);
    window.removeEventListener(OVERLAY_SEND_MESSAGE_EVENT, eventSpy);
  });
});
