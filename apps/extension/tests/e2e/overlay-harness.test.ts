import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOverlayHarnessRunner,
  type OverlayHarnessRunner,
} from "./helpers/overlay-harness";

describe("Overlay harness browser injection", () => {
  let runner: OverlayHarnessRunner;

  beforeAll(async () => {
    runner = await createOverlayHarnessRunner();
  }, 60_000);

  afterAll(async () => {
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
    expect(runner.pageErrors).toEqual([]);
  }, 60_000);
});
