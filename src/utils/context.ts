/**
 * Execution context detection utilities
 * Helps determine which Chrome extension context code is running in
 */

export type ExecutionContext =
  | "background"
  | "content"
  | "sidepanel"
  | "unknown";

/**
 * Detect the current execution context
 */
export function getExecutionContext(): ExecutionContext {
  if (typeof chrome === "undefined" || !chrome.runtime) {
    return "unknown";
  }

  // Check for service worker (background)
  // Use typeof check to avoid reference error
  if (
    typeof (globalThis as any).ServiceWorkerGlobalScope !== "undefined" &&
    typeof (globalThis as any).importScripts === "function"
  ) {
    return "background";
  }

  // Check for content script context
  // Content scripts have runtime.onMessage but not tabs/alarms APIs
  if (chrome.runtime?.onMessage && (!chrome.tabs || !chrome.alarms)) {
    return "content";
  }

  // Check for sidepanel
  if (typeof chrome !== "undefined" && "sidePanel" in chrome) {
    return "sidepanel";
  }

  return "unknown";
}

/**
 * Check if running in content script context
 */
export function isContentScript(): boolean {
  return getExecutionContext() === "content";
}

/**
 * Check if running in background/service worker context
 */
export function isBackground(): boolean {
  return getExecutionContext() === "background";
}

/**
 * Check if running in sidepanel context
 */
export function isSidepanel(): boolean {
  return getExecutionContext() === "sidepanel";
}

