import { logger } from "@/utils";

interface ScreenshotOptions {
  format: "jpeg" | "png";
  quality: number;
}

/**
 * Capture a screenshot of the visible tab.
 * Used for human debugging display in the sidebar (not sent to LLM).
 */
export async function takeScreenshotWithTags(
  tabId: number,
  options: ScreenshotOptions = {
    format: "jpeg",
    quality: 80,
  },
): Promise<{ dataUrl: string; success: boolean; error?: string }> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: options.format,
      quality: options.quality,
    });

    return { dataUrl, success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("screenshot", "Failed to capture screenshot", { error: msg });
    return { dataUrl: "", success: false, error: msg };
  }
}
