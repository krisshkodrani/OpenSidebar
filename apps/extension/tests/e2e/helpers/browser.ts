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
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import {
  readE2EConfig,
  type E2EPanelMode,
} from "./e2e-config";

export interface ExtensionContext {
  browser: Browser;
  extensionId: string;
  serviceWorker: WebWorker;
  serviceWorkerTarget: Target;
  serviceWorkerUrl: string;
  helperPage?: Page | null;
  detachedPanelPage?: Page | null;
  detachedPanelWindowId?: number | null;
  detachedPanelTargetTabId?: number | null;
  detachedPanelWorkspaceId?: string | null;
  inPagePanelTargetTabId?: number | null;
  inPagePanelWorkspaceId?: string | null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_PATH = path.resolve(__dirname, "../../../../../dist");
const DIST_MANIFEST_PATH = path.join(DIST_PATH, ".vite", "manifest.json");
const HELPER_PATH = "/e2e-helper.html";
const SIDE_PANEL_PATH = "/src/sidepanel/index.html";
const E2E_PANEL_TARGET_TAB_PARAM = "e2eTargetTabId";
const E2E_PANEL_WORKSPACE_PARAM = "e2eWorkspaceId";
const OVERLAY_ENTRY = "src/overlay/index.tsx";
const OVERLAY_LOADER_FILE = "e2e-overlay-loader.js";
const TRACE_VIEWER_URL = "http://127.0.0.1:7589/viewer";
const HEADLESS_VIEWPORT = { width: 1365, height: 900 } as const;
const DETACHED_PANEL_VIEWPORT = { width: 430, height: 900 } as const;
const DEFAULT_BROWSER_CLOSE_TIMEOUT_MS = 3_000;
const DEFAULT_EXTENSION_PAGE_LOAD_TIMEOUT_MS = 15_000;
const DEFAULT_CONTENT_SCRIPT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_PAGE_CLOSE_TIMEOUT_MS = 2_000;
const DEFAULT_PANEL_CLOSE_TIMEOUT_MS = 1_500;
const REUSED_OVERLAY_READY_TIMEOUT_MS = 1_500;
const SERVICE_WORKER_TARGET_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);
let overlayBundlePathPromise: Promise<string> | null = null;

class OperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationTimeoutError";
  }
}

function shouldRunHeadless(): boolean {
  return readE2EConfig().browser.headless;
}

function shouldUseSingleProcessChrome(): boolean {
  return readE2EConfig().browser.singleProcess;
}

export function getE2EPanelMode(): E2EPanelMode {
  return readE2EConfig().browser.panelMode;
}

export function shouldShowE2EPanel(): boolean {
  return getE2EPanelMode() !== "off";
}

async function readOverlayBundlePath(): Promise<string> {
  overlayBundlePathPromise ??= readFile(DIST_MANIFEST_PATH, "utf-8").then(
    (raw) => {
      const manifest = JSON.parse(raw) as Record<string, { file?: string }>;
      const entry = manifest[OVERLAY_ENTRY];
      if (!entry?.file) {
        throw new Error(
          `Built manifest does not contain ${OVERLAY_ENTRY}. Run npm run build before headed E2E overlay runs.`,
        );
      }
      return entry.file;
    },
  );
  return overlayBundlePathPromise;
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new OperationTimeoutError(`${label} timed out after ${timeoutMs}ms`),
      );
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
        const isAlive = await worker.evaluate(() =>
          Boolean(chrome?.runtime?.id),
        );
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
    waitForInitialPage: false,
    defaultViewport: headless ? HEADLESS_VIEWPORT : null,
    args: [
      `--disable-extensions-except=${DIST_PATH}`,
      `--load-extension=${DIST_PATH}`,
      "--no-first-run",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-gpu-sandbox",
      "--in-process-gpu",
      "--disable-search-engine-choice-screen",
      ...(shouldUseSingleProcessChrome() ? ["--single-process"] : []),
      headless
        ? `--window-size=${HEADLESS_VIEWPORT.width},${HEADLESS_VIEWPORT.height}`
        : "--start-maximized",
    ],
  });

  let swTarget: Target;
  try {
    // Wait for the service worker target to appear
    swTarget = await browser.waitForTarget(
      (t) =>
        t.type() === "service_worker" &&
        t.url().startsWith("chrome-extension://"),
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
    detachedPanelPage: null,
    detachedPanelWindowId: null,
    detachedPanelTargetTabId: null,
    detachedPanelWorkspaceId: null,
    inPagePanelTargetTabId: null,
    inPagePanelWorkspaceId: null,
  };
}

