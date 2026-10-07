/**
 * Centralized settings storage — splits sensitive credentials from general settings.
 *
 * API keys → chrome.storage.local (persistent; never synced)
 * All other settings → chrome.storage.sync (cross-device sync)
 */

import {
  DEFAULT_ENABLED_SKILL_PACK_IDS,
  DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
  type UserSettings,
} from "../types";
import { isExecutorEligible, type ProviderMode } from "./executor-model-policy";

import { chromePersistencePort } from "../background/environment/chrome";

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
const LOCAL_CEREBRAS_KEY = "cerebrasApiKey_local";
const LEGACY_LOCAL_JOBAGENT_MCP_TOKEN_KEY = "jobAgentMcpToken_local";

export type SettingsStorageKeys =
  | string
  | string[]
  | Record<string, unknown>
  | null
  | undefined;

// Narrow storage interface the settings functions consume. The UI supplies a
// runtime-routed backend (sidepanel/runtime.ts) that satisfies this shape; the
// background default is the shared environment PersistencePort, which is a
// superset (adds onChanged/session) and so satisfies it structurally.
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

// RFC LP-15, Phase 3: the chrome default is the shared environment port.
export const chromeSettingsStorage: SettingsStorageBackend =
  chromePersistencePort;

export function normalizeMaxImagePromptTokenEstimate(value: unknown): number {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numericValue) && numericValue >= 0
    ? Math.floor(numericValue)
    : DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE;
}

function normalizeCredential(value: string | undefined): string {
  return value?.trim() ?? "";
}

const RETIRED_KEY_FIELDS = [
  "openaiApiKey",
  "groqApiKey",
  "geminiApiKey",
  "fireworksApiKey",
  "deepseekApiKey",
  "kimiApiKey",
  "xiaomiApiKey",
  "cerebrasApiKey",
];
const RETIRED_LOCAL_KEYS = [
  LOCAL_OPENAI_KEY,
  LOCAL_GROQ_KEY,
  LOCAL_GEMINI_KEY,
  LOCAL_FIREWORKS_KEY,
  LOCAL_DEEPSEEK_KEY,
  LOCAL_KIMI_KEY,
  LOCAL_XIAOMI_KEY,
  LOCAL_CEREBRAS_KEY,
];
/** Pure, idempotent migration. Credentials from other providers are never reused. */
export function migrateToOpenRouter(raw: Record<string, unknown>): boolean {
  let changed = false;
  const legacy =
    (raw.providerMode && raw.providerMode !== "openrouter") ||
    (raw.provider && raw.provider !== "openrouter");
  if (legacy)
    for (const key of [
      "executorModel",
      "plannerModel",
      "writerModel",
      "judgeModel",
      "executorProviderPin",
      "plannerProviderPin",
      "judgeProviderPin",
    ]) {
      if (key in raw) {
        delete raw[key];
        changed = true;
      }
    }
  for (const key of [
    "executorModel",
    "plannerModel",
    "writerModel",
    "judgeModel",
  ])
    if (
      typeof raw[key] === "string" &&
      String(raw[key]).startsWith("accounts/")
    ) {
      delete raw[key];
      changed = true;
    }
  if (raw.providerMode !== "openrouter") {
    raw.providerMode = "openrouter";
    changed = true;
  }
  for (const key of [
    "provider",
    "voiceMode",
    "enableVoiceInput",
    "enableVoiceOutput",
    "ttsProvider",
    "ttsVoice",
    "ttsStylePreset",
    "autoVoiceResponse",
    "audioEnabled",
    "speechEnabled",
    ...RETIRED_KEY_FIELDS,
  ])
    if (key in raw) {
      delete raw[key];
      changed = true;
    }
  return changed;
}

export function normalizeEnabledSkillPackIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_ENABLED_SKILL_PACK_IDS];
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || normalized.includes(id)) continue;
    normalized.push(id);
  }
  return normalized;
}

/** Unlike pack ids there is no default: absent means "no skills disabled". */
export function normalizeDisabledSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || normalized.includes(id)) continue;
    normalized.push(id);
  }
  return normalized;
}

/**
 * Save settings: API keys to local storage, everything else to sync storage.
 * All API keys are credentials — never sync them.
 */
