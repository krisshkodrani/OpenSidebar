import { logger } from "@/utils";

interface ScreenshotOptions {
  format: "jpeg" | "png";
  quality: number;
  includeTags: boolean;
}

/**
 * Capture a screenshot of the visible tab, optionally with SoM tag overlays.
 * Used for human debugging display in the sidebar (not sent to LLM).
 */
export async function takeScreenshotWithTags(
  tabId: number,
  options: ScreenshotOptions = {
    format: "jpeg",
    quality: 80,
    includeTags: true,
  },
): Promise<{ dataUrl: string; success: boolean; error?: string }> {
  try {
    if (options.includeTags) {
      await chrome.tabs.sendMessage(tabId, {
        type: "ENABLE_SCREENSHOT_MODE",
        requestId: crypto.randomUUID(),
        source: "background",
        payload: { showTags: true },
      });
      // Wait for tag overlays to render
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // captureVisibleTab takes windowId (optional), then options.
    // It captures the visible area of the currently active tab in the given window.
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: options.format,
      quality: options.quality,
    });

    if (options.includeTags) {
      await chrome.tabs.sendMessage(tabId, {
        type: "DISABLE_SCREENSHOT_MODE",
        requestId: crypto.randomUUID(),
        source: "background",
        payload: {},
      });
    }

    return { dataUrl, success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("screenshot", "Failed to capture screenshot", { error: msg });
    return { dataUrl: "", success: false, error: msg };
  }
}
