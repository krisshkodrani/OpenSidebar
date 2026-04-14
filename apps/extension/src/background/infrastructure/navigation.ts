/**
 * Navigation Bridge — Persists agent state across page navigations
 *
 * When the agent triggers a navigation (via navigate() or clicking a link),
 * the content script is destroyed. This module saves state to chrome.storage.local,
 * listens for webNavigation.onCompleted, and resumes the agent loop.
 */

import {
  AgentStatus,
  AgentLoopState,
  NavigationState,
  MessageSource,
} from "../../types";
import { logger } from "../../utils";
import { ensureContentScript } from "./tab-ready";

// --- Constants ---

const STORAGE_KEY_PREFIX = "opensidebar:agentState";
const NAVIGATION_TIMEOUT_MS = 30_000; // 30 seconds

/** Get workspace-scoped storage key */
function storageKey(
  workspaceId?: string | null,
  workerId?: string | null,
): string {
  return workspaceId
    ? workerId
      ? `${STORAGE_KEY_PREFIX}:${workspaceId}:${workerId}`
      : `${STORAGE_KEY_PREFIX}:${workspaceId}`
    : STORAGE_KEY_PREFIX;
}

// --- State Management ---

/**
 * Saves agent state before navigation.
 * Called when navigate() is invoked or click triggers navigation.
 */
export async function saveNavigationState(
  state: AgentLoopState,
  fromUrl: string,
  expectedUrl: string | null,
): Promise<void> {
  const navState: NavigationState = {
    agentState: {
      ...state,
      status: AgentStatus.WAITING_FOR_PAGE_LOAD,
      // Ensure messages are serializable (strip any non-JSON-safe content)
      messages: state.messages.map((m) => ({ ...m })),
    },
    fromUrl,
    toUrl: expectedUrl,
    navigationStartTs: Date.now(),
    timeoutMs: NAVIGATION_TIMEOUT_MS,
  };

  const key = storageKey(state.workspaceId, state.workerId);
  await chrome.storage.local.set({ [key]: navState });
  logger.info("navigation", "Saved navigation state", {
    fromUrl,
    toUrl: expectedUrl,
    storageKey: key,
  });
}

/**
 * Retrieves pending navigation state, or null if none exists.
 * Checks workspace-scoped key first (by tab lookup), then falls back to the default key.
 */
export async function loadNavigationState(): Promise<NavigationState | null> {
  // Try all stored keys matching the prefix pattern
  const stored = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(stored)) {
    if (
      key.startsWith(STORAGE_KEY_PREFIX) &&
      value &&
      (value as NavigationState).agentState
    ) {
      return value as NavigationState;
    }
  }
  return null;
}

/**
 * Retrieves pending navigation state for a specific tab.
 */
export async function loadNavigationStateForTab(
  tabId: number,
): Promise<NavigationState | null> {
  const stored = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith(STORAGE_KEY_PREFIX) && value) {
      const navState = value as NavigationState;
      if (navState.agentState?.activeTabId === tabId) {
        return navState;
      }
    }
  }
  return null;
}

/**
 * Clears stored navigation state for a given workspace (or default).
 */
export async function clearNavigationState(
  workspaceId?: string | null,
  workerId?: string | null,
): Promise<void> {
  const key = storageKey(workspaceId, workerId);
  await chrome.storage.local.remove(key);
  logger.debug("navigation", "Cleared navigation state", { storageKey: key });
}

// --- Event Handlers ---

/** Callback type for resuming the agent loop */
export type ResumeCallback = (state: AgentLoopState, newUrl: string) => void;

/** Callback type for broadcasting status updates */
export type StatusCallback = (
  status: AgentStatus,
  detail: string,
  workspaceId?: string | null,
) => void;

let resumeCallback: ResumeCallback | null = null;
let statusCallback: StatusCallback | null = null;

/**
 * Sets the callbacks used when navigation completes.
 * Must be called during initialization.
 */
export function setNavigationCallbacks(
  onResume: ResumeCallback,
  onStatus: StatusCallback,
): void {
  resumeCallback = onResume;
  statusCallback = onStatus;
}

/**
 * Handler for webNavigation.onCompleted.
 * Resumes the agent loop if we have pending navigation state.
 */
