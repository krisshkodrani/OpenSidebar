/**
 * VL executor screenshot capture + reuse (LP-17b CM-5).
 *
 * The pre-extraction behavior re-captured and re-transformed a screenshot
 * every turn with no change detection. These tests prove the new reuse rule:
 * unchanged page fingerprint (and no canvas) → the previous dataUrl is
 * re-attached without any capture; anything else captures fresh.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import "../setup";

vi.mock("../../src/background/perception/screenshot-transform", () => ({
  transformScreenshot: vi.fn(async (dataUrl: string) => ({
    dataUrl: `transformed:${dataUrl}`,
    scaleFactor: 1,
    width: 1280,
    height: 800,
  })),
}));
vi.mock("../../src/background/agent/screenshot-cache", () => ({
  setCachedScreenshot: vi.fn(),
}));

import {
  captureVLExecutorScreenshot,
  createVLScreenshotState,
  type VLScreenshotHost,
} from "../../src/background/agent/vl-screenshot";
import type { DomSnapshot } from "../../src/types";

globalThis.chrome = {
  ...(globalThis.chrome ?? {}),
  tabs: {
    get: vi.fn(async () => ({ id: 7, active: true, windowId: 1 })),
    update: vi.fn(async () => ({})),
  },
} as any;

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Form",
    url: "https://example.test/apply",
    visibleContent: "Application form body",
    pageContent: "Application form body",
    elements: [
      {
        tag: 1,
        tagName: "input",
        role: "textbox",
        text: "",
        attributes: { type: "text", label: "Name" },
        rect: { x: 0, y: 0, width: 180, height: 24 },
        isVisible: true,
        isDisabled: false,
      },
    ],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function makeHost(currentSnapshot: DomSnapshot | null) {
  let executorScreenshot: string | null = "unset";
  const captureCalls: unknown[] = [];
  const events: Array<{ type: string }> = [];
  const host: VLScreenshotHost = {
    context: {
      getSnapshot: () => currentSnapshot,
      setScreenshotForExecutor: (dataUrl) => {
        executorScreenshot = dataUrl;
      },
      setPageInterpretation: () => {},
    },
    perception: { setScreenshotUrl: () => {} },
    traceRecorder: {
      recordEvent: (type) => events.push({ type }),
      recordPerception: () => {},
    },
    log: { warn: vi.fn() },
    imagePromptBudgetAllows: () => true,
    recordImagePromptBudgetExhausted: vi.fn(),
    captureVisibleTabWithRetry: vi.fn(async () => {
      captureCalls.push(1);
      return `raw-${captureCalls.length}`;
    }),
  };
  return {
    host,
    captureCalls,
    events,
    getExecutorScreenshot: () => executorScreenshot,
  };
}

describe("captureVLExecutorScreenshot (LP-17b CM-5)", () => {
  beforeEach(() => vi.clearAllMocks());

  test("first turn captures; identical page reuses without capturing", async () => {
    const snap = snapshot();
    const state = createVLScreenshotState();
    const h = makeHost(snap);

    await captureVLExecutorScreenshot(h.host, 7, state);
    expect(h.captureCalls.length).toBe(1);
    expect(h.getExecutorScreenshot()).toBe("transformed:raw-1");

    await captureVLExecutorScreenshot(h.host, 7, state);
    expect(h.captureCalls.length).toBe(1); // no second capture
    expect(h.getExecutorScreenshot()).toBe("transformed:raw-1"); // same bytes
    expect(h.events.some((e) => e.type === "vl_screenshot_reused")).toBe(true);
  });

  test("a changed page captures fresh", async () => {
    const state = createVLScreenshotState();
    const first = makeHost(snapshot());
    await captureVLExecutorScreenshot(first.host, 7, state);

    const changed = makeHost(
      snapshot({ pageContent: "Totally different content now shown" }),
    );
    await captureVLExecutorScreenshot(changed.host, 7, state);
    expect(changed.captureCalls.length).toBe(1);
    expect(changed.getExecutorScreenshot()).toBe("transformed:raw-1");
  });

  test("canvas on the page disables reuse (visual state can change silently)", async () => {
    const canvasSnap = snapshot({
      elements: [
        ...snapshot().elements,
        {
          tag: 2,
          tagName: "canvas",
          role: "img",
          text: "",
          attributes: {},
          rect: { x: 0, y: 40, width: 400, height: 300 },
          isVisible: true,
          isDisabled: false,
        },
      ],
    });
    const state = createVLScreenshotState();
    const h = makeHost(canvasSnap);
    await captureVLExecutorScreenshot(h.host, 7, state);
    await captureVLExecutorScreenshot(h.host, 7, state);
    expect(h.captureCalls.length).toBe(2); // captured both times
    expect(h.events.some((e) => e.type === "vl_screenshot_reused")).toBe(false);
  });

  test("budget exhaustion clears the screenshot and never reuses", async () => {
    const state = createVLScreenshotState();
    const h = makeHost(snapshot());
    h.host.imagePromptBudgetAllows = () => false;
    await captureVLExecutorScreenshot(h.host, 7, state);
    expect(h.getExecutorScreenshot()).toBeNull();
    expect(h.captureCalls.length).toBe(0);
  });

  test("capture failure clears the reuse state so the next turn re-captures", async () => {
    const state = createVLScreenshotState();
    const h = makeHost(snapshot());
    await captureVLExecutorScreenshot(h.host, 7, state);
    expect(state.lastDataUrl).not.toBeNull();

    (h.host.captureVisibleTabWithRetry as any) = vi.fn(async () => {
      throw new Error("capture boom");
    });
    // Force a change so the reuse path doesn't shortcut before capturing.
    const changed = snapshot({ pageContent: "changed body text here" });
    (h.host.context.getSnapshot as any) = () => changed;
    await captureVLExecutorScreenshot(h.host, 7, state);
    expect(state.lastDataUrl).toBeNull();
    expect(h.getExecutorScreenshot()).toBeNull();
  });
});
