/**
 * Centralized settings storage — splits sensitive credentials from general settings.
 *
 * API keys → AES-GCM ciphertext in chrome.storage.local (persistent; never synced)
 * All other settings → chrome.storage.sync (cross-device sync)
 * The encryption key also lives in local storage. This prevents plaintext keys
 * in a storage dump, but does not protect against access to both key and blob.
 */

import {
  DEFAULT_ENABLED_SKILL_PACK_IDS,
  DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
  type UserSettings,
} from "../types";
import { isExecutorEligible } from "./executor-model-policy";
import { chromePersistencePort } from "../background/environment/chrome";
import {
  decryptField,
  encryptField,
  getProfileEncryptionKey,
  isEncryptedValue,
} from "./profile-crypto";

const SYNC_KEY = "userSettings";
const SESSION_KEY = "openRouterApiKey"; // legacy session key (migration)
const LOCAL_KEY = "openRouterApiKey_local";
const LOCAL_GROQ_KEY = "groqApiKey_local"; // speech-to-text only
const LOCAL_CREDENTIAL_KEYS = [LOCAL_KEY, LOCAL_GROQ_KEY] as const;
const SYNC_CREDENTIAL_FIELDS = ["openRouterApiKey", "groqApiKey"] as const;

/**
 * Local keys of removed providers and features. The stored value is the
 * (encrypted) secret itself, so deleting the key deletes the secret. OpenRouter
 * is the only LLM provider; Fireworks and the other direct-provider keys have
 * no reader any more. Removed on every load and save.
 */
const RETIRED_LOCAL_KEYS = [
  "fireworksApiKey_local",
  "openaiApiKey_local",
  "geminiApiKey_local",
  "deepseekApiKey_local",
  "kimiApiKey_local",
  "xiaomiApiKey_local",
  "cerebrasApiKey_local",
  "jobAgentMcpToken_local",
] as const;

/** Credential fields that older versions may have leaked into synced settings. */
const RETIRED_SYNC_CREDENTIAL_FIELDS = [
  "fireworksApiKey",
  "openaiApiKey",
  "geminiApiKey",
  "deepseekApiKey",
  "kimiApiKey",
  "xiaomiApiKey",
  "cerebrasApiKey",
  "jobAgentMcpToken",
] as const;

/** Model seats hold provider-native ids; they do not survive a provider switch. */
const MODEL_SEAT_FIELDS = [
  "executorModel",
  "plannerModel",
  "writerModel",
  "judgeModel",
] as const;

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

async function withCredentialStorageLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const locks = globalThis.navigator?.locks;
  return locks
    ? await locks.request("opensidebar:provider-credentials", operation)
    : operation();
}

async function encryptCredentials(
  values: Record<string, string>,
  storage: SettingsStorageBackend,
): Promise<Record<string, string>> {
  const entries = Object.entries(values);
  if (!entries.some(([, value]) => value)) return values;
  const key = await getProfileEncryptionKey(storage);
  return Object.fromEntries(
    await Promise.all(
      entries.map(async ([name, value]) => [
        name,
        value ? await encryptField(key, value) : "",
      ]),
    ),
  );
}

async function readCredentials(
  storage: SettingsStorageBackend,
  names: readonly string[] = LOCAL_CREDENTIAL_KEYS,
): Promise<Record<string, string>> {
  return withCredentialStorageLock(async () => {
    const raw = await storage.local.get([...names]);
    const legacyOpenRouterKey = !raw[LOCAL_KEY]
      ? (
          await storage.session
            .get(SESSION_KEY)
            .catch(() => ({}) as Record<string, unknown>)
        )[SESSION_KEY]
      : undefined;
    const values: Record<string, string> = {};
    const migration: Record<string, string> = {};
    let key: CryptoKey | undefined;
    for (const name of names) {
      const stored =
        name === LOCAL_KEY && !raw[name] ? legacyOpenRouterKey : raw[name];
      if (typeof stored !== "string" || !stored) {
        values[name] = "";
        continue;
      }
      key ??= await getProfileEncryptionKey(storage);
      values[name] = isEncryptedValue(stored)
        ? await decryptField(key, stored)
        : stored;
      if (!isEncryptedValue(stored)) {
        migration[name] = await encryptField(key, stored);
      }
    }
    if (Object.keys(migration).length > 0) {
      await storage.local.set(migration);
    }
    if (migration[LOCAL_KEY] && legacyOpenRouterKey && !raw[LOCAL_KEY]) {
      await storage.session.remove(SESSION_KEY);
    }
    return values;
  });
}

/**
 * Drop the retired provider settings from a stored settings object. A user who
 * ran any provider other than OpenRouter also loses the model seats, because
 * those ids (`accounts/fireworks/...`, bare `kimi-k2.6`) 404 on OpenRouter.
 * Returns true when something changed (the caller writes the settings back).
 */
