import { afterEach, describe, expect, test } from "vitest";
import { AgentStatus, MessageSource } from "../../src/types";
import {
  emitOverlayRuntimeMessage,
  getOverlayRuntimeHarness,
  subscribeOverlayUiMessages,
} from "../../src/overlay/driver";
import {
  createOverlayUiRuntimeHarness,
  type OverlayUiRuntimeHarness,
} from "../../src/overlay/runtime";

const harnesses: OverlayUiRuntimeHarness[] = [];

function trackHarness(harness: OverlayUiRuntimeHarness): OverlayUiRuntimeHarness {
  harnesses.push(harness);
  return harness;
}

describe("overlay driver", () => {
  afterEach(() => {
    for (const harness of harnesses.splice(0)) {
      harness.dispose();
    }
    delete (window as Window & { __opensidebarOverlayRuntime?: unknown })
      .__opensidebarOverlayRuntime;
  });

  test("feeds background-style messages into the overlay runtime", () => {
    const harness = trackHarness(createOverlayUiRuntimeHarness());
    const received: string[] = [];
    harness.port.subscribeMessages((message) => {
      received.push(message.type);
    });

    emitOverlayRuntimeMessage({
      type: "AGENT_STATUS",
      source: MessageSource.BACKGROUND,
      requestId: "status-1",
      payload: { status: AgentStatus.THINKING, detail: "Working" },
    });
    expect(received).toEqual(["AGENT_STATUS"]);

    harness.dispose();
    emitOverlayRuntimeMessage({
      type: "AGENT_STATUS",
      source: MessageSource.BACKGROUND,
      requestId: "status-2",
      payload: { status: AgentStatus.IDLE, detail: "Done" },
    });
    expect(received).toEqual(["AGENT_STATUS"]);
  });

  test("observes outbound UI messages from the overlay runtime", async () => {
    const harness = trackHarness(createOverlayUiRuntimeHarness());
    const messages: unknown[] = [];
    const unsubscribe = subscribeOverlayUiMessages((message) => {
      messages.push(message);
    });

    await harness.port.sendMessage({
      type: "USER_CHAT",
      source: harness.port.source,
      requestId: "request-1",
      payload: { text: "Summarize this page", tabId: 1 },
    });
    expect(messages).toHaveLength(1);

    unsubscribe();
    await harness.port.sendMessage({
      type: "USER_CHAT",
      source: harness.port.source,
      requestId: "request-2",
      payload: { text: "Find the total", tabId: 1 },
    });
    expect(messages).toHaveLength(1);
  });

  test("reads the mounted overlay runtime handle when present", () => {
    const harness = trackHarness(createOverlayUiRuntimeHarness());
    (
      window as Window & { __opensidebarOverlayRuntime?: OverlayUiRuntimeHarness }
    ).__opensidebarOverlayRuntime = harness;

    expect(getOverlayRuntimeHarness()).toBe(harness);
  });
});
