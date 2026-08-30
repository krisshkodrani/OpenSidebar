import { beforeEach, describe, expect, test, vi } from "vitest";
import type { DomSnapshot } from "../../src/types";
import {
  REGION_ZOOM_TURN_CAP,
  emptyRegionZoomState,
  executeInspectRegion,
  type RegionZoomHost,
} from "../../src/background/agent/region-zoom";
import { setCachedScreenshot } from "../../src/background/agent/screenshot-cache";

vi.mock("../../src/background/perception/screenshot-transform", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/background/perception/screenshot-transform")
    >();
  return {
    ...actual,
    cropScreenshotRegion: vi.fn(async () => ({
      ok: true as const,
      dataUrl: "data:image/png;base64,CROP",
    })),
    transformScreenshot: vi.fn(async () => ({
      dataUrl: "data:image/jpeg;base64,TRANSFORMED",
      scaleFactor: 1,
      width: 1280,
      height: 800,
      capturedWidth: 1280,
      capturedHeight: 800,
    })),
  };
});

import { cropScreenshotRegion } from "../../src/background/perception/screenshot-transform";

let nextTabId = 9000;

function makeSnapshot(): DomSnapshot {
  return {
    url: "https://example.com",
    title: "Example",
    elements: [
      {
        tag: 7,
        tagName: "canvas",
        role: "img",
        text: "",
        attributes: {},
        rect: { x: 40, y: 60, width: 200, height: 120 },
        isVisible: true,
        isDisabled: false,
      },
    ],
    viewport: { width: 1280, height: 800 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 800 },
  } as unknown as DomSnapshot;
}

function makeHost(overrides: Partial<RegionZoomHost> = {}): {
  host: RegionZoomHost;
  events: unknown[];
  staged: unknown[];
} {
  const events: unknown[] = [];
  const staged: unknown[] = [];
  const host: RegionZoomHost = {
    turnCount: 1,
    useVLExecutor: true,
    getSnapshot: () => makeSnapshot(),
    imagePromptBudgetAllows: () => true,
    recordImagePromptBudgetExhausted: vi.fn(),
    observationIsCurrent: async () => true,
    captureVisibleTab: async () => "data:image/jpeg;base64,FULL",
    resolveTagRect: async () => ({ x: 40, y: 60, width: 200, height: 120 }),
    recordInspectRegionEvent: (data) => events.push(data),
    setRegionZoomForExecutor: (zoom) => staged.push(zoom),
    ...overrides,
  };
  return { host, events, staged };
}