export function migrateRetiredProviderSettings(
  raw: Record<string, unknown>,
): boolean {
  const hadProviderMode = "providerMode" in raw;
  const hadLegacyProvider = "provider" in raw;
  if (!hadProviderMode && !hadLegacyProvider) return false;
  const usedOtherProvider =
    (hadProviderMode && raw.providerMode !== "openrouter") ||
    (hadLegacyProvider && !hadProviderMode && raw.provider !== "openrouter");
  delete raw.providerMode;
  delete raw.provider;
  if (usedOtherProvider) {
    for (const seat of MODEL_SEAT_FIELDS) delete raw[seat];
  }
  return true;
}

export function normalizeEnabledSkillPackIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_ENABLED_SKILL_PACK_IDS];
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const storedId = item.trim();
    const id =
      storedId === "procurement-workflows" ? "source-list-workflows" : storedId;
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
    perceptionMode: settings.perceptionMode ?? "auto",
    maxImagePromptTokenEstimate: normalizeMaxImagePromptTokenEstimate(
      settings.maxImagePromptTokenEstimate,
    ),
    enabledSkillPackIds: normalizeEnabledSkillPackIds(
      settings.enabledSkillPackIds,
    ),
    disabledSkillIds: normalizeDisabledSkillIds(settings.disabledSkillIds),
  };
  if (
    normalized.executorModel &&
    !isExecutorEligible(normalized.executorModel)
  ) {
    delete normalized.executorModel;
  }
  delete normalized.providerMode;
  delete normalized.provider;
  // Retired LP-11 A/B arm selector — strip if present.
  delete normalized.perceptionAutoDefault;
  delete normalized.useVLExecutor;
  delete normalized.voiceMode;
  delete normalized.jobAgentMcpEnabled;
  delete normalized.jobAgentMcpUrl;
  delete normalized.jobAgentMcpToken;
  for (const field of RETIRED_SYNC_CREDENTIAL_FIELDS) delete normalized[field];
  const { openRouterApiKey, groqApiKey, ...rest } = normalized;
  await Promise.all([
    withCredentialStorageLock(async () =>
      storage.local.set(
        await encryptCredentials(
          {
            [LOCAL_KEY]: normalizeCredential(openRouterApiKey),
            [LOCAL_GROQ_KEY]: normalizeCredential(groqApiKey),
          },
          storage,
        ),
      ),
    ),
    storage.sync.set({ [SYNC_KEY]: rest }),
  ]);
  await Promise.all([
    // Retire the legacy key only after the encrypted local write succeeds.
    storage.session.remove(SESSION_KEY).catch(() => {}),
    storage.local.remove([...RETIRED_LOCAL_KEYS]).catch(() => {}),
  ]);
}

/**
 * Load settings: merge API keys from local storage with settings from sync storage.
 * The legacy session key is read only for one-time migration.
 */
export async function loadSettings(
  storage: SettingsStorageBackend = chromeSettingsStorage,
): Promise<UserSettings | null> {
  const [syncResult, credentials] = await Promise.all([
    storage.sync.get(SYNC_KEY),
    readCredentials(storage),
  ]);
  const syncSettings = syncResult[SYNC_KEY];
  const apiKey = credentials[LOCAL_KEY];
  const groqApiKey = credentials[LOCAL_GROQ_KEY];

  void storage.local.remove([...RETIRED_LOCAL_KEYS]).catch(() => {});

  if (!syncSettings && !apiKey && !groqApiKey) return null;

  const raw: Record<string, unknown> = { ...(syncSettings ?? {}) };
  let shouldCleanRemovedSettings =
    "voiceMode" in raw ||
    "jobAgentMcpEnabled" in raw ||
    "jobAgentMcpUrl" in raw ||
    SYNC_CREDENTIAL_FIELDS.some((field) => field in raw) ||
    RETIRED_SYNC_CREDENTIAL_FIELDS.some((field) => field in raw);

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

  if (migrateRetiredProviderSettings(raw)) shouldCleanRemovedSettings = true;

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
    !isExecutorEligible(raw.executorModel)
  ) {
    delete raw.executorModel;
    shouldCleanRemovedSettings = true;
  }

  // Retired LP-11 A/B arm selector — strip if it ever synced.
  delete raw.perceptionAutoDefault;

  // Strip API keys from sync data in case they leaked from an older version
  for (const field of SYNC_CREDENTIAL_FIELDS) delete raw[field];
  for (const field of RETIRED_SYNC_CREDENTIAL_FIELDS) delete raw[field];

  if (shouldCleanRemovedSettings) {
    await storage.sync.set({ [SYNC_KEY]: raw }).catch(() => {});
  }

  return {
    ...raw,
    openRouterApiKey: apiKey ?? "",
    groqApiKey,
  } as UserSettings;
}

/**
 * Load only the API key (fast path for background consumers that already have settings).
 */
export async function loadApiKey(
  storage: SettingsStorageBackend = chromeSettingsStorage,
): Promise<string> {
  return (await readCredentials(storage, [LOCAL_KEY]))[LOCAL_KEY];
}
