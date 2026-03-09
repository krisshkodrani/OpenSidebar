import { logger } from "@/utils";

interface ScreenshotOptions {
  format: "jpeg" | "png";
  quality: number;
}

/**
 * Check whether the given tab is the active (visible) tab in its window.
 * `captureVisibleTab` captures whatever is on screen — if the agent's tab
 * isn't active, the result is a wrong page or a black frame.
 */
export async function isTabActive(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.active === true;
  } catch {
    return false;
  }
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
    if (!tab.active) {
      return { dataUrl: "", success: false, error: "Tab is not active (screenshot would capture wrong tab)" };
    }
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