/**
 * Gracefully close the browser.
 */
export async function closeExtension(
  ctx: ExtensionContext,
  timeoutMs: number = DEFAULT_BROWSER_CLOSE_TIMEOUT_MS,
): Promise<void> {
  await closeE2EPanel(ctx).catch(() => {});
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
      await withTimeout(
        page.close(),
        DEFAULT_PAGE_CLOSE_TIMEOUT_MS,
        "Non-extension page close",
      ).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`[e2e] Non-extension page close skipped: ${detail}`);
      });
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
    throw new Error(
      `e2e-helper.html did not load correctly (url=${url}, title=${title})`,
    );
  }
  return helperPage;
}

function buildDetachedPanelUrl(
  extensionId: string,
  targetTabId: number,
  workspaceId: string,
): string {
  const url = new URL(`chrome-extension://${extensionId}${SIDE_PANEL_PATH}`);
  url.searchParams.set(E2E_PANEL_TARGET_TAB_PARAM, String(targetTabId));
  url.searchParams.set(E2E_PANEL_WORKSPACE_PARAM, workspaceId);
  return url.toString();
}

export async function closeDetachedSidePanelPage(
  ctx: ExtensionContext,
): Promise<void> {
  if (ctx.detachedPanelPage && !ctx.detachedPanelPage.isClosed()) {
    await withTimeout(
      ctx.detachedPanelPage.close(),
      DEFAULT_PANEL_CLOSE_TIMEOUT_MS,
      "Detached E2E panel close",
    ).catch(() => {});
  }
  ctx.detachedPanelPage = null;
  ctx.detachedPanelWindowId = null;
  ctx.detachedPanelTargetTabId = null;
  ctx.detachedPanelWorkspaceId = null;
}

export async function closeInPageSidePanelOverlay(
  ctx: ExtensionContext,
): Promise<void> {
  const tabId = ctx.inPagePanelTargetTabId;
  ctx.inPagePanelTargetTabId = null;
  ctx.inPagePanelWorkspaceId = null;
  if (!tabId || !ctx.browser.connected) return;
  const helperPage = await openHelperPage(ctx).catch(() => null);
  if (!helperPage) return;
  await withTimeout(
    helperPage.evaluate(async (targetTabId: number) => {
      await chrome.tabs
        .sendMessage(targetTabId, {
          type: "E2E_OVERLAY_UNMOUNT",
          requestId: crypto.randomUUID(),
          source: "sidepanel",
          payload: {},
        })
        .catch(() => {});
    }, tabId),
    DEFAULT_PANEL_CLOSE_TIMEOUT_MS,
    "In-page E2E overlay close",
  ).catch(() => {});
}

export async function closeE2EPanel(ctx: ExtensionContext): Promise<void> {
  await closeInPageSidePanelOverlay(ctx).catch(() => {});
  await closeDetachedSidePanelPage(ctx).catch(() => {});
}

async function waitForInPageSidePanelOverlayReady(
  ctx: ExtensionContext,
  targetTabId: number,
  timeoutMs: number = DEFAULT_EXTENSION_PAGE_LOAD_TIMEOUT_MS,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  const start = Date.now();
  let lastError: unknown = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const ready = await helperPage.evaluate(`
(async () => {
        const results = await chrome.scripting.executeScript({
          target: { tabId: ${JSON.stringify(targetTabId)} },
          world: "MAIN",
          func: () => {
            const host = document.getElementById("opensidebar-harness-host");
            const root = host?.shadowRoot?.getElementById("root");
            return Boolean(root?.hasAttribute("data-opensidebar-ready"));
          },
        });
        return Boolean(results[0]?.result);
})()
      `);
      if (ready) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const detail =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new OperationTimeoutError(
    `Timed out waiting for E2E overlay panel readiness.${detail}`,
  );
}

