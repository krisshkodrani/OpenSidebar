/**
 * Content script bridge - communication and error recovery for tool execution
 */

import { ToolName, MessageSource } from "../../types";
import { logger } from "../../utils";
import {
  ensureContentScript,
  probeContentScript,
  waitForContentScriptReady,
  waitForDomReady,
} from "../tab-ready";

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Detect Chrome bridge disconnect errors that indicate the content script is gone */
export function isBridgeDisconnect(errorMsg: string): boolean {
  return (
    errorMsg.includes("Receiving end does not exist") ||
    errorMsg.includes("Could not establish connection") ||
    errorMsg.includes("The message port closed") ||
    errorMsg.includes("Empty response from content script") ||
    errorMsg.includes("Cannot read properties of undefined")
  );
}

/** Re-inject the content script into a tab after a bridge disconnect */
export async function reinjectContentScript(
  tabId: number,
  options: { allowReloadFallback?: boolean } = {},
): Promise<boolean> {
  const { allowReloadFallback = false } = options;
  // Attempt 1: file-based injection from manifest
  try {
    const manifest = chrome.runtime.getManifest();
    const files = manifest.content_scripts?.[0]?.js;
    if (files?.length) {
      await chrome.scripting.executeScript({ target: { tabId }, files });
      const ready = await ensureContentScript(tabId, 3000);
      if (ready || (await probeContentScript(tabId, 150))) {
        return true;
      }
    }
  } catch (e: any) {
    logger.warn("tools", "File-based reinjection failed", {
      tabId,
      error: e.message,
    });
  }

  if (!allowReloadFallback) {
    logger.warn("tools", "Content script reinjection failed without reload fallback", {
      tabId,
    });
    return false;
  }

  // Attempt 2: reload the tab so Chrome re-injects content scripts via manifest
  // This handles CRXJS dev mode where the loader file can't be dynamically loaded
  try {
    await chrome.tabs.reload(tabId);
    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        chrome.webNavigation?.onCompleted.removeListener(onNav);
        chrome.webNavigation?.onErrorOccurred.removeListener(onNav);
        clearTimeout(timer);
        resolve();
      };
      const onNav = (details: { tabId: number; frameId: number }) => {
        if (details.tabId === tabId && details.frameId === 0) done();
      };
      chrome.webNavigation?.onCompleted.addListener(onNav);
      chrome.webNavigation?.onErrorOccurred.addListener(onNav);
      const timer = setTimeout(done, 10_000);
    });
    await waitForContentScriptReady(tabId, 5000);
    return await ensureContentScript(tabId, 1000);
  } catch (e: any) {
    logger.error("tools", "Content script reinjection failed (file + reload)", {
      tabId,
      error: e.message,
    });
    return false;
  }
}

/**
 * Re-establish a responsive content-script bridge after navigation/disconnect.
 * This adds a DOM-ready/probe phase after reinjection so callers do not race
 * an immediately reloaded or history-restored page.
 */
export async function recoverContentScriptBridge(
  tabId: number,
  options: {
    allowReloadFallback?: boolean;
    ensureTimeoutMs?: number;
    domReadyTimeoutMs?: number;
  } = {},
): Promise<boolean> {
  const {
    allowReloadFallback = false,
    ensureTimeoutMs = 3000,
    domReadyTimeoutMs = 400,
  } = options;

  const reinjected = await reinjectContentScript(tabId, { allowReloadFallback });
  if (!reinjected) {
    return false;
  }

  const ready = await ensureContentScript(tabId, ensureTimeoutMs);
  if (!ready) {
    return false;
  }

  await waitForDomReady(tabId, {
    timeoutMs: domReadyTimeoutMs,
    waitForElements: true,
  });

  if (await probeContentScript(tabId, 150)) {
    return true;
  }

  const rechecked = await ensureContentScript(tabId, Math.min(ensureTimeoutMs, 2000));
  if (!rechecked) {
    return false;
  }

  await waitForDomReady(tabId, {
    timeoutMs: domReadyTimeoutMs,
    waitForElements: true,
  });
  return probeContentScript(tabId, 150);
}

