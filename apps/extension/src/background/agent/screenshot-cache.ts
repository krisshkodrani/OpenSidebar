/**
 * Module-level screenshot cache: allows parallel agent loops on the same tab
 * to share captured screenshots instead of each hitting the captureVisibleTab
 * quota (2/sec). Cached entries expire after 3 seconds.
 */
const SCREENSHOT_CACHE_TTL_MS = 3000;

export interface CachedScreenshotEntry {
  dataUrl: string;
  capturedAt: number;
  /** LP-9 transform metadata — present when the capture went through transformScreenshot. */
  scaleFactor?: number;
  /** Output image dimensions of the stored dataUrl (0/absent when unknown). */
  width?: number;
  height?: number;
}

const screenshotCache = new Map<number, CachedScreenshotEntry>();

function getFreshEntry(tabId: number): CachedScreenshotEntry | undefined {
  const entry = screenshotCache.get(tabId);
  if (!entry) return undefined;
  if (Date.now() - entry.capturedAt > SCREENSHOT_CACHE_TTL_MS) {
    screenshotCache.delete(tabId);
    return undefined;
  }
  return entry;
}

export function getCachedScreenshot(tabId: number): string | undefined {
  return getFreshEntry(tabId)?.dataUrl;
}

/** Full cache entry (dataUrl + transform metadata) when still fresh. */
export function getCachedScreenshotEntry(
  tabId: number,
): CachedScreenshotEntry | undefined {
  return getFreshEntry(tabId);
}

export function setCachedScreenshot(
  tabId: number,
  dataUrl: string,
  meta?: { scaleFactor?: number; width?: number; height?: number },
): void {
  screenshotCache.set(tabId, { dataUrl, capturedAt: Date.now(), ...meta });
}