export async function saveSettings(
  settings: UserSettings,
  storage: SettingsStorageBackend = chromeSettingsStorage,
): Promise<void> {
  const normalized: UserSettings & Record<string, unknown> = {
    ...settings,
    providerMode: settings.providerMode,
    perceptionMode: settings.perceptionMode ?? "auto",
    maxImagePromptTokenEstimate: normalizeMaxImagePromptTokenEstimate(
      settings.maxImagePromptTokenEstimate,
    ),
    enabledSkillPackIds: normalizeEnabledSkillPackIds(
      settings.enabledSkillPackIds,
    ),
    disabledSkillIds: normalizeDisabledSkillIds(settings.disabledSkillIds),
  };
  migrateToOpenRouter(normalized);
  if (
    normalized.executorModel &&
    !isExecutorEligible(
      normalized.executorModel,
      normalized.providerMode as ProviderMode,
    )
  ) {
    delete normalized.executorModel;
  }
  // Retired LP-11 A/B arm selector — strip if present.
  delete normalized.perceptionAutoDefault;
  delete normalized.useVLExecutor;
  delete normalized.voiceMode;
  delete normalized.jobAgentMcpEnabled;
  delete normalized.jobAgentMcpUrl;
  delete normalized.jobAgentMcpToken;
  const { openRouterApiKey, ...rest } = normalized;
  await storage.local.set({
    [LOCAL_KEY]: normalizeCredential(openRouterApiKey),
  });
  await storage.sync.set({ [SYNC_KEY]: rest });
  await storage.local.remove([
    ...RETIRED_LOCAL_KEYS,
    LEGACY_LOCAL_JOBAGENT_MCP_TOKEN_KEY,
  ]);
  await storage.session
    .remove([SESSION_KEY, ...RETIRED_KEY_FIELDS, ...RETIRED_LOCAL_KEYS])
    .catch(() => {});
}

/**
 * Load settings: merge API keys from local storage with settings from sync storage.
 * The legacy session key is read only for one-time migration.
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
      LOCAL_CEREBRAS_KEY,
    ]),
    // Check legacy session key for migration
    storage.session
      .get(SESSION_KEY)
      .catch(() => ({}) as Record<string, unknown>),
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
  const cerebrasApiKey =
    (localResult[LOCAL_CEREBRAS_KEY] as string | undefined) || "";

  void storage.local
    .remove(LEGACY_LOCAL_JOBAGENT_MCP_TOKEN_KEY)
    .catch(() => {});

  await storage.local.remove(RETIRED_LOCAL_KEYS);
  await storage.session
    .remove([...RETIRED_KEY_FIELDS, ...RETIRED_LOCAL_KEYS])
    .catch(() => {});

  if (
    !syncSettings &&
    !apiKey &&
    !openaiApiKey &&
    !groqApiKey &&
    !geminiApiKey &&
    !fireworksApiKey &&
    !deepseekApiKey &&
    !kimiApiKey &&
    !xiaomiApiKey &&
    !cerebrasApiKey
  ) {
    return null;
  }

  const raw: Record<string, unknown> = { ...(syncSettings ?? {}) };
  let shouldCleanRemovedSettings =
    migrateToOpenRouter(raw) ||
    "jobAgentMcpEnabled" in raw ||
    "jobAgentMcpUrl" in raw ||
    "jobAgentMcpToken" in raw;

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
  delete raw.jobAgentMcpEnabled;
  delete raw.jobAgentMcpUrl;

  // Migrate legacy unified-vision toggle to auto mode. The runtime chooses
  // unified VL only when page or task signals indicate vision is useful.
  if (!raw.perceptionMode) raw.perceptionMode = "auto";
  delete raw.useVLExecutor;
  raw.maxImagePromptTokenEstimate = normalizeMaxImagePromptTokenEstimate(
    raw.maxImagePromptTokenEstimate,
  );
  raw.enabledSkillPackIds = normalizeEnabledSkillPackIds(
    raw.enabledSkillPackIds,
  );
  raw.disabledSkillIds = normalizeDisabledSkillIds(raw.disabledSkillIds);

  if (
    typeof raw.executorModel === "string" &&
    !isExecutorEligible(raw.executorModel, raw.providerMode as ProviderMode)
  ) {
    delete raw.executorModel;
    shouldCleanRemovedSettings = true;
  }

  // Retired LP-11 A/B arm selector — strip if it ever synced.
  delete raw.perceptionAutoDefault;

  // Strip API keys from sync data in case they leaked from an older version
  if ("openRouterApiKey" in raw) shouldCleanRemovedSettings = true;
  delete raw.openRouterApiKey;
  delete raw.openaiApiKey;
  delete raw.groqApiKey;
  delete raw.geminiApiKey;
  delete raw.fireworksApiKey;
  delete raw.deepseekApiKey;
  delete raw.kimiApiKey;
  delete raw.xiaomiApiKey;
  delete raw.cerebrasApiKey;
  delete raw.jobAgentMcpToken;

  if (shouldCleanRemovedSettings) {
    await storage.sync.set({ [SYNC_KEY]: raw }).catch(() => {});
  }

  return {
    ...raw,
    openRouterApiKey: apiKey ?? "",
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
