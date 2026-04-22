/**
 * Puppeteer helper — launches Chrome with the built extension loaded.
 *
 * Key exports:
 *   launchWithExtension() → ExtensionContext
 *   closeExtension(ctx)   → void
 */

import puppeteer, {
  type Browser,
  type Page,
  type Target,
  type WebWorker,
} from "puppeteer";
import path from "path";
import { fileURLToPath } from "url";

export interface ExtensionContext {
  browser: Browser;
  extensionId: string;
  serviceWorker: WebWorker;
  serviceWorkerTarget: Target;
  serviceWorkerUrl: string;
  helperPage?: Page | null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_PATH = path.resolve(__dirname, "../../../../../dist");
const HELPER_PATH = "/e2e-helper.html";
const TRACE_VIEWER_PATH = "/src/trace-viewer/index.html";

async function createBrowserPage(browser: Browser): Promise<Page> {
  try {
    return await browser.newPage();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return browser.newPage();
  }
}

async function waitForLiveServiceWorker(
  browser: Browser,
  extensionId: string,
  timeoutMs: number = 15_000,
): Promise<{ target: Target; worker: WebWorker }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const wakePage = await createBrowserPage(browser).catch(() => null);
    if (wakePage) {
      try {
        await wakePage.goto(
          `chrome-extension://${extensionId}/e2e-helper.html`,
          { waitUntil: "domcontentloaded", timeout: 2_000 },
        );
      } catch {
        // Extension may still be restarting.
      } finally {
        await wakePage.close().catch(() => {});
      }
    }

    const candidates = browser
      .targets()
      .filter(
        (target) =>
          target.type() === "service_worker" &&
          target.url().startsWith(`chrome-extension://${extensionId}/`),
      );

    for (const target of candidates) {
      const worker = await target.worker().catch(() => null);
      if (!worker) continue;
      try {
        const isAlive = await worker.evaluate(() => Boolean(chrome?.runtime?.id));
        if (isAlive) {
          return { target, worker };
        }
      } catch {
        // Worker is still restarting. Keep polling.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out after waiting ${timeoutMs}ms`);
}

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

  return {
    browser,
    extensionId,
    serviceWorker,
    serviceWorkerTarget: swTarget,
    serviceWorkerUrl: swUrl,
    helperPage: null,
  };
}

/**
 * Gracefully close the browser.
 */
export async function closeExtension(ctx: ExtensionContext): Promise<void> {
  await ctx.browser.close();
}

/**
 * Close non-extension pages to keep E2E cases isolated.
 */
export async function closeNonExtensionPages(
  ctx: ExtensionContext,
  keep: Page[] = [],
): Promise<void> {
  const keepTargets = new Set(keep);
  const pages = await ctx.browser.pages();
  await Promise.all(
    pages.map(async (page) => {
      if (keepTargets.has(page)) return;
      if (page.url().startsWith("chrome-extension://")) return;
      await page.close().catch(() => {});
    }),
  );
}

/**
 * Open the minimal extension helper page (no React bootstrapping).
 * Useful for stable chrome.runtime/chrome.storage interactions in E2E tests.
 */
export async function openHelperPage(ctx: ExtensionContext): Promise<Page> {
  const helperUrl = `chrome-extension://${ctx.extensionId}${HELPER_PATH}`;
  let helperPage =
    ctx.helperPage && !ctx.helperPage.isClosed() ? ctx.helperPage : null;
  if (!helperPage) {
    helperPage = await createBrowserPage(ctx.browser);
    ctx.helperPage = helperPage;
  }
  if (helperPage.url() !== helperUrl) {
    await helperPage.goto(helperUrl, { waitUntil: "domcontentloaded" });
  }
  const [url, title] = await Promise.all([
    helperPage.url(),
    helperPage.title(),
  ]);
  if (!url.endsWith(HELPER_PATH) || title !== "E2E Helper") {
    throw new Error(`e2e-helper.html did not load correctly (url=${url}, title=${title})`);
  }
  return helperPage;
}

/**
 * Open the extension trace viewer page.
 */
export async function openTraceViewerPage(
  ctx: ExtensionContext,
  hash: string = "#view=backend",
): Promise<Page> {
  const page = await createBrowserPage(ctx.browser);
  await page.goto(
    `chrome-extension://${ctx.extensionId}${TRACE_VIEWER_PATH}${hash}`,
    { waitUntil: "domcontentloaded" },
  );
  return page;
}

/**
 * Reload the extension in-place and update the context with the fresh service worker.
 * This simulates extension/service-worker restart while preserving local storage.
 */
export async function reloadExtension(ctx: ExtensionContext): Promise<void> {
  try {
    await ctx.serviceWorker.evaluate(() => {
      self.close();
    });
  } catch {
    // If the current worker is already gone, continue and let the wake-up path
    // start a fresh one below.
  }

  const { target, worker } = await waitForLiveServiceWorker(
    ctx.browser,
    ctx.extensionId,
  );
  ctx.serviceWorker = worker;
  ctx.serviceWorkerTarget = target;
  ctx.serviceWorkerUrl = target.url();
}
