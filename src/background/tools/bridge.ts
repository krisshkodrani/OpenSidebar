/**
 * Content script bridge - communication and error recovery for tool execution
 */

import { ToolName, MessageSource } from "../../types";
import { logger } from "../../utils";
import { waitForContentScriptReady } from "../tab-ready";

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Detect Chrome bridge disconnect errors that indicate the content script is gone */
export function isBridgeDisconnect(errorMsg: string): boolean {
  return (
    errorMsg.includes("Receiving end does not exist") ||
    errorMsg.includes("Could not establish connection") ||
    errorMsg.includes("The message port closed")
  );
}

/** Re-inject the content script into a tab after a bridge disconnect */
export async function reinjectContentScript(tabId: number): Promise<boolean> {
  try {
    const manifest = chrome.runtime.getManifest();
    const files = manifest.content_scripts?.[0]?.js;
    if (!files?.length) return false;
    await chrome.scripting.executeScript({ target: { tabId }, files });
    await waitForContentScriptReady(tabId, 3000);
    return true;
  } catch (e: any) {
    logger.error("tools", "Content script reinjection failed", {
      tabId,
      error: e.message,
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
    const response = await sendMessage();
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
    const reinjected = await reinjectContentScript(tabId);
    if (!reinjected) {
      return `Error: Content script disconnected and reinjection failed. Try refreshing the page.`;
    }

    try {
      const retryResponse = await sendMessage();
      logger.info("tools", "Bridge reconnect successful after reinject", {
        tabId,
        tool: startName,
      });
      return retryResponse.payload.result;
    } catch (retryErr: any) {
      logger.error("tools", "Bridge retry failed after reinject", {
        tabId,
        error: retryErr.message,
      });
      return `Error: Content script reconnect failed after reinjection. (${retryErr.message})`;
    }
  }
}

/** Wait for a tab navigation to complete (webNavigation.onCompleted or timeout). */
export function waitForNavigation(tabId: number, timeoutMs = 5000): Promise<void> {
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
