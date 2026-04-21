/**
 * Content Script Readiness Tracking
 *
 * Tracks which tabs have an initialized content script.
 * Eliminates all "sleep and hope the content script is ready" delays.
 *
 * Content scripts send CONTENT_SCRIPT_READY on initialization.
 * Background code calls `waitForContentScriptReady(tabId)` instead of sleeping.
 */

import { MessageSource, RuntimeMessage } from "../../types";
import { logger } from "../../utils";

/** Set of tab IDs whose content scripts have reported ready */
const readyTabs = new Set<number>();

/** Pending resolve callbacks for tabs we're waiting on */
const waiters = new Map<number, Array<() => void>>();

/**
 * Register the CONTENT_SCRIPT_READY listener.
 * Call once from background.ts during initialization.
 */
export function registerContentScriptReadyListener(): void {
  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
    if (message.type === "CONTENT_SCRIPT_READY" && sender.tab?.id) {
      const tabId = sender.tab.id;
      readyTabs.add(tabId);
      logger.debug("system", "Content script ready", { tabId });

      // Resolve any pending waiters
      const pending = waiters.get(tabId);
      if (pending) {
        for (const resolve of pending) resolve();
        waiters.delete(tabId);
      }
    }
    // Don't return true — this is fire-and-forget
  });

  // Clean up when tabs are removed
  chrome.tabs.onRemoved.addListener((tabId) => {
    readyTabs.delete(tabId);
    waiters.delete(tabId);
  });

  // Clear readiness on navigation (content script will re-announce)
  chrome.webNavigation?.onBeforeNavigate.addListener((details) => {
    if (details.frameId === 0) {
      readyTabs.delete(details.tabId);
    }
  });
}

/**
 * Wait for content script on a tab to be ready.
 * Returns immediately if already ready. Otherwise waits up to `timeoutMs`.
 *
 * Falls back to a ping attempt if the signal hasn't arrived within timeout/2,
 * in case the content script was already loaded before we started listening.
 */
export function waitForContentScriptReady(
  tabId: number,
  timeoutMs = 2000,
): Promise<void> {
  if (readyTabs.has(tabId)) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearTimeout(pingTimer);
      // Remove this waiter
      const pending = waiters.get(tabId);
      if (pending) {
        const idx = pending.indexOf(done);
        if (idx >= 0) pending.splice(idx, 1);
        if (pending.length === 0) waiters.delete(tabId);
      }
      resolve();
    };

    // Register waiter
    if (!waiters.has(tabId)) waiters.set(tabId, []);
    waiters.get(tabId)!.push(done);

    // Timeout: resolve anyway (best-effort)
    const timer = setTimeout(() => {
      logger.debug("system", "Content script ready timeout, proceeding", {
        tabId,
        timeoutMs,
      });
      done();
    }, timeoutMs);

    // Ping: at half-timeout, try messaging the content script
    // (handles case where content script loaded before we started listening)
    const pingTimer = setTimeout(
      async () => {
        if (resolved) return;
        try {
          await chrome.tabs.sendMessage(tabId, {
            type: "DOM_READY_PROBE",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            payload: { timeoutMs: 50 },
          });
          // If we got a response, the content script is alive
          readyTabs.add(tabId);
          done();
        } catch {
          // Content script not ready yet — keep waiting
        }
      },
      Math.min(timeoutMs / 2, 500),
    );
  });
}

/**
 * Probe whether the content script is responsive on a tab right now.
 * Marks the tab ready on success so later waits can short-circuit.
 */
export async function probeContentScript(
  tabId: number,
  timeoutMs = 100,
): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "DOM_READY_PROBE",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { timeoutMs },
    });
    readyTabs.add(tabId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a DOM readiness probe to a tab's content script.
 * Waits for DOM to settle (no mutations for 2 animation frames) before responding.
 *
 * Use this instead of `setTimeout(100)` before taking snapshots.
 */
export async function waitForDomReady(
  tabId: number,
  options: { timeoutMs?: number; waitForElements?: boolean } = {},
): Promise<{ waitedMs: number; elementCount: number }> {
  const { timeoutMs = 150, waitForElements = false } = options;
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "DOM_READY_PROBE",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { timeoutMs, waitForElements },
    });
    return response?.payload ?? { waitedMs: 0, elementCount: 0 };
  } catch {
    // Content script not available — return immediately
    return { waitedMs: 0, elementCount: 0 };
  }
}

/** Mark a tab as no longer ready (e.g. before navigation) */
export function clearTabReady(tabId: number): void {
  readyTabs.delete(tabId);
}

/** Check if tab is ready without waiting */
export function isTabReady(tabId: number): boolean {
  return readyTabs.has(tabId);
}

/**
 * Ensure the content script is injected and ready on a tab.
 * Re-injects via chrome.scripting.executeScript if not already ready,
 * then waits for the CONTENT_SCRIPT_READY signal.
 *
 * Handles Service Worker restarts where existing tabs lose their
 * content script connection.
 */
export async function ensureContentScript(
  tabId: number,
  timeoutMs = 5000,
): Promise<boolean> {
  if (readyTabs.has(tabId)) {
    const stillResponsive = await probeContentScript(
      tabId,
      Math.min(150, timeoutMs),
    );
    if (stillResponsive) return true;
    readyTabs.delete(tabId);
  }

  // Attempt to re-inject the content script
  try {
    const manifest = chrome.runtime.getManifest();
    const contentScriptFiles = manifest.content_scripts?.[0]?.js;
    if (contentScriptFiles?.length) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: contentScriptFiles,
      });
    }
  } catch {
    // May fail on chrome:// pages or if already injected — that's fine
  }

  // Wait for the content script to signal ready
  await waitForContentScriptReady(tabId, timeoutMs);
  if (readyTabs.has(tabId)) return true;

  return probeContentScript(tabId, Math.min(250, timeoutMs));
}