async function hardReloadActivePage(
  tabId: number,
  options: { ensureTimeoutMs?: number; domReadyTimeoutMs?: number } = {},
): Promise<boolean> {
  const { ensureTimeoutMs = 5000, domReadyTimeoutMs = 1000 } = options;
  try {
    const tab = await chrome.tabs.get(tabId);
    const targetUrl =
      typeof (tab as { pendingUrl?: string }).pendingUrl === "string" &&
      (tab as { pendingUrl?: string }).pendingUrl
        ? (tab as { pendingUrl?: string }).pendingUrl
        : tab.url;

    if (targetUrl && !targetUrl.startsWith("chrome://")) {
      await chrome.tabs.update(tabId, { url: targetUrl });
    } else {
      await chrome.tabs.reload(tabId);
    }

    await waitForNavigation(tabId, 10_000);
    await waitForContentScriptReady(tabId, ensureTimeoutMs);
    const ready = await ensureContentScript(tabId, ensureTimeoutMs);
    if (!ready) return false;

    await waitForDomReady(tabId, {
      timeoutMs: domReadyTimeoutMs,
      waitForElements: true,
    });
    return probeContentScript(tabId, 250);
  } catch (e: any) {
    logger.error("tools", "Hard page reload recovery failed", {
      tabId,
      error: e?.message ?? String(e),
    });
    return false;
  }
}

export async function executeContentTool(
  startName: ToolName,
  args: any,
  tabId: number,
): Promise<string> {
  if (tabId === chrome.tabs.TAB_ID_NONE) {
    return "Error: No active tab to execute tool on.";
  }

  logger.debug("tools", `bridge → ${startName}`, { tabId, args });

  const sendMessage = () =>
    chrome.tabs.sendMessage(tabId, {
      type: "TOOL_EXECUTE",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: {
        toolName: startName,
        args,
        toolCallId: "internal",
      },
    });

  try {
    const response = await Promise.race([
      sendMessage(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Tool execution timed out (15s)")), 15_000),
      ),
    ]);
    if (!response?.payload?.result && response?.payload?.result !== "") {
      throw new Error("Empty response from content script — bridge may be disconnected");
    }
    return response.payload.result;
  } catch (e: any) {
    if (!isBridgeDisconnect(e.message)) {
      logger.error("tools", "Bridge execution failed", { error: e.message });
      return `Error: Could not communicate with content script. Is the tab active? (${e.message})`;
    }

    // Bridge disconnected — check if tab is still alive
    logger.warn("tools", "Bridge disconnect detected, attempting reinject", {
      tabId,
      error: e.message,
    });
    try {
      await chrome.tabs.get(tabId);
    } catch {
      return "Error: Tab has been closed.";
    }

    // Tab alive — reinject content script and retry once
    // Allow reload fallback: file-based injection fails in CRXJS dev builds,
    // and a page reload (which re-injects via manifest) is better than a
    // permanent disconnect that leaves the agent unable to interact.
    const recovered = await recoverContentScriptBridge(tabId, {
      allowReloadFallback: true,
      ensureTimeoutMs: 5000,
      domReadyTimeoutMs: 1000,
    });
    if (!recovered) {
      const hardRecovered = await hardReloadActivePage(tabId, {
        ensureTimeoutMs: 5000,
        domReadyTimeoutMs: 1000,
      });
      if (!hardRecovered) {
        return `Error: Content script disconnected and reinjection failed. Try refreshing the page.`;
      }
    }

    try {
      const retryResponse = await sendMessage();
      logger.info("tools", "Bridge reconnect successful after reinject", {
        tabId,
        tool: startName,
      });
      return retryResponse.payload.result;
    } catch (retryErr: any) {
      if (isBridgeDisconnect(retryErr.message || "")) {
        const hardRecovered = await hardReloadActivePage(tabId, {
          ensureTimeoutMs: 5000,
          domReadyTimeoutMs: 1000,
        });
        if (hardRecovered) {
          try {
            const finalRetryResponse = await sendMessage();
            logger.info("tools", "Bridge reconnect successful after hard page reload", {
              tabId,
              tool: startName,
            });
            return finalRetryResponse.payload.result;
          } catch (finalErr: any) {
            logger.error("tools", "Bridge retry failed after hard page reload", {
              tabId,
              error: finalErr.message,
            });
          }
        }
      }
      logger.error("tools", "Bridge retry failed after reinject", {
        tabId,
        error: retryErr.message,
      });
      return `Error: Content script reconnect failed after reinjection. (${retryErr.message})`;
    }
  }
}

/** Wait for a tab navigation to complete (webNavigation.onCompleted or timeout). */
export function waitForNavigation(
  tabId: number,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false;

    const done = () => {
      if (resolved) return;
      resolved = true;
      chrome.webNavigation?.onCompleted.removeListener(onCompleted);
      chrome.webNavigation?.onErrorOccurred.removeListener(onError);
      clearTimeout(timer);
      resolve();
    };

    const onCompleted = (details: { tabId: number; frameId: number }) => {
      if (details.tabId === tabId && details.frameId === 0) done();
    };
    const onError = (details: { tabId: number; frameId: number }) => {
      if (details.tabId === tabId && details.frameId === 0) done();
    };

    chrome.webNavigation?.onCompleted.addListener(onCompleted);
    chrome.webNavigation?.onErrorOccurred.addListener(onError);
    const timer = setTimeout(done, timeoutMs);
  });
}
