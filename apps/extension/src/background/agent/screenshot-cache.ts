/**
 * Module-level screenshot cache: allows parallel agent loops on the same tab
 * to share captured screenshots instead of each hitting the captureVisibleTab
 * quota (2/sec). Cached entries expire after 3 seconds.
 */
const SCREENSHOT_CACHE_TTL_MS = 3000;
const screenshotCache = new Map<
  number,
  { dataUrl: string; capturedAt: number }
>();

export function getCachedScreenshot(tabId: number): string | undefined {
  const entry = screenshotCache.get(tabId);
  if (!entry) return undefined;
  if (Date.now() - entry.capturedAt > SCREENSHOT_CACHE_TTL_MS) {
    screenshotCache.delete(tabId);
    return undefined;
  }
  return entry.dataUrl;
}

export function setCachedScreenshot(tabId: number, dataUrl: string): void {
  screenshotCache.set(tabId, { dataUrl, capturedAt: Date.now() });
}
