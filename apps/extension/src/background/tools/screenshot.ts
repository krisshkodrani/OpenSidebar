import { logger } from "@/utils";
import {
  chromeBrowserPagePort,
  type BrowserPagePort,
} from "../environment";

interface ScreenshotOptions {
  format: "jpeg" | "png";
  quality: number;
}

/**
 * Check whether the given tab is the active (visible) tab in its window.
 * `captureVisibleTab` captures whatever is on screen — if the agent's tab
 * isn't active, the result is a wrong page or a black frame.
 */
export async function isTabActive(
  tabId: number,
  pagePort: BrowserPagePort = chromeBrowserPagePort,
): Promise<boolean> {
  try {
    const tab = await pagePort.getTab(tabId);
    return tab.active === true;
  } catch {
    return false;
  }
}

/**
 * Capture a screenshot of the visible tab for human-facing display
 * (sidebar debugging and the passive monitor) — never sent to an LLM.
 */
export async function takeScreenshotWithTags(
  tabId: number,
  options: ScreenshotOptions = {
    format: "jpeg",
    quality: 80,
  },
  pagePort: BrowserPagePort = chromeBrowserPagePort,
): Promise<{ dataUrl: string; success: boolean; error?: string }> {
  try {
    const tab = await pagePort.getTab(tabId);
    if (!tab.active) {
      return {
        dataUrl: "",
        success: false,
        error: "Tab is not active (screenshot would capture wrong tab)",
      };
    }
    if (tab.windowId == null) {
      return {
        dataUrl: "",
        success: false,
        error: "Tab window is unavailable",
      };
    }
    const dataUrl = await pagePort.captureVisibleTab(tab.windowId, {
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
