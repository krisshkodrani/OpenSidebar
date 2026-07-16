/**
 * Delivery contract for RuntimeMessagingPort (RFC LP-8 M2 / LP-15 Phase 5).
 *
 * `chrome.runtime.sendMessage` does not deliver back to the context that sent it.
 * The orchestrator broadcasts TASK_COMPLETION *from the service worker*, and the
 * browser bridge's `createAgentRuntime(chromeRuntimeEnvironment)` subscribes
 * *in that same service worker* — so the bridge never sees a completion and every
 * thick tool call hangs until the host's 120s timeout. The sidepanel works only
 * because it is a different context.
 *
 * So the port owes its own subscribers a local hand-off alongside the chrome send.
 *
 * The chrome mock below deliberately models the real semantic: `sendMessage`
 * records the message and never invokes `onMessage` listeners. A mock that looped
 * back would make this file green while production stayed broken — which is
 * exactly how this survived (see `tests/headless/runtime-smoke.test.ts`, whose
 * fake port delivers by fiat via `deliver()`).
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import "../setup";
import { chromeRuntimeMessagingPort } from "../../src/background/environment/chrome";
import { createAgentRuntime } from "../../src/background/runtime";
import type { RuntimeEnvironment } from "../../src/background/environment/types";

type ChromeListener = (
  message: unknown,
  sender: { tab?: { id?: number } },
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

let sent: unknown[];
let listeners: Set<ChromeListener>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test global juggling
let savedChrome: any;

beforeEach(() => {
  sent = [];
  listeners = new Set<ChromeListener>();
  savedChrome = (globalThis as any).chrome;
  (globalThis as any).chrome = {
    runtime: {
      // Faithful to Chrome: the sending context is NOT a recipient.
      sendMessage: async (message: unknown) => {
        sent.push(message);
      },
      onMessage: {
        addListener: (l: ChromeListener) => listeners.add(l),
        removeListener: (l: ChromeListener) => listeners.delete(l),
      },
    },
  };
});

afterEach(() => {
  (globalThis as any).chrome = savedChrome;
});

describe("chrome runtime messaging port — delivery", () => {
  test("canary: the mock does not loop back to the sender", async () => {
    let fired = false;
    (globalThis as any).chrome.runtime.onMessage.addListener(() => {
      fired = true;
      return undefined;
    });

    await (globalThis as any).chrome.runtime.sendMessage({ type: "ANYTHING" });

    // If this ever fails, the mock has stopped modelling Chrome and every
    // assertion below becomes meaningless.
    expect(fired).toBe(false);
  });

  test("broadcast reaches a subscriber registered through the same port", () => {
    const received: unknown[] = [];
    const off = chromeRuntimeMessagingPort.onMessage((message) => {
      received.push(message);
    });

    chromeRuntimeMessagingPort.broadcast({
      type: "TASK_COMPLETION",
      workspaceId: "ws-1",
    });

    expect(received).toEqual([{ type: "TASK_COMPLETION", workspaceId: "ws-1" }]);
    off();
  });

  test("broadcast still goes out to other contexts (the sidepanel path)", () => {
    chromeRuntimeMessagingPort.onMessage(() => {});

    chromeRuntimeMessagingPort.broadcast({ type: "TASK_COMPLETION" });

    // Local delivery must be ADDITIVE — the cross-context send is how the
    // sidepanel learns anything at all.
    expect(sent).toEqual([{ type: "TASK_COMPLETION" }]);
  });

  test("unsubscribing stops local delivery too", () => {
    const received: unknown[] = [];
    const off = chromeRuntimeMessagingPort.onMessage((m) => received.push(m));

    off();
    chromeRuntimeMessagingPort.broadcast({ type: "TASK_COMPLETION" });

    expect(received).toEqual([]);
    expect(listeners.size).toBe(0);
  });

  test("a throwing subscriber does not break the broadcast", () => {
    const received: unknown[] = [];
    const offBad = chromeRuntimeMessagingPort.onMessage(() => {
      throw new Error("subscriber blew up");
    });
    const offGood = chromeRuntimeMessagingPort.onMessage((m) => received.push(m));

    expect(() =>
      chromeRuntimeMessagingPort.broadcast({ type: "TASK_COMPLETION" }),
    ).not.toThrow();
    expect(received).toEqual([{ type: "TASK_COMPLETION" }]);
    expect(sent).toEqual([{ type: "TASK_COMPLETION" }]);

    offBad();
    offGood();
  });
});

describe("agent runtime over the real chrome port", () => {
  test("onTaskCompletion fires for a completion the service worker broadcast", () => {
    // This is the exact production path the browser bridge depends on:
    // orchestrator (SW) broadcasts -> createAgentRuntime (SW) must observe it.
    const runtime = createAgentRuntime(
      { messaging: chromeRuntimeMessagingPort } as unknown as RuntimeEnvironment,
      { orchestrator: { startTask: async () => {}, stopTask: async () => {}, resolveApprovalResponse: () => true } },
    );

    const seen: Array<{ workspaceId: string; payload: unknown }> = [];
    runtime.onTaskCompletion((workspaceId, payload) =>
      seen.push({ workspaceId, payload }),
    );

    chromeRuntimeMessagingPort.broadcast({
      type: "TASK_COMPLETION",
      workspaceId: "bridge-abc",
      payload: { status: "completed", summary: "done" },
    });

    expect(seen).toEqual([
      {
        workspaceId: "bridge-abc",
        payload: { status: "completed", summary: "done" },
      },
    ]);
    runtime.dispose();
  });

  test("dispose stops local delivery", () => {
    const runtime = createAgentRuntime(
      { messaging: chromeRuntimeMessagingPort } as unknown as RuntimeEnvironment,
      { orchestrator: { startTask: async () => {}, stopTask: async () => {}, resolveApprovalResponse: () => true } },
    );
    const seen: string[] = [];
    runtime.onTaskCompletion((workspaceId) => seen.push(workspaceId));

    runtime.dispose();
    chromeRuntimeMessagingPort.broadcast({
      type: "TASK_COMPLETION",
      workspaceId: "ws-1",
      payload: {},
    });

    expect(seen).toEqual([]);
  });
});
