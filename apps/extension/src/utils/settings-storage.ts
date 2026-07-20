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
import {
  isExecutorEligible,
  type ProviderMode,
} from "./executor-model-policy";
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

/**
 * Provider modes whose planner/writer seats are served by Fireworks
 * (llm/client.ts builds the Fireworks planner pool for exactly these). Other
 * modes route those seats to Groq/OpenRouter, where the catalog-style ids are
 * the correct ones — so the rewrite below must not touch them.
 */
const FIREWORKS_SEAT_PROVIDER_MODES = new Set(["fireworks", "cerebras-fireworks"]);

/**
 * Fireworks addresses models as `accounts/fireworks/models/...`; the
 * catalog-style `openai/...` id 404s on that endpoint (proven live — the
 * judge-seat incident). The curated Fireworks catalog offered the catalog-form
 * GPT-OSS id until it was corrected, so a seat chosen before then is persisted
 * broken. Unlike `executorModel` — which self-heals because an ineligible id is
 * dropped below — `plannerModel`/`writerModel` have no normalizer, so without
 * this rewrite the stored id keeps 404ing after the fix ships.
 */
const FIREWORKS_SEAT_MODEL_ID_REWRITES: Readonly<Record<string, string>> = {
  "openai/gpt-oss-120b": "accounts/fireworks/models/gpt-oss-120b",
};

const FIREWORKS_MIGRATED_SEATS = ["plannerModel", "writerModel"] as const;

/**
 * Repair persisted Fireworks seat ids in place. Returns true when something
 * changed (the caller writes the settings back).
 */
export function migrateFireworksSeatModelIds(
  raw: Record<string, unknown>,
): boolean {
  if (!FIREWORKS_SEAT_PROVIDER_MODES.has(String(raw.providerMode))) {
    return false;
  }
  let changed = false;
  for (const seat of FIREWORKS_MIGRATED_SEATS) {
    const current = raw[seat];
    if (typeof current !== "string") continue;
    const replacement = FIREWORKS_SEAT_MODEL_ID_REWRITES[current];
    if (!replacement) continue;
    raw[seat] = replacement;
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
    providerMode: settings.providerMode ?? "fireworks",
    perceptionMode: settings.perceptionMode ?? "auto",
    maxImagePromptTokenEstimate: normalizeMaxImagePromptTokenEstimate(
      settings.maxImagePromptTokenEstimate,
    ),
    enabledSkillPackIds: normalizeEnabledSkillPackIds(
      settings.enabledSkillPackIds,
    ),
  };
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
  const {
    openRouterApiKey,
    openaiApiKey,
    groqApiKey,
    geminiApiKey,
    fireworksApiKey,
    deepseekApiKey,
    kimiApiKey,
    xiaomiApiKey,
    cerebrasApiKey,
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
      [LOCAL_CEREBRAS_KEY]: cerebrasApiKey ?? "",
    }),
    storage.sync.set({ [SYNC_KEY]: rest }),
    // Clean up legacy session key if present
    storage.session.remove(SESSION_KEY).catch(() => {}),
    storage.local.remove(LEGACY_LOCAL_JOBAGENT_MCP_TOKEN_KEY).catch(() => {}),
  ]);
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
  const cerebrasApiKey =
    (localResult[LOCAL_CEREBRAS_KEY] as string | undefined) || "";

  void storage.local.remove(LEGACY_LOCAL_JOBAGENT_MCP_TOKEN_KEY).catch(() => {});

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
    "voiceMode" in raw ||
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
  delete raw.enableVoiceInput;
  delete raw.enableVoiceOutput;
  delete raw.ttsProvider;
  delete raw.ttsVoice;
  delete raw.ttsStylePreset;
  delete raw.autoVoiceResponse;
  delete raw.voiceMode;
  delete raw.jobAgentMcpEnabled;
  delete raw.jobAgentMcpUrl;

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
  raw.maxImagePromptTokenEstimate = normalizeMaxImagePromptTokenEstimate(
    raw.maxImagePromptTokenEstimate,
  );
  raw.enabledSkillPackIds = normalizeEnabledSkillPackIds(
    raw.enabledSkillPackIds,
  );

  if (
    typeof raw.executorModel === "string" &&
    !isExecutorEligible(raw.executorModel, raw.providerMode as ProviderMode)
  ) {
    delete raw.executorModel;
    shouldCleanRemovedSettings = true;
  }

  if (migrateFireworksSeatModelIds(raw)) {
    shouldCleanRemovedSettings = true;
  }

  // Retired LP-11 A/B arm selector — strip if it ever synced.
  delete raw.perceptionAutoDefault;

  // Strip API keys from sync data in case they leaked from an older version
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
    openaiApiKey: openaiApiKey,
    groqApiKey: groqApiKey,
    geminiApiKey: geminiApiKey,
    fireworksApiKey: fireworksApiKey,
    deepseekApiKey: deepseekApiKey,
    kimiApiKey: kimiApiKey,
    xiaomiApiKey: xiaomiApiKey,
    cerebrasApiKey: cerebrasApiKey,
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