async function handleNavigationComplete(
  details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
): Promise<void> {
  // Only care about main frame (not iframes)
  if (details.frameId !== 0) return;

  const navState = await loadNavigationStateForTab(details.tabId);
  if (!navState) return;

  // Check if agent was waiting for navigation
  if (navState.agentState.status !== AgentStatus.WAITING_FOR_PAGE_LOAD) return;

  // Check for timeout
  const elapsed = Date.now() - navState.navigationStartTs;
  if (elapsed > navState.timeoutMs) {
    await clearNavigationState(
      navState.agentState.workspaceId,
      navState.agentState.workerId,
    );
    statusCallback?.(
      AgentStatus.ERROR,
      "Navigation timed out",
      navState.agentState.workspaceId,
    );
    logger.warn("navigation", "Navigation timed out", {
      elapsed,
      timeout: navState.timeoutMs,
    });
    return;
  }

  // Clear stored state before resuming
  await clearNavigationState(
    navState.agentState.workspaceId,
    navState.agentState.workerId,
  );

  logger.info("navigation", "Navigation completed, resuming agent", {
    url: details.url,
  });

  // Notify side panel
  chrome.runtime
    .sendMessage({
      type: "NAVIGATION_RESUME",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: {
        success: true,
        url: details.url,
      },
    })
    .catch(() => {}); // Ignore if sidepanel closed

  // Wait for content script to be truly responsive before resuming the loop.
  await ensureContentScript(details.tabId, 3000);

  // Add navigation result to messages
  const state = { ...navState.agentState };
  if (state.pendingToolCall) {
    state.messages.push({
      role: "tool",
      tool_call_id: state.pendingToolCall.toolCallId,
      content: `Navigated to ${details.url}. Page has loaded. Fresh page snapshot is available.`,
    });
    state.pendingToolCall = null;
  }
  state.status = AgentStatus.THINKING;

  // Resume the agent loop
  resumeCallback?.(state, details.url);
}

/**
 * Handler for webNavigation.onErrorOccurred.
 * Resumes the agent loop with an error message.
 */
async function handleNavigationError(
  details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails,
): Promise<void> {
  // Only care about main frame
  if (details.frameId !== 0) return;

  const navState = await loadNavigationStateForTab(details.tabId);
  if (!navState) return;

  await clearNavigationState(
    navState.agentState.workspaceId,
    navState.agentState.workerId,
  );

  logger.warn("navigation", "Navigation failed", {
    url: details.url,
    error: details.error,
  });

  // Notify side panel
  chrome.runtime
    .sendMessage({
      type: "NAVIGATION_RESUME",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: {
        success: false,
        url: details.url,
        error: details.error,
      },
    })
    .catch(() => {});

  // Add error to messages and resume
  const state = { ...navState.agentState };
  if (state.pendingToolCall) {
    state.messages.push({
      role: "tool",
      tool_call_id: state.pendingToolCall.toolCallId,
      content: `Navigation failed: ${details.error}. The page could not be loaded.`,
    });
    state.pendingToolCall = null;
  }
  state.status = AgentStatus.THINKING;

  resumeCallback?.(state, details.url);
}

/**
 * Handler for tabs.onRemoved.
 * Cleans up navigation state if the tracked tab is closed.
 */
async function handleTabRemoved(tabId: number): Promise<void> {
  const navState = await loadNavigationStateForTab(tabId);
  if (!navState) return;

  await clearNavigationState(navState.agentState.workspaceId);
  statusCallback?.(
    AgentStatus.ERROR,
    "Tab was closed during navigation",
    navState.agentState.workspaceId,
  );
  logger.warn("navigation", "Tab closed during navigation", { tabId });
}

/**
 * Cleans up stale navigation state on browser startup.
 * Called from runtime.onStartup.
 */
export async function checkStaleNavigationState(): Promise<void> {
  // Check all stored navigation states and clean up stale ones
  const stored = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith(STORAGE_KEY_PREFIX) && value) {
      const navState = value as NavigationState;
      if (navState.navigationStartTs) {
        const elapsed = Date.now() - navState.navigationStartTs;
        if (elapsed > (navState.timeoutMs || NAVIGATION_TIMEOUT_MS)) {
          await chrome.storage.local.remove(key);
          logger.info(
            "navigation",
            "Cleaned up stale navigation state on startup",
            { key },
          );
        }
      }
    }
  }
}

// --- Registration ---

/**
 * Registers all navigation-related event listeners.
 * Must be called at the top level of the service worker.
 */
export function registerNavigationListeners(): void {
  chrome.webNavigation.onCompleted.addListener(handleNavigationComplete);
  chrome.webNavigation.onErrorOccurred.addListener(handleNavigationError);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
  chrome.runtime.onStartup.addListener(checkStaleNavigationState);

  logger.info("navigation", "Navigation listeners registered");
}
