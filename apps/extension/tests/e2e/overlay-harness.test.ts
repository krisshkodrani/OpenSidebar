import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOverlayHarnessRunner,
  type OverlayHarnessRunner,
} from "./helpers/overlay-harness";

describe("Overlay harness browser injection", () => {
  let runner: OverlayHarnessRunner;

  beforeEach(async () => {
    runner = await createOverlayHarnessRunner();
  }, 60_000);

  afterEach(async () => {
    await runner?.close().catch(() => {});
  });

  it("injects the built overlay bundle and round-trips messages through browser events", async () => {
    await runner.inject();
    const mounted = await runner.getMountState();
    expect(mounted).toEqual({
      hasHost: true,
      hasShadowRoot: true,
      hasRoot: true,
      runtimeSource: "ui",
    });

    await runner.startMessageCapture();
    await runner.sendUiMessage({
      type: "USER_CHAT",
      source: "ui",
      requestId: "overlay-smoke-user-chat",
      payload: {
        text: "Smoke test message",
        tabId: 1,
        workspaceId: null,
      },
    });
    await runner.emitRuntimeMessage({
      type: "AGENT_STATUS",
      source: "background",
      requestId: "overlay-smoke-status",
      payload: { status: "THINKING", detail: "Working" },
    });

    const roundTrip = await runner.readMessageCapture();
    expect(roundTrip.outboundTypes).toContain("USER_CHAT");
    expect(roundTrip.inboundTypes).toContain("AGENT_STATUS");

    await runner.sendFeedbackThroughUi("Try a more direct path.");
    const feedbackCapture = await runner.readMessageCapture();
    const feedbackMessage = feedbackCapture.outboundMessages.find(
      (message): message is {
        type: string;
        source: string;
        payload: { text?: string; isFeedback?: boolean };
      } =>
        Boolean(
          message &&
            typeof message === "object" &&
            (message as { type?: unknown }).type === "USER_CHAT" &&
            (message as { payload?: { isFeedback?: unknown } }).payload
              ?.isFeedback === true,
        ),
    );
    expect(feedbackMessage).toMatchObject({
      type: "USER_CHAT",
      source: "ui",
      payload: {
        text: "Try a more direct path.",
        isFeedback: true,
      },
    });
    expect(runner.pageErrors).toEqual([]);
  }, 60_000);

  it("drives visible overlay state transitions with a fake background controller", async () => {
    await runner.inject();
    await runner.startMessageCapture();
    await runner.startFakeBackgroundController();

    await runner.emitRuntimeMessage({
      type: "AGENT_STATUS",
      source: "background",
      requestId: "overlay-fake-ready",
      payload: {
        status: "THINKING",
        detail: "Fake background ready for feedback",
      },
    });
    await runner.waitForOverlayText("Fake background ready for feedback");

    await runner.sendFeedbackThroughUi("Use the visible heading.");
    await runner.waitForFakeBackgroundHandled("USER_CHAT");
    await runner.waitForOverlayText(
      "Fake overlay response: Use the visible heading.",
    );
    await runner.waitForOverlayText("Task completed");

    const capture = await runner.readMessageCapture();
    expect(capture.inboundTypes).toEqual(
      expect.arrayContaining([
        "AGENT_STATUS",
        "STREAM_CHUNK",
        "TASK_COMPLETION",
      ]),
    );

    const fakeBackground = await runner.readFakeBackgroundState();
    expect(fakeBackground.handledTypes).toContain("USER_CHAT");
    expect(fakeBackground.emittedTypes).toEqual(
      expect.arrayContaining([
        "AGENT_STATUS",
        "STREAM_CHUNK",
        "TASK_COMPLETION",
      ]),
    );
    expect(fakeBackground.lastUserText).toBe("Use the visible heading.");
    expect(runner.pageErrors).toEqual([]);
  }, 60_000);
});
