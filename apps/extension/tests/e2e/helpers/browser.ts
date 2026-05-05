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
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

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
const TRACE_VIEWER_URL = "http://127.0.0.1:7589/viewer";
const HEADLESS_VIEWPORT = { width: 1365, height: 900 } as const;
const DEFAULT_BROWSER_CLOSE_TIMEOUT_MS = 3_000;
const DEFAULT_EXTENSION_PAGE_LOAD_TIMEOUT_MS = 15_000;
const SERVICE_WORKER_TARGET_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

class OperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationTimeoutError";
  }
}

function shouldRunHeadless(): boolean {
  const value = process.env.E2E_HEADLESS?.toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OperationTimeoutError(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function forceKillBrowser(browser: Browser): Promise<boolean> {
  let browserProcess: ReturnType<Browser["process"]>;
  try {
    browserProcess = browser.process();
  } catch {
    return false;
  }
  if (!browserProcess || browserProcess.killed) return false;
  if (process.platform === "win32" && browserProcess.pid) {
    try {
      await execFileAsync(
        "taskkill",
        ["/PID", String(browserProcess.pid), "/T", "/F"],
        { windowsHide: true },
      );
      return true;
    } catch {
      // Fall through to ChildProcess.kill for non-standard Windows shells.
    }
  }
  try {
    if (browserProcess.kill("SIGKILL")) return true;
  } catch {
    // Windows may reject SIGKILL; fall back to the platform default signal.
  }
  try {
    return browserProcess.kill();
  } catch {
    return false;
  }
}

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
  const headless = shouldRunHeadless();
  const browser = await puppeteer.launch({
    headless,
    enableExtensions: true,
    defaultViewport: headless ? HEADLESS_VIEWPORT : null,
    args: [
      `--disable-extensions-except=${DIST_PATH}`,
      `--load-extension=${DIST_PATH}`,
      "--no-first-run",
      "--disable-search-engine-choice-screen",
      headless
        ? `--window-size=${HEADLESS_VIEWPORT.width},${HEADLESS_VIEWPORT.height}`
        : "--start-maximized",
    ],
    pipe: true,
  });

  let swTarget: Target;
  try {
    // Wait for the service worker target to appear
    swTarget = await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"),
      { timeout: SERVICE_WORKER_TARGET_TIMEOUT_MS },
    );
  } catch (error) {
    await closeExtension({ browser } as ExtensionContext);
    throw error;
  }

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
export async function closeExtension(
  ctx: ExtensionContext,
  timeoutMs: number = DEFAULT_BROWSER_CLOSE_TIMEOUT_MS,
): Promise<void> {
  try {
    await withTimeout(ctx.browser.close(), timeoutMs, "Browser close");
  } catch (error) {
    const killed = await forceKillBrowser(ctx.browser);
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[e2e] Browser close did not finish cleanly (${reason}); ` +
        `${killed ? "killed browser process" : "no browser process to kill"}.`,
    );
  }
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
    await helperPage.goto(helperUrl, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_EXTENSION_PAGE_LOAD_TIMEOUT_MS,
    });
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
  await page.goto(`${TRACE_VIEWER_URL}${hash}`, {
    waitUntil: "domcontentloaded",
    timeout: DEFAULT_EXTENSION_PAGE_LOAD_TIMEOUT_MS,
  });
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
