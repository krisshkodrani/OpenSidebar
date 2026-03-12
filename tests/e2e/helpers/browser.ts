/**
 * Puppeteer helper — launches Chrome with the built extension loaded.
 *
 * Key exports:
 *   launchWithExtension() → ExtensionContext
 *   closeExtension(ctx)   → void
 */

import puppeteer, { type Browser, type Page, type WebWorker } from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";

export interface ExtensionContext {
  browser: Browser;
  extensionId: string;
  serviceWorker: WebWorker;
  serviceWorkerUrl: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_PATH = path.resolve(__dirname, "../../../dist");

/**
 * Launch Chrome with the extension from dist/ loaded.
 * Discovers the extension ID dynamically from the service worker URL.
 */
export async function launchWithExtension(): Promise<ExtensionContext> {
  const browser = await puppeteer.launch({
    headless: false, // Extensions require headed mode
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${DIST_PATH}`,
      `--load-extension=${DIST_PATH}`,
      "--no-first-run",
      "--disable-search-engine-choice-screen",
      "--start-maximized",
    ],
    pipe: true,
  });

  // Wait for the service worker target to appear
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"),
    { timeout: 15_000 },
  );

  const serviceWorker = (await swTarget.worker())!;
  if (!serviceWorker) {
    throw new Error("Failed to get service worker handle");
  }

  // Extract extension ID from SW URL: chrome-extension://<id>/...
  const swUrl = swTarget.url();
  const match = swUrl.match(/chrome-extension:\/\/([a-z]{32})\//);
  if (!match) {
    throw new Error(`Could not extract extension ID from SW URL: ${swUrl}`);
  }
  const extensionId = match[1];

  return { browser, extensionId, serviceWorker, serviceWorkerUrl: swUrl };
}

/**
 * Gracefully close the browser.
 */
export async function closeExtension(ctx: ExtensionContext): Promise<void> {
  await ctx.browser.close();
}

/**
 * Open the minimal extension helper page (no React bootstrapping).
 * Useful for stable chrome.runtime/chrome.storage interactions in E2E tests.
 */
export async function openHelperPage(ctx: ExtensionContext): Promise<Page> {
  const helperPage = await ctx.browser.newPage();
  await helperPage.goto(
    `chrome-extension://${ctx.extensionId}/e2e-helper.html`,
    { waitUntil: "domcontentloaded" },
  );
  const [url, title] = await Promise.all([
    helperPage.url(),
    helperPage.title(),
  ]);
  if (!url.endsWith("/e2e-helper.html") || title !== "E2E Helper") {
    throw new Error(`e2e-helper.html did not load correctly (url=${url}, title=${title})`);
  }
  return helperPage;
}
