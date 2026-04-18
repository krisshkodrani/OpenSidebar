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
const LOCAL_GROQ_KEY = "groqApiKey_local";
const LOCAL_GEMINI_KEY = "geminiApiKey_local";
const LOCAL_FIREWORKS_KEY = "fireworksApiKey_local";

/**
 * Save settings: API keys to local storage, everything else to sync storage.
 * Both openRouterApiKey and openaiApiKey are credentials — never sync them.
 */
export async function saveSettings(settings: UserSettings): Promise<void> {
  const {
    openRouterApiKey,
    openaiApiKey,
    groqApiKey,
    geminiApiKey,
    fireworksApiKey,
    ...rest
  } = settings;
  await Promise.all([
    chrome.storage.local.set({
      [LOCAL_KEY]: openRouterApiKey,
      [LOCAL_OPENAI_KEY]: openaiApiKey ?? "",
      [LOCAL_GROQ_KEY]: groqApiKey ?? "",
      [LOCAL_GEMINI_KEY]: geminiApiKey ?? "",
      [LOCAL_FIREWORKS_KEY]: fireworksApiKey ?? "",
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
    chrome.storage.local.get([
      LOCAL_KEY,
      LOCAL_OPENAI_KEY,
      LOCAL_GROQ_KEY,
      LOCAL_GEMINI_KEY,
      LOCAL_FIREWORKS_KEY,
    ]),
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
  const groqApiKey = (localResult[LOCAL_GROQ_KEY] as string | undefined) || "";
  const geminiApiKey = (localResult[LOCAL_GEMINI_KEY] as string | undefined) || "";
  const fireworksApiKey = (localResult[LOCAL_FIREWORKS_KEY] as string | undefined) || "";

  if (!syncSettings && !apiKey && !openaiApiKey && !groqApiKey && !geminiApiKey && !fireworksApiKey) {
    return null;
  }

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

  // Migrate legacy `provider` to `providerMode`
  if ("provider" in raw && !("providerMode" in raw)) {
    const p = raw.provider as string;
    if (p === "groq") raw.providerMode = "openrouter-groq";
    else if (p === "openai") raw.providerMode = "openai-groq";
    else raw.providerMode = "openrouter";
    delete raw.provider;
  }

  // Strip API keys from sync data in case they leaked from an older version
  delete raw.openaiApiKey;
  delete raw.groqApiKey;
  delete raw.geminiApiKey;
  delete raw.fireworksApiKey;

  return {
    ...raw,
    openRouterApiKey: apiKey ?? "",
    openaiApiKey: openaiApiKey,
    groqApiKey: groqApiKey,
    geminiApiKey: geminiApiKey,
    fireworksApiKey: fireworksApiKey,
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
