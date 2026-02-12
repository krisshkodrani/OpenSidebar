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
} from "../types";
import { logger } from "../utils";

// --- Constants ---

const STORAGE_KEY = "qsidebar:agentState";
const NAVIGATION_TIMEOUT_MS = 30_000; // 30 seconds

// --- State Management ---

/**
 * Saves agent state before navigation.
 * Called when navigate() is invoked or click triggers navigation.
 */
export async function saveNavigationState(
    state: AgentLoopState,
    fromUrl: string,
    expectedUrl: string | null
): Promise<void> {
    const navState: NavigationState = {
        agentState: {
            ...state,
            status: AgentStatus.WAITING_FOR_PAGE_LOAD,
            // Ensure messages are serializable (strip any non-JSON-safe content)
            messages: state.messages.map(m => ({ ...m })),
        },
        fromUrl,
        toUrl: expectedUrl,
        navigationStartTs: Date.now(),
        timeoutMs: NAVIGATION_TIMEOUT_MS,
    };

    await chrome.storage.local.set({ [STORAGE_KEY]: navState });
    logger.info("navigation", "Saved navigation state", { fromUrl, toUrl: expectedUrl });
}

/**
 * Retrieves pending navigation state, or null if none exists.
 */
export async function loadNavigationState(): Promise<NavigationState | null> {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return stored[STORAGE_KEY] ?? null;
}

/**
 * Clears stored navigation state.
 */
export async function clearNavigationState(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
    logger.debug("navigation", "Cleared navigation state");
}

// --- Event Handlers ---

/** Callback type for resuming the agent loop */
export type ResumeCallback = (state: AgentLoopState, newUrl: string) => void;

/** Callback type for broadcasting status updates */
export type StatusCallback = (status: AgentStatus, detail: string) => void;

let resumeCallback: ResumeCallback | null = null;
let statusCallback: StatusCallback | null = null;

/**
 * Sets the callbacks used when navigation completes.
 * Must be called during initialization.
 */
export function setNavigationCallbacks(
    onResume: ResumeCallback,
    onStatus: StatusCallback
): void {
    resumeCallback = onResume;
    statusCallback = onStatus;
}

/**
 * Handler for webNavigation.onCompleted.
 * Resumes the agent loop if we have pending navigation state.
 */
async function handleNavigationComplete(
    details: chrome.webNavigation.WebNavigationFramedCallbackDetails
): Promise<void> {
    // Only care about main frame (not iframes)
    if (details.frameId !== 0) return;

    const navState = await loadNavigationState();
    if (!navState) return;

    // Check if agent was waiting for navigation
    if (navState.agentState.status !== AgentStatus.WAITING_FOR_PAGE_LOAD) return;

    // Check if this is the tab we're tracking
    if (details.tabId !== navState.agentState.activeTabId) return;

    // Check for timeout
    const elapsed = Date.now() - navState.navigationStartTs;
    if (elapsed > navState.timeoutMs) {
        await clearNavigationState();
        statusCallback?.(AgentStatus.ERROR, "Navigation timed out");
        logger.warn("navigation", "Navigation timed out", { elapsed, timeout: navState.timeoutMs });
        return;
    }

    // Clear stored state before resuming
    await clearNavigationState();

    logger.info("navigation", "Navigation completed, resuming agent", { url: details.url });

    // Notify side panel
    chrome.runtime.sendMessage({
        type: "NAVIGATION_RESUME",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: {
            success: true,
            url: details.url,
        },
    }).catch(() => { }); // Ignore if sidepanel closed

    // Wait a moment for content script to initialize
    await new Promise(resolve => setTimeout(resolve, 500));

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
    details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails
): Promise<void> {
    // Only care about main frame
    if (details.frameId !== 0) return;

    const navState = await loadNavigationState();
    if (!navState) return;

    // Check if this is the tab we're tracking
    if (details.tabId !== navState.agentState.activeTabId) return;

    await clearNavigationState();

    logger.warn("navigation", "Navigation failed", { url: details.url, error: details.error });

    // Notify side panel
    chrome.runtime.sendMessage({
        type: "NAVIGATION_RESUME",
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        payload: {
            success: false,
            url: details.url,
            error: details.error,
        },
    }).catch(() => { });

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
    const navState = await loadNavigationState();
    if (!navState) return;

    if (navState.agentState.activeTabId === tabId) {
        await clearNavigationState();
        statusCallback?.(AgentStatus.ERROR, "Tab was closed during navigation");
        logger.warn("navigation", "Tab closed during navigation", { tabId });
    }
}

/**
 * Cleans up stale navigation state on browser startup.
 * Called from runtime.onStartup.
 */
export async function checkStaleNavigationState(): Promise<void> {
    const navState = await loadNavigationState();
    if (!navState) return;

    const elapsed = Date.now() - navState.navigationStartTs;
    if (elapsed > navState.timeoutMs) {
        await clearNavigationState();
        logger.info("navigation", "Cleaned up stale navigation state on startup");
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
