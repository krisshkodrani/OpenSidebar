/**
 * Centralized settings storage — splits sensitive credentials from general settings.
 *
 * API key → chrome.storage.session (service worker only, not accessible to content scripts)
 * All other settings → chrome.storage.sync (cross-device sync)
 */

import type { UserSettings } from "../types";
import {
  isExecutorModelAllowed,
  type ProviderMode,
} from "./executor-model-policy";

const SYNC_KEY = "userSettings";
const SESSION_KEY = "openRouterApiKey"; // legacy session key (migration)
const LOCAL_KEY = "openRouterApiKey_local";
const LOCAL_OPENAI_KEY = "openaiApiKey_local";
const LOCAL_GROQ_KEY = "groqApiKey_local";
const LOCAL_GEMINI_KEY = "geminiApiKey_local";
const LOCAL_FIREWORKS_KEY = "fireworksApiKey_local";
const LOCAL_DEEPSEEK_KEY = "deepseekApiKey_local";
const LOCAL_KIMI_KEY = "kimiApiKey_local";
const LOCAL_XIAOMI_KEY = "xiaomiApiKey_local";

export type SettingsStorageKeys =
  | string
  | string[]
  | Record<string, unknown>
  | null
  | undefined;

export interface SettingsStorageArea {
  get(keys?: SettingsStorageKeys): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface SettingsStorageBackend {
  local: SettingsStorageArea;
  sync: SettingsStorageArea;
  session: SettingsStorageArea;
}

function chromeStorageArea(
  areaName: "local" | "sync" | "session",
): SettingsStorageArea {
  return {
    get(keys) {
      return chrome.storage[areaName].get(keys as any) as unknown as Promise<
        Record<string, unknown>
      >;
    },
    async set(items) {
      await chrome.storage[areaName].set(items);
    },
    async remove(keys) {
      const area = chrome.storage[areaName] as any;
      const remove = area.remove;
      if (typeof remove === "function") {
        await remove.call(area, keys);
      }
    },
  };
}

export const chromeSettingsStorage: SettingsStorageBackend = {
  local: chromeStorageArea("local"),
  sync: chromeStorageArea("sync"),
  session: chromeStorageArea("session"),
};

/**
 * Save settings: API keys to local storage, everything else to sync storage.
 * All API keys are credentials — never sync them.
 */
export async function saveSettings(
  settings: UserSettings,
  storage: SettingsStorageBackend = chromeSettingsStorage,
): Promise<void> {
  const normalized: UserSettings = {
    ...settings,
    providerMode: settings.providerMode ?? "fireworks",
    perceptionMode: settings.perceptionMode ?? "auto",
  };
  if (
    normalized.executorModel &&
    !isExecutorModelAllowed(
      normalized.executorModel,
      normalized.providerMode as ProviderMode,
    )
  ) {
    delete normalized.executorModel;
  }
  delete normalized.useVLExecutor;
  const {
    openRouterApiKey,
    openaiApiKey,
    groqApiKey,
    geminiApiKey,
    fireworksApiKey,
    deepseekApiKey,
    kimiApiKey,
    xiaomiApiKey,
    ...rest
  } = normalized;
  await Promise.all([
    storage.local.set({
      [LOCAL_KEY]: openRouterApiKey,
      [LOCAL_OPENAI_KEY]: openaiApiKey ?? "",
      [LOCAL_GROQ_KEY]: groqApiKey ?? "",
      [LOCAL_GEMINI_KEY]: geminiApiKey ?? "",
      [LOCAL_FIREWORKS_KEY]: fireworksApiKey ?? "",
      [LOCAL_DEEPSEEK_KEY]: deepseekApiKey ?? "",
      [LOCAL_KIMI_KEY]: kimiApiKey ?? "",
      [LOCAL_XIAOMI_KEY]: xiaomiApiKey ?? "",
    }),
    storage.sync.set({ [SYNC_KEY]: rest }),
    // Clean up legacy session key if present
    storage.session.remove(SESSION_KEY).catch(() => {}),
  ]);
}

/**
 * Load settings: merge API key from session storage with settings from sync storage.
 */
export async function loadSettings(
  storage: SettingsStorageBackend = chromeSettingsStorage,
): Promise<UserSettings | null> {
  const [syncResult, localResult, sessionResult] = await Promise.all([
    storage.sync.get(SYNC_KEY),
    storage.local.get([
      LOCAL_KEY,
      LOCAL_OPENAI_KEY,
      LOCAL_GROQ_KEY,
      LOCAL_GEMINI_KEY,
      LOCAL_FIREWORKS_KEY,
      LOCAL_DEEPSEEK_KEY,
      LOCAL_KIMI_KEY,
      LOCAL_XIAOMI_KEY,
    ]),
    // Check legacy session key for migration
    storage.session.get(SESSION_KEY).catch(() => ({}) as Record<string, unknown>),
  ]);
  const syncSettings = syncResult[SYNC_KEY];
  // Prefer local, fall back to legacy session key
  const apiKey =
    (localResult[LOCAL_KEY] as string | undefined) ||
    (sessionResult[SESSION_KEY] as string | undefined);
  const openaiApiKey =
    (localResult[LOCAL_OPENAI_KEY] as string | undefined) || "";
  const groqApiKey = (localResult[LOCAL_GROQ_KEY] as string | undefined) || "";
  const geminiApiKey =
    (localResult[LOCAL_GEMINI_KEY] as string | undefined) || "";
  const fireworksApiKey =
    (localResult[LOCAL_FIREWORKS_KEY] as string | undefined) || "";
  const deepseekApiKey =
    (localResult[LOCAL_DEEPSEEK_KEY] as string | undefined) || "";
  const kimiApiKey = (localResult[LOCAL_KIMI_KEY] as string | undefined) || "";
  const xiaomiApiKey =
    (localResult[LOCAL_XIAOMI_KEY] as string | undefined) || "";

  if (
    !syncSettings &&
    !apiKey &&
    !openaiApiKey &&
    !groqApiKey &&
    !geminiApiKey &&
    !fireworksApiKey &&
    !deepseekApiKey &&
    !kimiApiKey &&
    !xiaomiApiKey
  ) {
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
  if (!raw.providerMode) raw.providerMode = "fireworks";

  // Migrate legacy unified-vision toggle to auto mode. The runtime chooses
  // unified VL only when page or task signals indicate vision is useful.
  if (!raw.perceptionMode) raw.perceptionMode = "auto";
  delete raw.useVLExecutor;

  if (
    typeof raw.executorModel === "string" &&
    !isExecutorModelAllowed(raw.executorModel, raw.providerMode as ProviderMode)
  ) {
    delete raw.executorModel;
  }

  // Strip API keys from sync data in case they leaked from an older version
  delete raw.openaiApiKey;
  delete raw.groqApiKey;
  delete raw.geminiApiKey;
  delete raw.fireworksApiKey;
  delete raw.deepseekApiKey;
  delete raw.kimiApiKey;
  delete raw.xiaomiApiKey;

  return {
    ...raw,
    openRouterApiKey: apiKey ?? "",
    openaiApiKey: openaiApiKey,
    groqApiKey: groqApiKey,
    geminiApiKey: geminiApiKey,
    fireworksApiKey: fireworksApiKey,
    deepseekApiKey: deepseekApiKey,
    kimiApiKey: kimiApiKey,
    xiaomiApiKey: xiaomiApiKey,
  } as UserSettings;
}

/**
 * Load only the API key (fast path for background consumers that already have settings).
 */
export async function loadApiKey(
  storage: SettingsStorageBackend = chromeSettingsStorage,
): Promise<string> {
  const result = await storage.local.get(LOCAL_KEY);
  if (result[LOCAL_KEY]) return result[LOCAL_KEY] as string;
  // Migrate from legacy session storage
  try {
    const legacy = await storage.session.get(SESSION_KEY);
    if (legacy[SESSION_KEY]) {
      const key = legacy[SESSION_KEY] as string;
      await storage.local.set({ [LOCAL_KEY]: key });
      await storage.session.remove(SESSION_KEY);
      return key;
    }
  } catch {
    /* empty */
  }
  return "";
}