async function waitForE2EContentScriptReady(
  ctx: ExtensionContext,
  targetTabId: number,
  timeoutMs: number = DEFAULT_CONTENT_SCRIPT_READY_TIMEOUT_MS,
): Promise<void> {
  const helperPage = await openHelperPage(ctx);
  const result = await helperPage.evaluate(
    async (input: { targetTabId: number; timeoutMs: number }) => {
      const startedAt = Date.now();
      let lastDetail = "";
      const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      while (Date.now() - startedAt < input.timeoutMs) {
        try {
          const response = await chrome.tabs.sendMessage(input.targetTabId, {
            type: "E2E_CONTENT_READY_PING",
            requestId: crypto.randomUUID(),
            source: "sidepanel",
            payload: {},
          });
          if (response?.ok) return { ok: true };
          lastDetail =
            typeof response?.detail === "string"
              ? response.detail
              : `unexpected response ${JSON.stringify(response)}`;
        } catch (error) {
          lastDetail =
            error instanceof Error ? error.message : String(error ?? "");
        }
        await sleep(100);
      }

      return { ok: false, detail: lastDetail };
    },
    { targetTabId, timeoutMs },
  );

  if (result?.ok) return;
  const detail = result?.detail ? ` Last error: ${result.detail}` : "";
  throw new OperationTimeoutError(
    `Timed out waiting for E2E content script receiver in tab ${targetTabId}.${detail}`,
  );
}

export async function openInPageSidePanelOverlay(
  ctx: ExtensionContext,
  targetTabId: number,
  workspaceId: string,
): Promise<boolean> {
  if (getE2EPanelMode() !== "overlay") return false;
  if (
    ctx.inPagePanelTargetTabId === targetTabId &&
    ctx.inPagePanelWorkspaceId === workspaceId
  ) {
    try {
      await waitForInPageSidePanelOverlayReady(
        ctx,
        targetTabId,
        REUSED_OVERLAY_READY_TIMEOUT_MS,
      );
      return true;
    } catch {
      ctx.inPagePanelTargetTabId = null;
      ctx.inPagePanelWorkspaceId = null;
    }
  }

  await waitForE2EContentScriptReady(ctx, targetTabId);
  const overlayBundlePath = await readOverlayBundlePath();
  const helperPage = await openHelperPage(ctx);
  const response = await helperPage.evaluate(
    async (input: {
      targetTabId: number;
      workspaceId: string;
      overlayBundlePath: string;
      overlayLoaderFile: string;
    }) => {
      const tab = await chrome.tabs.get(input.targetTabId);
      const overlayScriptUrl = chrome.runtime.getURL(input.overlayBundlePath);
      const extensionBaseUrl = new URL("/", overlayScriptUrl).toString();
      const mountMessage = {
        type: "E2E_OVERLAY_MOUNT",
        requestId: crypto.randomUUID(),
        source: "sidepanel",
        payload: {
          scriptUrl: overlayScriptUrl,
          extensionBaseUrl,
          workspaceId: input.workspaceId,
          tab: {
            id: tab.id,
            url: tab.url,
            title: tab.title,
            active: true,
            windowId: tab.windowId,
          },
          window: { id: tab.windowId },
        },
      };
      const sendMountMessage = async () => {
        try {
          return await chrome.tabs.sendMessage(input.targetTabId, mountMessage);
        } catch (error) {
          return {
            ok: false,
            receiverMissing: true,
            detail:
              error instanceof Error ? error.message : String(error ?? ""),
          };
        }
      };

      const firstResponse = await sendMountMessage();
      if (firstResponse?.receiverMissing) return firstResponse;
      if (firstResponse?.ok && firstResponse.loaded === false) {
        const loaderResults = await chrome.scripting.executeScript({
          target: { tabId: input.targetTabId },
          files: [input.overlayLoaderFile],
          world: "MAIN",
        });
        if (!loaderResults.some((result) => result.result === true)) {
          throw new Error("E2E overlay loader did not report a mounted host.");
        }
        const secondResponse = await sendMountMessage();
        if (!secondResponse?.ok || secondResponse.loaded === false) {
          throw new Error(
            `Failed to confirm E2E overlay panel mount: ${secondResponse?.detail ?? "unknown error"}`,
          );
        }
        return secondResponse;
      }
      return firstResponse;
    },
    {
      targetTabId,
      workspaceId,
      overlayBundlePath,
      overlayLoaderFile: OVERLAY_LOADER_FILE,
    },
  );

  if (!response?.ok) {
    throw new Error(
      `Failed to mount E2E overlay panel: ${response?.detail ?? "unknown error"}`,
    );
  }
  ctx.inPagePanelTargetTabId = targetTabId;
  ctx.inPagePanelWorkspaceId = workspaceId;
  await waitForInPageSidePanelOverlayReady(ctx, targetTabId);
  return true;
}

