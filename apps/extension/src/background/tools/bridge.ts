/**
 * Content script bridge - communication and error recovery for tool execution.
 */

import {
  ToolName,
  MessageSource,
  type PageDocumentState,
  type ToolExecutionResult,
} from "../../types";
import { logger } from "../../utils";
import {
  probeContentScript,
  waitForContentScriptReady,
  waitForDomReady,
} from "../tab-ready";

export type BridgeRecoveryPhase =
  | "transient_probe"
  | "reinject"
  | "hard_reload";

export type BridgeRecoveryContext = "tool_execution" | "snapshot";

export type BridgeRecoveryTraceHook = (event: {
  stage: "attempt" | "result";
  phase: BridgeRecoveryPhase;
  context: BridgeRecoveryContext;
  toolName?: ToolName;
  success?: boolean;
  error?: string;
}) => void;

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Detect Chrome bridge disconnect errors that indicate the content script is gone. */
export function isBridgeDisconnect(errorMsg: string): boolean {
  return (
    errorMsg.includes("Receiving end does not exist") ||
    errorMsg.includes("Could not establish connection") ||
    errorMsg.includes("The message port closed") ||
    errorMsg.includes("Empty response from content script") ||
    errorMsg.includes("Cannot read properties of undefined")
  );
}

async function confirmResponsiveBridge(
  tabId: number,
  options: {
    readyTimeoutMs?: number;
    domReadyTimeoutMs?: number;
    probeAttempts?: number;
  } = {},
): Promise<boolean> {
  const {
    readyTimeoutMs = 3000,
    domReadyTimeoutMs = 400,
    probeAttempts = 3,
  } = options;

  await waitForContentScriptReady(tabId, readyTimeoutMs);

  for (let attempt = 0; attempt < Math.max(1, probeAttempts); attempt++) {
    await waitForDomReady(tabId, {
      timeoutMs: domReadyTimeoutMs + attempt * 250,
      waitForElements: true,
    });

    if (await probeContentScript(tabId, 150 + attempt * 100)) {
      return true;
    }

    if (attempt < probeAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  return false;
}

/** Re-inject the content script into a tab after a bridge disconnect. */
export async function reinjectContentScript(
  tabId: number,
  options: {
    allowReloadFallback?: boolean;
    traceHook?: BridgeRecoveryTraceHook;
    context?: BridgeRecoveryContext;
    toolName?: ToolName;
  } = {},
): Promise<boolean> {
  const {
    allowReloadFallback = false,
    traceHook,
    context = "tool_execution",
    toolName,
  } = options;

  traceHook?.({
    stage: "attempt",
    phase: "reinject",
    context,
    toolName,
  });

  try {
    const manifest = chrome.runtime.getManifest();
    const files = manifest.content_scripts?.[0]?.js;
    if (files?.length) {
      await chrome.scripting.executeScript({ target: { tabId }, files });
      if (
        await confirmResponsiveBridge(tabId, {
          readyTimeoutMs: 3000,
          domReadyTimeoutMs: 400,
          probeAttempts: 3,
        })
      ) {
        traceHook?.({
          stage: "result",
          phase: "reinject",
          context,
          toolName,
          success: true,
        });
        return true;
      }
    }
  } catch (e: any) {
    logger.warn("tools", "File-based reinjection failed", {
      tabId,
      error: e.message,
    });
  }

  // If file-based injection failed because the script was already present or just
  // needed a moment to settle, accept the existing bridge before escalating.
  if (
    await confirmResponsiveBridge(tabId, {
      readyTimeoutMs: 500,
      domReadyTimeoutMs: 250,
      probeAttempts: 2,
    })
  ) {
    traceHook?.({
      stage: "result",
      phase: "reinject",
      context,
      toolName,
      success: true,
    });
    return true;
  }

  if (!allowReloadFallback) {
    logger.warn(
      "tools",
      "Content script reinjection failed without reload fallback",
      {
        tabId,
      },
    );
    traceHook?.({
      stage: "result",
      phase: "reinject",
      context,
      toolName,
      success: false,
    });
    return false;
  }

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

    const recovered = await confirmResponsiveBridge(tabId, {
      readyTimeoutMs: 5000,
      domReadyTimeoutMs: 1000,
      probeAttempts: 4,
    });
    traceHook?.({
      stage: "result",
      phase: "reinject",
      context,
      toolName,
      success: recovered,
    });
    return recovered;
  } catch (e: any) {
    logger.error("tools", "Content script reinjection failed (file + reload)", {
      tabId,
      error: e.message,
    });
    traceHook?.({
      stage: "result",
      phase: "reinject",
      context,
      toolName,
      success: false,
      error: e.message,
    });
    return false;
  }
}

/**
 * Re-establish a responsive content-script bridge after navigation/disconnect.
 * Adds a DOM-ready/probe phase after reinjection so callers do not race a
 * reloaded or history-restored page.
 */
export async function recoverContentScriptBridge(
  tabId: number,
  options: {
    allowReloadFallback?: boolean;
    ensureTimeoutMs?: number;
    domReadyTimeoutMs?: number;
    traceHook?: BridgeRecoveryTraceHook;
    context?: BridgeRecoveryContext;
    toolName?: ToolName;
  } = {},
): Promise<boolean> {
  const {
    allowReloadFallback = false,
    ensureTimeoutMs = 3000,
    domReadyTimeoutMs = 400,
    traceHook,
    context = "tool_execution",
    toolName,
  } = options;

  const reinjected = await reinjectContentScript(tabId, {
    allowReloadFallback,
    traceHook,
    context,
    toolName,
  });
  if (!reinjected) {
    return false;
  }

  return confirmResponsiveBridge(tabId, {
    readyTimeoutMs: ensureTimeoutMs,
    domReadyTimeoutMs,
    probeAttempts: 4,
  });
}

async function hardReloadActivePage(
  tabId: number,
  options: {
    ensureTimeoutMs?: number;
    domReadyTimeoutMs?: number;
    traceHook?: BridgeRecoveryTraceHook;
    context?: BridgeRecoveryContext;
    toolName?: ToolName;
  } = {},
): Promise<boolean> {
  const {
    ensureTimeoutMs = 5000,
    domReadyTimeoutMs = 1000,
    traceHook,
    context = "tool_execution",
    toolName,
  } = options;
  traceHook?.({
    stage: "attempt",
    phase: "hard_reload",
    context,
    toolName,
  });
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
    const recovered = await confirmResponsiveBridge(tabId, {
      readyTimeoutMs: ensureTimeoutMs,
      domReadyTimeoutMs,
      probeAttempts: 4,
    });
    traceHook?.({
      stage: "result",
      phase: "hard_reload",
      context,
      toolName,
      success: recovered,
    });
    return recovered;
  } catch (e: any) {
    logger.error("tools", "Hard page reload recovery failed", {
      tabId,
      error: e?.message ?? String(e),
    });
    traceHook?.({
      stage: "result",
      phase: "hard_reload",
      context,
      toolName,
      success: false,
      error: e?.message ?? String(e),
    });
    return false;
  }
}

