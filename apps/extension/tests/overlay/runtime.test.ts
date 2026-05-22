import { describe, expect, test, vi } from "vitest";
import { AgentStatus, MessageSource } from "../../src/types";
import {
  createOverlayUiRuntimeHarness,
  OVERLAY_RECEIVE_MESSAGE_EVENT,
  OVERLAY_SEND_RESPONSE_EVENT,
  OVERLAY_SEND_MESSAGE_EVENT,
  OVERLAY_STORAGE_REQUEST_EVENT,
  OVERLAY_STORAGE_RESPONSE_EVENT,
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

  test("resolves extension URLs from configured base URL", () => {
    const harness = createOverlayUiRuntimeHarness({
      extensionBaseUrl: "chrome-extension://abcdefghijklmnop/",
    });

    expect(harness.port.getUrl("public/icons/icon-128.png")).toBe(
      "chrome-extension://abcdefghijklmnop/public/icons/icon-128.png",
    );
  });

  test("can proxy storage through overlay bridge events", async () => {
    const harness = createOverlayUiRuntimeHarness({
      storageMode: "chrome-bridge",
      bridgeToken: "bridge-secret",
    });
    const stored: Record<string, unknown> = { existing: "value" };
    const onStorageRequest = vi.fn((event: Event) => {
      const detail = (
        event as CustomEvent<{
          requestId: string;
          bridgeToken?: string;
          operation: "get" | "set" | "remove";
          keys?: string | string[] | Record<string, unknown> | null;
          items?: Record<string, unknown>;
        }>
      ).detail;
      expect(detail.bridgeToken).toBe("bridge-secret");
      if (detail.operation === "get") {
        window.dispatchEvent(
          new CustomEvent(OVERLAY_STORAGE_RESPONSE_EVENT, {
            detail: {
              requestId: detail.requestId,
              bridgeToken: detail.bridgeToken,
              response: { existing: stored.existing },
            },
          }),
        );
      } else if (detail.operation === "set") {
        Object.assign(stored, detail.items);
        window.dispatchEvent(
          new CustomEvent(OVERLAY_STORAGE_RESPONSE_EVENT, {
            detail: {
              requestId: detail.requestId,
              bridgeToken: detail.bridgeToken,
              response: {},
            },
          }),
        );
      }
    });
    window.addEventListener(OVERLAY_STORAGE_REQUEST_EVENT, onStorageRequest);

    await expect(harness.port.storage.local.get("existing")).resolves.toEqual({
      existing: "value",
    });
    await harness.port.storage.local.set({ next: 42 });
    expect(stored.next).toBe(42);
    expect(onStorageRequest).toHaveBeenCalledTimes(2);

    window.removeEventListener(OVERLAY_STORAGE_REQUEST_EVENT, onStorageRequest);
    harness.dispose();
  });

  test("ignores bridge events with the wrong token", async () => {
    const harness = createOverlayUiRuntimeHarness({ bridgeToken: "expected" });
    const received: string[] = [];
    harness.port.subscribeMessages((message) => received.push(message.type));
    let requestId = "";
    const onSend = vi.fn((event: Event) => {
      const detail = (
        event as CustomEvent<{ requestId: string; bridgeToken?: string }>
      ).detail;
      requestId = detail.requestId;
      expect(detail.bridgeToken).toBe("expected");
      window.dispatchEvent(
        new CustomEvent(OVERLAY_SEND_RESPONSE_EVENT, {
          detail: {
            requestId,
            bridgeToken: "wrong",
            response: { ignored: true },
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent(OVERLAY_SEND_RESPONSE_EVENT, {
          detail: {
            requestId,
            bridgeToken: "expected",
            response: { ok: true },
          },
        }),
      );
    });
    window.addEventListener(OVERLAY_SEND_MESSAGE_EVENT, onSend);

    window.dispatchEvent(
      new CustomEvent(OVERLAY_RECEIVE_MESSAGE_EVENT, {
        detail: {
          bridgeToken: "wrong",
          message: {
            type: "AGENT_STATUS",
            source: MessageSource.BACKGROUND,
            requestId: "bad",
            payload: { status: AgentStatus.THINKING, detail: "Bad" },
          },
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent(OVERLAY_RECEIVE_MESSAGE_EVENT, {
        detail: {
          bridgeToken: "expected",
          message: {
            type: "AGENT_STATUS",
            source: MessageSource.BACKGROUND,
            requestId: "good",
            payload: { status: AgentStatus.THINKING, detail: "Good" },
          },
        },
      }),
    );

    await expect(
      harness.port.sendMessage({
        type: "SIDE_PANEL_OPENED",
        source: harness.port.source,
        requestId: "request-token",
        payload: { tabId: 1 },
      }),
    ).resolves.toEqual({ ok: true });

    expect(received).toEqual(["AGENT_STATUS"]);
    expect(onSend).toHaveBeenCalledTimes(1);
    window.removeEventListener(OVERLAY_SEND_MESSAGE_EVENT, onSend);
    harness.dispose();
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
        source: harness.port.source,
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
    expect(harness.port.source).toBe(MessageSource.UI);
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(eventSpy).toHaveBeenCalledTimes(1);
    expect(received).toEqual(["AGENT_STATUS"]);
    window.removeEventListener(OVERLAY_SEND_MESSAGE_EVENT, eventSpy);
  });

  test("resolves sendMessage through overlay bridge response events", async () => {
    const harness = createOverlayUiRuntimeHarness();
    const onSend = vi.fn((event: Event) => {
      const detail = (
        event as CustomEvent<{ requestId: string; message: unknown }>
      ).detail;
      window.dispatchEvent(
        new CustomEvent(OVERLAY_SEND_RESPONSE_EVENT, {
          detail: {
            requestId: detail.requestId,
            response: { workspaceId: "e2e-workspace" },
          },
        }),
      );
    });
    window.addEventListener(OVERLAY_SEND_MESSAGE_EVENT, onSend);

    await expect(
      harness.port.sendMessage({
        type: "SIDE_PANEL_OPENED",
        source: harness.port.source,
        requestId: "request-2",
        payload: { tabId: 1 },
      }),
    ).resolves.toEqual({ workspaceId: "e2e-workspace" });

    expect(onSend).toHaveBeenCalledTimes(1);
    window.removeEventListener(OVERLAY_SEND_MESSAGE_EVENT, onSend);
    harness.dispose();
  });
});