export async function ensureE2EPanel(
  ctx: ExtensionContext,
  targetTabId: number,
  workspaceId: string,
): Promise<void> {
  const mode = getE2EPanelMode();
  if (mode === "off") return;
  if (mode === "detached") {
    await openDetachedSidePanelPage(ctx, targetTabId, workspaceId);
    return;
  }
  await openInPageSidePanelOverlay(ctx, targetTabId, workspaceId);
}

/**
 * Open the real sidepanel React app as a detached extension popup for E2E.
 *
 * Chrome's sidePanel API is hard to drive from an automated browser because it
 * is tied to user gestures. The detached page mounts the same UI and points its
 * runtime active-tab lookup at the test tab through query params.
 */
export async function openDetachedSidePanelPage(
  ctx: ExtensionContext,
  targetTabId: number,
  workspaceId: string,
): Promise<Page | null> {
  if (!shouldShowE2EPanel()) return null;

  const panelUrl = buildDetachedPanelUrl(
    ctx.extensionId,
    targetTabId,
    workspaceId,
  );

  if (
    ctx.detachedPanelPage &&
    !ctx.detachedPanelPage.isClosed() &&
    ctx.detachedPanelTargetTabId === targetTabId &&
    ctx.detachedPanelWorkspaceId === workspaceId
  ) {
    return ctx.detachedPanelPage;
  }

  await closeDetachedSidePanelPage(ctx);

  const helperPage = await openHelperPage(ctx);
  const created = await helperPage.evaluate(async (url: string) => {
    const width = 430;
    const height = Math.min(900, Math.max(640, window.screen.availHeight));
    const win = await chrome.windows.create({
      url,
      type: "popup",
      width,
      height,
      left: Math.max(0, window.screen.availWidth - width - 24),
      top: 0,
      focused: true,
    });
    return {
      windowId: win.id ?? null,
      tabId: win.tabs?.[0]?.id ?? null,
    };
  }, panelUrl);

  const target = await ctx.browser.waitForTarget(
    (candidate) => candidate.url() === panelUrl,
    { timeout: DEFAULT_EXTENSION_PAGE_LOAD_TIMEOUT_MS },
  );
  const panelPage = await target.page();
  if (!panelPage) {
    throw new Error("Detached E2E sidepanel target did not expose a page.");
  }

  await panelPage.setViewport(DETACHED_PANEL_VIEWPORT).catch(() => {});
  await panelPage.waitForFunction(
    () => document.documentElement.hasAttribute("data-opensidebar-ready"),
    { timeout: DEFAULT_EXTENSION_PAGE_LOAD_TIMEOUT_MS },
  );

  ctx.detachedPanelPage = panelPage;
  ctx.detachedPanelWindowId = created.windowId;
  ctx.detachedPanelTargetTabId = targetTabId;
  ctx.detachedPanelWorkspaceId = workspaceId;
  return panelPage;
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
