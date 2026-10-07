import type { Page } from "puppeteer";
import {
  openHelperPage,
  withTimeout,
  type ExtensionContext,
} from "../apps/extension/tests/e2e/helpers/browser.js";

/** Exercise production's capture API before dispatching any paid work. */
export async function preflightBrowserCapture(
  ctx: ExtensionContext,
  target: Pick<Page, "bringToFront">,
  tabId: number,
  timeoutMs = 5_000,
): Promise<{ width: number; height: number; bytes: number }> {
  return withTimeout((async () => {
    const helper = await openHelperPage(ctx);
    await target.bringToFront();
    const dataUrl = await helper.evaluate(async (targetTabId: number) => {
      const tab = await chrome.tabs.get(targetTabId);
      const active = await chrome.tabs.query({ windowId: tab.windowId, active: true });
      if (active[0]?.id !== targetTabId) {
        throw new Error("Capture preflight target is not the active tab");
      }
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const after = await chrome.tabs.query({ windowId: tab.windowId, active: true });
      if (after[0]?.id !== targetTabId) {
        throw new Error("Capture preflight target changed during capture");
      }
      return image;
    }, tabId);
    if (!dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("Capture preflight returned no PNG image");
    }
    const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
    if (png.length < 33 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        png.toString("ascii", 12, 16) !== "IHDR") {
      throw new Error("Capture preflight returned an invalid PNG header");
    }
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (!width || !height) throw new Error("Capture preflight returned an empty image");
    return { width, height, bytes: png.length };
  })(), timeoutMs, "Browser capture preflight");
}
