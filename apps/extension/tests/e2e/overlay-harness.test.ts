import { afterEach, describe, expect, it } from "vitest";
import {
  createOverlayHarnessRunner,
  type OverlayHarnessRunnerOptions,
  type OverlayHarnessRunner,
} from "./helpers/overlay-harness";

describe("Overlay harness browser injection", () => {
  let runner: OverlayHarnessRunner | null = null;

  afterEach(async () => {
    await runner?.close().catch(() => {});
    runner = null;
  });

  async function setupRunner(
    options?: OverlayHarnessRunnerOptions,
  ): Promise<OverlayHarnessRunner> {
    runner = await createOverlayHarnessRunner(options);
    return runner;
  }

  it("injects the built overlay bundle and round-trips messages through browser events", async () => {
    const runner = await setupRunner();
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
    const runner = await setupRunner();
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

  it("round-trips rendered pause and resume controls through the fake background", async () => {
    const runner = await setupRunner();
    await runner.inject();
    await runner.startMessageCapture();
    await runner.startFakeBackgroundController();

    await runner.emitRuntimeMessage({
      type: "AGENT_STATUS",
      source: "background",
      requestId: "overlay-controls-running",
      payload: {
        status: "THINKING",
        detail: "Fake background ready for controls",
      },
    });
    await runner.waitForOverlayText("Fake background ready for controls");

    await runner.clickOverlayButton("Pause agent");
    await runner.waitForFakeBackgroundHandled("PAUSE_AGENT");
    await runner.waitForOverlayText("Paused");

    await runner.clickOverlayButton("Resume agent");
    await runner.waitForFakeBackgroundHandled("RESUME_AGENT");
    await runner.waitForOverlayText("Fake background resumed");

    await runner.clickOverlayButton("Stop agent");
    await runner.waitForFakeBackgroundHandled("STOP_AGENT");

    const capture = await runner.readMessageCapture();
    expect(capture.outboundTypes).toEqual(
      expect.arrayContaining(["PAUSE_AGENT", "RESUME_AGENT", "STOP_AGENT"]),
    );

    const fakeBackground = await runner.readFakeBackgroundState();
    expect(fakeBackground.handledTypes).toEqual(
      expect.arrayContaining(["PAUSE_AGENT", "RESUME_AGENT", "STOP_AGENT"]),
    );
    expect(fakeBackground.emittedTypes).toEqual(
      expect.arrayContaining(["AGENT_STATUS"]),
    );
    expect(runner.pageErrors).toEqual([]);
  }, 60_000);

  it("starts an idle task and completes it through the fake background", async () => {
    const runner = await setupRunner({
      runtimeOptions: {
        storage: {
          local: {
            fireworksApiKey_local: "fake-fireworks-key",
          },
        },
      },
    });
    await runner.inject();
    await runner.waitForOverlayText("Hi! What can I help with?");
    await runner.startMessageCapture();
    await runner.startFakeBackgroundController();

    await runner.sendPrimaryMessageThroughUi("Summarize the generic page.");
    await runner.waitForFakeBackgroundHandled("USER_CHAT");
    await runner.waitForOverlayText("Summarize the generic page.");
    await runner.waitForOverlayText(
      "Fake overlay response: Summarize the generic page.",
    );
    await runner.waitForOverlayText("Task completed");

    const capture = await runner.readMessageCapture();
    const taskMessage = capture.outboundMessages.find(
      (message): message is {
        type: string;
        source: string;
        payload: { text?: string; isFeedback?: boolean };
      } =>
        Boolean(
          message &&
            typeof message === "object" &&
            (message as { type?: unknown }).type === "USER_CHAT" &&
            (message as { payload?: { text?: unknown } }).payload?.text ===
              "Summarize the generic page.",
        ),
    );
    expect(taskMessage).toMatchObject({
      type: "USER_CHAT",
      source: "ui",
      payload: {
        text: "Summarize the generic page.",
      },
    });
    expect(taskMessage?.payload.isFeedback).toBeUndefined();
    expect(capture.inboundTypes).toEqual(
      expect.arrayContaining([
        "AGENT_STATUS",
        "STREAM_CHUNK",
        "TASK_COMPLETION",
      ]),
    );
    expect(runner.pageErrors).toEqual([]);
  }, 60_000);

  it("exposes seeded runtime tab and storage state without Chrome APIs", async () => {
    const runner = await setupRunner({
      runtimeOptions: {
        tab: {
          id: 42,
          url: "https://example.test/reports/quarterly",
          title: "Quarterly report",
          windowId: 7,
        },
        window: { id: 7 },
        storage: {
          local: {
            fireworksApiKey_local: "fake-fireworks-key",
            "overlay:local-probe": { ok: true },
          },
          sync: {
            userSettings: {
              providerMode: "fireworks",
              showSessionMetrics: false,
            },
          },
          session: {
            "overlay:session-probe": "session-value",
          },
        },
      },
    });
    await runner.inject();

    const snapshot = await runner.readRuntimeSnapshot();
    expect(snapshot.activeTab).toMatchObject({
      id: 42,
      url: "https://example.test/reports/quarterly",
      title: "Quarterly report",
      active: true,
      windowId: 7,
    });
    expect(snapshot.currentWindow).toEqual({ id: 7 });
    expect(snapshot.storage.local["overlay:local-probe"]).toEqual({
      ok: true,
    });
    expect(snapshot.storage.sync.userSettings).toMatchObject({
      providerMode: "fireworks",
      showSessionMetrics: false,
    });
    expect(snapshot.storage.session["overlay:session-probe"]).toBe(
      "session-value",
    );
    expect(runner.pageErrors).toEqual([]);
  }, 60_000);

  it("exposes generic page facts through the runner browser-page port", async () => {
    const runner = await setupRunner();
    await runner.inject();

    await expect(runner.browserPage.getUrl()).resolves.toContain(
      "/overlay-smoke",
    );
    await expect(runner.browserPage.getTitle()).resolves.toBe(
      "Overlay Harness Smoke",
    );
    await expect(
      runner.browserPage.evaluate(
        () => document.querySelector("h1")?.textContent,
      ),
    ).resolves.toBe("Generic page");

    const screenshot = await runner.browserPage.screenshot();
    expect(screenshot.byteLength).toBeGreaterThan(8);
    expect(Array.from(screenshot.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(runner.pageErrors).toEqual([]);
  }, 60_000);
});
