/**
 * Centralized settings storage — splits sensitive credentials from general settings.
 *
 * API key → chrome.storage.session (service worker only, not accessible to content scripts)
 * All other settings → chrome.storage.sync (cross-device sync)
 */

import type { UserSettings } from "../types";

const SYNC_KEY = "userSettings";
const SESSION_KEY = "openRouterApiKey"; // legacy session key (migration)
const LOCAL_KEY = "openRouterApiKey_local";
const LOCAL_OPENAI_KEY = "openaiApiKey_local";

/**
 * Save settings: API keys to local storage, everything else to sync storage.
 * Both openRouterApiKey and openaiApiKey are credentials — never sync them.
 */
export async function saveSettings(settings: UserSettings): Promise<void> {
  const { openRouterApiKey, openaiApiKey, ...rest } = settings;
  await Promise.all([
    chrome.storage.local.set({
      [LOCAL_KEY]: openRouterApiKey,
      [LOCAL_OPENAI_KEY]: openaiApiKey ?? "",
    }),
    chrome.storage.sync.set({ [SYNC_KEY]: rest }),
    // Clean up legacy session key if present
    chrome.storage.session.remove(SESSION_KEY).catch(() => {}),
  ]);
}

/**
 * Load settings: merge API key from session storage with settings from sync storage.
 */
export async function loadSettings(): Promise<UserSettings | null> {
  const [syncResult, localResult, sessionResult] = await Promise.all([
    chrome.storage.sync.get(SYNC_KEY),
    chrome.storage.local.get([LOCAL_KEY, LOCAL_OPENAI_KEY]),
    // Check legacy session key for migration
    chrome.storage.session
      .get(SESSION_KEY)
      .catch(() => ({}) as Record<string, unknown>),
  ]);
  const syncSettings = syncResult[SYNC_KEY];
  // Prefer local, fall back to legacy session key
  const apiKey =
    (localResult[LOCAL_KEY] as string | undefined) ||
    (sessionResult[SESSION_KEY] as string | undefined);
  const openaiApiKey = (localResult[LOCAL_OPENAI_KEY] as string | undefined) || "";

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

  // Strip openaiApiKey from sync data in case it leaked from an older version
  delete raw.openaiApiKey;

  return {
    ...raw,
    openRouterApiKey: apiKey ?? "",
    openaiApiKey: openaiApiKey,
  } as UserSettings;
}

/**
 * Load only the API key (fast path for background consumers that already have settings).
 */
export async function loadApiKey(): Promise<string> {
  const result = await chrome.storage.local.get(LOCAL_KEY);
  if (result[LOCAL_KEY]) return result[LOCAL_KEY] as string;
  // Migrate from legacy session storage
  try {
    const legacy = await chrome.storage.session.get(SESSION_KEY);
    if (legacy[SESSION_KEY]) {
      const key = legacy[SESSION_KEY] as string;
      await chrome.storage.local.set({ [LOCAL_KEY]: key });
      await chrome.storage.session.remove(SESSION_KEY);
      return key;
    }
  } catch {
    /* empty */
  }
  return "";
}
