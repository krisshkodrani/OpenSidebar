/**
 * Centralized settings storage — splits sensitive credentials from general settings.
 *
 * API key → chrome.storage.session (service worker only, not accessible to content scripts)
 * All other settings → chrome.storage.sync (cross-device sync)
 */

import type { UserSettings } from "../types";

const SYNC_KEY = "userSettings";
const SESSION_KEY = "openRouterApiKey";

/**
 * Save settings: API key to session storage, everything else to sync storage.
 */
export async function saveSettings(settings: UserSettings): Promise<void> {
  const { openRouterApiKey, ...rest } = settings;
  await Promise.all([
    chrome.storage.session.set({ [SESSION_KEY]: openRouterApiKey }),
    chrome.storage.sync.set({ [SYNC_KEY]: rest }),
  ]);
}

/**
 * Load settings: merge API key from session storage with settings from sync storage.
 */
export async function loadSettings(): Promise<UserSettings | null> {
  const [syncResult, sessionResult] = await Promise.all([
    chrome.storage.sync.get(SYNC_KEY),
    chrome.storage.session.get(SESSION_KEY),
  ]);
  const syncSettings = syncResult[SYNC_KEY];
  const apiKey = sessionResult[SESSION_KEY] as string | undefined;

  if (!syncSettings && !apiKey) return null;

  const raw: Record<string, unknown> = { ...(syncSettings ?? {}) };

  // Migrate renamed fields (polarity flip)
  if ("bypassApprovals" in raw) {
    raw.requireApprovals = !raw.bypassApprovals;
    delete raw.bypassApprovals;
  }
  if ("disableNavigation" in raw) {
    raw.allowNavigation = !raw.disableNavigation;
    delete raw.disableNavigation;
  }
  // Drop removed fields
  delete raw.workspaceEnabled;
  delete raw.demosAutoInject;
  delete raw.contextWindowSize;
  delete raw.orchestratorMaxTotalTokens;
  delete raw.orchestratorMaxWorkers;

  return {
    ...raw,
    openRouterApiKey: apiKey ?? "",
  } as UserSettings;
}

/**
 * Load only the API key (fast path for background consumers that already have settings).
 */
export async function loadApiKey(): Promise<string> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return (result[SESSION_KEY] as string) ?? "";
}