type ContentToolObservationBasis = PageDocumentState & {
  observationRevision: number;
  requireGeometryMatch?: boolean;
};

export function executeContentTool(
  startName: ToolName,
  args: any,
  tabId: number,
  traceHook?: BridgeRecoveryTraceHook,
  toolCallId?: string,
): Promise<string>;
export function executeContentTool(
  startName: ToolName,
  args: any,
  tabId: number,
  traceHook: BridgeRecoveryTraceHook | undefined,
  toolCallId: string | undefined,
  observationBasis: ContentToolObservationBasis | undefined,
): Promise<string | ToolExecutionResult>;
export async function executeContentTool(
  startName: ToolName,
  args: any,
  tabId: number,
  traceHook?: BridgeRecoveryTraceHook,
  toolCallId?: string,
  observationBasis?: ContentToolObservationBasis,
): Promise<string | ToolExecutionResult> {
  if (tabId === chrome.tabs.TAB_ID_NONE) {
    return "Error: No active tab to execute tool on.";
  }

  logger.debug("tools", `bridge -> ${startName}`, { tabId, args });

  const presentationId = toolCallId ?? `bridge:${crypto.randomUUID()}`;
  const sendMessage = () =>
    chrome.tabs.sendMessage(tabId, {
      type: "TOOL_EXECUTE",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: {
        toolName: startName,
        args,
        toolCallId: presentationId,
        ...(observationBasis ? { observationBasis } : {}),
      },
    });

  const readResponse = (response: {
    payload?: {
      result?: string;
      errorCode?: "stale_observation";
    };
  }): string | ToolExecutionResult => {
    const result = response.payload?.result;
    if (typeof result !== "string") {
      throw new Error(
        "Empty response from content script - bridge may be disconnected",
      );
    }
    return response.payload?.errorCode
      ? { result, errorCode: response.payload.errorCode }
      : result;
  };

  try {
    const response = await Promise.race([
      sendMessage(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Tool execution timed out (15s)")),
          15_000,
        ),
      ),
    ]);
    return readResponse(response);
  } catch (e: any) {
    if (!isBridgeDisconnect(e.message)) {
      logger.error("tools", "Bridge execution failed", { error: e.message });
      return `Error: Could not communicate with content script. Is the tab active? (${e.message})`;
    }

    logger.warn("tools", "Bridge disconnect detected, attempting reinject", {
      tabId,
      error: e.message,
    });
    try {
      await chrome.tabs.get(tabId);
    } catch {
      return "Error: Tab has been closed.";
    }

    // A small subset of disconnects are transient. If the bridge is already
    // responsive again, retry immediately and avoid a disruptive reload path.
    traceHook?.({
      stage: "attempt",
      phase: "transient_probe",
      context: "tool_execution",
      toolName: startName,
      error: e.message,
    });
    if (await probeContentScript(tabId, 150)) {
      try {
        const transientRetryResponse = await sendMessage();
        logger.info(
          "tools",
          "Bridge reconnect successful after transient probe",
          {
            tabId,
            tool: startName,
          },
        );
        traceHook?.({
          stage: "result",
          phase: "transient_probe",
          context: "tool_execution",
          toolName: startName,
          success: true,
        });
        return readResponse(transientRetryResponse);
      } catch (retryErr: any) {
        if (!isBridgeDisconnect(retryErr.message || "")) {
          logger.error("tools", "Bridge retry failed after transient probe", {
            tabId,
            error: retryErr.message,
          });
          traceHook?.({
            stage: "result",
            phase: "transient_probe",
            context: "tool_execution",
            toolName: startName,
            success: false,
            error: retryErr.message,
          });
          return `Error: Could not communicate with content script. Is the tab active? (${retryErr.message})`;
        }
      }
    }
    traceHook?.({
      stage: "result",
      phase: "transient_probe",
      context: "tool_execution",
      toolName: startName,
      success: false,
    });

    const recovered = await recoverContentScriptBridge(tabId, {
      allowReloadFallback: true,
      ensureTimeoutMs: 5000,
      domReadyTimeoutMs: 1000,
      traceHook,
      context: "tool_execution",
      toolName: startName,
    });
    if (!recovered) {
      const hardRecovered = await hardReloadActivePage(tabId, {
        ensureTimeoutMs: 5000,
        domReadyTimeoutMs: 1000,
        traceHook,
        context: "tool_execution",
        toolName: startName,
      });
      if (!hardRecovered) {
        return "Error: Content script disconnected and reinjection failed. Try refreshing the page.";
      }
    }

    try {
      const retryResponse = await sendMessage();
      logger.info("tools", "Bridge reconnect successful after reinject", {
        tabId,
        tool: startName,
      });
      return readResponse(retryResponse);
    } catch (retryErr: any) {
      if (isBridgeDisconnect(retryErr.message || "")) {
        const hardRecovered = await hardReloadActivePage(tabId, {
          ensureTimeoutMs: 5000,
          domReadyTimeoutMs: 1000,
          traceHook,
          context: "tool_execution",
          toolName: startName,
        });
        if (hardRecovered) {
          try {
            const finalRetryResponse = await sendMessage();
            logger.info(
              "tools",
              "Bridge reconnect successful after hard page reload",
              {
                tabId,
                tool: startName,
              },
            );
            return readResponse(finalRetryResponse);
          } catch (finalErr: any) {
            logger.error(
              "tools",
              "Bridge retry failed after hard page reload",
              {
                tabId,
                error: finalErr.message,
              },
            );
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
