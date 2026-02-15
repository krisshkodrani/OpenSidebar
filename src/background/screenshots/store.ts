/**
 * In-memory ring buffer for recent debug screenshots.
 * Screenshots are ephemeral — they do not persist across service worker restarts.
 */

interface ScreenshotEntry {
  id: string;
  tabId: number;
  dataUrl: string;
  context: string;
  timestamp: number;
  url: string;
}

const MAX_SCREENSHOTS = 20;
const screenshotStore: ScreenshotEntry[] = [];

export function storeScreenshot(entry: Omit<ScreenshotEntry, "id">): string {
  const id = crypto.randomUUID();
  screenshotStore.push({ ...entry, id });
  if (screenshotStore.length > MAX_SCREENSHOTS) {
    screenshotStore.shift();
  }
  return id;
}

export function getScreenshots(): ScreenshotEntry[] {
  return [...screenshotStore];
}

export function clearScreenshots(): void {
  screenshotStore.length = 0;
}
