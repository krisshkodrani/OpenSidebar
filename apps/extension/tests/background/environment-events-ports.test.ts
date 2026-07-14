import { describe, expect, test, vi } from "vitest";
import "../setup";
import {
  createFakeNavigationEventsPort,
  createFakeRuntimeMessagingPort,
  createFakeSchedulerPort,
} from "../fakes/environment-events";

describe("RuntimeMessagingPort fake", () => {
  test("broadcast records messages; onMessage delivers with sender", () => {
    const port = createFakeRuntimeMessagingPort();
    const seen: Array<{ message: unknown; tabId?: number }> = [];
    const unsubscribe = port.onMessage((message, sender) =>
      seen.push({ message, tabId: sender.tabId }),
    );

    port.broadcast({ type: "PING" });
    port.deliver({ type: "TASK_COMPLETION" }, { tabId: 7 });
    unsubscribe();
    port.deliver({ type: "AFTER_UNSUB" });
    port.broadcast({ type: "AFTER_UNSUB_BROADCAST" });

    expect(port.broadcasts).toEqual([
      { type: "PING" },
      { type: "AFTER_UNSUB_BROADCAST" },
    ]);
    // A broadcast reaches this port's own subscribers (no sender tabId — it
    // originated here), as well as being recorded. That is the
    // RuntimeMessagingPort contract: chrome.runtime.sendMessage skips the
    // sending context, so a port that only forwarded to chrome would strip
    // every message from same-context subscribers.
    expect(seen).toEqual([
      { message: { type: "PING" }, tabId: undefined },
      { message: { type: "TASK_COMPLETION" }, tabId: 7 },
    ]);
  });

  test("request resolves through the responder", async () => {
    const port = createFakeRuntimeMessagingPort((m) => ({ echo: m }));
    expect(await port.request({ q: 1 })).toEqual({ echo: { q: 1 } });
  });
});

describe("NavigationEventsPort fake", () => {
  test("routes each event to its own subscribers only", () => {
    const port = createFakeNavigationEventsPort();
    const completed = vi.fn();
    const errored = vi.fn();
    port.onCompleted(completed);
    port.onErrorOccurred(errored);

    port.emitCompleted({ tabId: 1, frameId: 0, url: "https://a.test" });
    port.emitErrorOccurred({
      tabId: 1,
      frameId: 0,
      url: "https://a.test",
      error: "net::ERR",
    });

    expect(completed).toHaveBeenCalledWith({
      tabId: 1,
      frameId: 0,
      url: "https://a.test",
    });
    expect(errored).toHaveBeenCalledWith({
      tabId: 1,
      frameId: 0,
      url: "https://a.test",
      error: "net::ERR",
    });
  });

  test("unsubscribe stops delivery", () => {
    const port = createFakeNavigationEventsPort();
    const listener = vi.fn();
    const off = port.onCommitted(listener);
    off();
    port.emitCommitted({ tabId: 1, frameId: 0, url: "https://a.test" });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("SchedulerPort fake", () => {
  test("createAlarm tracks; fire notifies; clearAlarm removes", async () => {
    const port = createFakeSchedulerPort();
    const pings: string[] = [];
    port.onAlarm((a) => pings.push(a.name));

    await port.createAlarm("keepalive", { periodInMinutes: 0.45 });
    expect(port.alarms.has("keepalive")).toBe(true);
    port.fire("keepalive");

    expect(await port.clearAlarm("keepalive")).toBe(true);
    port.fire("keepalive"); // cleared — no-op

    expect(pings).toEqual(["keepalive"]);
    expect(port.alarms.has("keepalive")).toBe(false);
  });
});
