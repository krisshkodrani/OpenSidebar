import { describe, expect, test, vi } from "vitest";
import type { DomSnapshot } from "../../src/types";
import { resolveInitialSnapshot } from "../../src/background/agent/initial-snapshot";

function makeSnapshot(url = "https://example.test/"): DomSnapshot {
  return {
    title: "Example",
    url,
    elements: [],
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 600 },
  };
}

function makeWarmupCache(entry: unknown = null) {
  return {
    getPending: vi.fn(() => null),
    get: vi.fn(() => entry),
    consume: vi.fn(),
  };
}

const log = {
  info: vi.fn(),
  warn: vi.fn(),
};

describe("resolveInitialSnapshot", () => {
  test("returns the orchestrator snapshot and consumes warmup", async () => {
    const snapshot = makeSnapshot();
    const warmupCache = makeWarmupCache();

    const result = await resolveInitialSnapshot({
      tabId: 123,
      initialSnapshot: snapshot,
      log,
      refreshSnapshot: vi.fn(),
      getSnapshot: vi.fn(),
      warmupCache,
      ensureContentScript: vi.fn(),
    });

    expect(result.snapshot).toBe(snapshot);
    expect(warmupCache.getPending).not.toHaveBeenCalled();
    expect(warmupCache.consume).toHaveBeenCalledWith(123);
  });

  test("uses pending warmup snapshot with perception metadata", async () => {
    const snapshot = makeSnapshot();
    const warmupCache = makeWarmupCache();
    warmupCache.getPending.mockReturnValue(
      Promise.resolve({
        snapshot,
        perception: {
          interpretation: "Page summary",
          providerId: "openrouter",
          durationMs: 42,
        },
        screenshotUrl: "data:image/png;base64,warmup",
        timestamp: Date.now(),
      }),
    );

    const result = await resolveInitialSnapshot({
      tabId: 123,
      log,
      refreshSnapshot: vi.fn(),
      getSnapshot: vi.fn(),
      warmupCache,
      ensureContentScript: vi.fn(),
    });

    expect(result.snapshot).toBe(snapshot);
    expect(result.warmupPerception?.interpretation).toBe("Page summary");
    expect(result.warmupScreenshot).toBe("data:image/png;base64,warmup");
    expect(warmupCache.get).not.toHaveBeenCalled();
    expect(warmupCache.consume).toHaveBeenCalledWith(123);
  });

  test("fetches a fallback snapshot when warmup is unavailable", async () => {
    const snapshot = makeSnapshot("https://fallback.test/");
    const warmupCache = makeWarmupCache();
    const refreshSnapshot = vi.fn(async () => 3);
    const getSnapshot = vi.fn(() => snapshot);
    const ensureContentScript = vi.fn(async () => undefined);

    const result = await resolveInitialSnapshot({
      tabId: 123,
      log,
      refreshSnapshot,
      getSnapshot,
      warmupCache,
      ensureContentScript,
    });

    expect(ensureContentScript).toHaveBeenCalledWith(123, 5000);
    expect(refreshSnapshot).toHaveBeenCalledWith(123);
    expect(result.snapshot).toBe(snapshot);
    expect(warmupCache.consume).toHaveBeenCalledWith(123);
  });
});