describe("executeInspectRegion (LP-13)", () => {
  let tabId: number;

  beforeEach(() => {
    tabId = nextTabId++;
    setCachedScreenshot(tabId, "data:image/jpeg;base64,FULL", {
      scaleFactor: 1,
      width: 1280,
      height: 800,
    });
  });

  test("VL turn: stages the crop for the executor and reports the attachment", async () => {
    const { host, events, staged } = makeHost();
    const state = emptyRegionZoomState();

    const result = await executeInspectRegion(
      host,
      state,
      { x: 100, y: 100, width: 200, height: 100, purpose: "read tiny label" },
      tabId,
    );

    expect(result).toContain("attached to your next view");
    expect(staged).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      mode: "unified_vl",
      purpose: "read tiny label",
      upscale: 4,
    });
    expect(state.count).toBe(1);
  });

  test("text-only turn still stages the crop into the executor", async () => {
    const { host, staged } = makeHost({ useVLExecutor: false });

    const result = await executeInspectRegion(
      host,
      emptyRegionZoomState(),
      { x: 100, y: 100, width: 200, height: 100 },
      tabId,
    );

    // inspect_region is a vision request — the crop always rides into the
    // (VL-capable) executor's next view, regardless of the turn's mode.
    expect(result).toContain("magnification");
    expect(staged).toHaveLength(1);
  });

  test("id sugar resolves the live rect and records the requested id", async () => {
    const resolveTagRect = vi.fn(async () => ({
      x: 40,
      y: 60,
      width: 200,
      height: 120,
    }));
    const { host, events } = makeHost({ resolveTagRect });

    const result = await executeInspectRegion(
      host,
      emptyRegionZoomState(),
      { id: 7 },
      tabId,
    );

    expect(resolveTagRect).toHaveBeenCalledWith(7);
    expect(result).toContain("around [7]");
    expect(events[0]).toMatchObject({ requestedId: 7 });
  });

  test("unknown tag id refuses with bad_args", async () => {
    const { host, events } = makeHost({ resolveTagRect: async () => null });

    const result = await executeInspectRegion(
      host,
      emptyRegionZoomState(),
      { id: 99 },
      tabId,
    );

    expect(result).toContain("[99]");
    expect(events[0]).toMatchObject({ refusedReason: "bad_args" });
  });

  test("neither id nor a full rect refuses with bad_args", async () => {
    const { host, events } = makeHost();

    const result = await executeInspectRegion(
      host,
      emptyRegionZoomState(),
      { x: 10, y: 10 },
      tabId,
    );

    expect(result).toContain("needs either id");
    expect(events[0]).toMatchObject({ refusedReason: "bad_args" });
  });

  test("caps zooms per turn and resets on the next turn", async () => {
    const { host, events } = makeHost();
    const state = emptyRegionZoomState();
    const args = { x: 100, y: 100, width: 200, height: 100 };

    await executeInspectRegion(host, state, args, tabId);
    setCachedScreenshot(tabId, "data:image/jpeg;base64,FULL", {
      scaleFactor: 1,
      width: 1280,
      height: 800,
    });
    await executeInspectRegion(host, state, args, tabId);
    setCachedScreenshot(tabId, "data:image/jpeg;base64,FULL", {
      scaleFactor: 1,
      width: 1280,
      height: 800,
    });
    const third = await executeInspectRegion(host, state, args, tabId);

    expect(third).toContain(`limit reached for this turn (${REGION_ZOOM_TURN_CAP})`);
    expect(events.at(-1)).toMatchObject({ refusedReason: "turn_cap" });

    // Next turn: the cap resets.
    const nextTurnHost = makeHost({ turnCount: 2 }).host;
    setCachedScreenshot(tabId, "data:image/jpeg;base64,FULL", {
      scaleFactor: 1,
      width: 1280,
      height: 800,
    });
    const fresh = await executeInspectRegion(nextTurnHost, state, args, tabId);
    expect(fresh).toContain("attached to your next view");
  });

  test("budget exhaustion refuses and records the source", async () => {
    const recordImagePromptBudgetExhausted = vi.fn();
    const { host, events } = makeHost({
      imagePromptBudgetAllows: () => false,
      recordImagePromptBudgetExhausted,
    });

    const result = await executeInspectRegion(
      host,
      emptyRegionZoomState(),
      { x: 100, y: 100, width: 200, height: 100 },
      tabId,
    );

    expect(result).toContain("Image budget");
    expect(recordImagePromptBudgetExhausted).toHaveBeenCalledWith(
      1,
      "inspect_region",
    );
    expect(events[0]).toMatchObject({ refusedReason: "budget" });
  });

  test("rejects a crop when its model observation is stale", async () => {
    const observationIsCurrent = vi.fn(async () => false);
    const { host, events, staged } = makeHost({ observationIsCurrent });

    const result = await executeInspectRegion(
      host,
      emptyRegionZoomState(),
      { x: 100, y: 100, width: 200, height: 100 },
      tabId,
    );

    expect(result).toContain("fresh observation");
    expect(staged).toHaveLength(0);
    expect(events[0]).toMatchObject({ refusedReason: "stale_observation" });
  });

  test("fresh capture crops from the RAW image, not the transformed cache copy", async () => {
    const { host } = makeHost({
      captureVisibleTab: async () => "data:image/jpeg;base64,RAWCAPTURE",
    });
    const coldTabId = nextTabId++; // no cache entry — forces a fresh capture

    const result = await executeInspectRegion(
      host,
      emptyRegionZoomState(),
      { x: 100, y: 100, width: 200, height: 100 },
      coldTabId,
    );

    expect(result).toContain("attached to your next view");
    const lastCall = vi.mocked(cropScreenshotRegion).mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("data:image/jpeg;base64,RAWCAPTURE");
  });

  test("capture failure with no cached screenshot refuses with capture_failed", async () => {
    const { host, events } = makeHost({
      captureVisibleTab: async () => {
        throw new Error("quota");
      },
    });
    const coldTabId = nextTabId++; // no cache entry seeded

    const result = await executeInspectRegion(
      host,
      emptyRegionZoomState(),
      { x: 100, y: 100, width: 200, height: 100 },
      coldTabId,
    );

    expect(result).toContain("capture failed");
    expect(events[0]).toMatchObject({ refusedReason: "capture_failed" });
  });
});
