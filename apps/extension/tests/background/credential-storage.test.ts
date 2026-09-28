import { describe, expect, test } from "vitest";
import "../setup";
import {
  loadApiKey,
  loadSettings,
  saveSettings,
  type SettingsStorageArea,
  type SettingsStorageBackend,
} from "../../src/utils/settings-storage";
import type { UserSettings } from "../../src/types";

function memoryArea(values: Record<string, unknown> = {}): SettingsStorageArea & {
  values: Record<string, unknown>;
} {
  return {
    values,
    async get(keys) {
      if (typeof keys === "string") return { [keys]: values[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, values[key]]));
      return { ...values };
    },
    async set(items) { Object.assign(values, items); },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
  };
}

function memoryBackend(local: Record<string, unknown> = {}): SettingsStorageBackend & {
  local: ReturnType<typeof memoryArea>;
  sync: ReturnType<typeof memoryArea>;
  session: ReturnType<typeof memoryArea>;
} {
  return { local: memoryArea(local), sync: memoryArea(), session: memoryArea() };
}

const credentials = {
  openRouterApiKey: "sk-openrouter-test",
  openaiApiKey: "sk-openai-test",
  groqApiKey: "gsk-test",
  geminiApiKey: "gemini-test",
  fireworksApiKey: "fw-test",
  deepseekApiKey: "sk-deepseek-test",
  kimiApiKey: "sk-kimi-test",
  xiaomiApiKey: "sk-xiaomi-test",
  cerebrasApiKey: "cerebras-test",
};

const settings: UserSettings = {
  ...credentials,
  providerMode: "openrouter",
  maxTurns: 30,
  theme: "system",
  showSessionMetrics: true,
  requireApprovals: true,
  allowNavigation: true,
};

describe("provider credential storage", () => {
  test("encrypts every provider key locally and returns plaintext only to callers", async () => {
    const storage = memoryBackend();
    await saveSettings(settings, storage);

    for (const [name, value] of Object.entries(credentials)) {
      const stored = storage.local.values[`${name}_local`];
      expect(stored).toMatch(/^enc:v1:/);
      expect(stored).not.toContain(value);
      expect(storage.sync.values.userSettings).not.toHaveProperty(name);
    }
    expect(await loadSettings(storage)).toMatchObject(credentials);
    expect(await loadApiKey(storage)).toBe(credentials.openRouterApiKey);
  });

  test("migrates plaintext local and legacy session keys on read", async () => {
    const storage = memoryBackend({
      fireworksApiKey_local: credentials.fireworksApiKey,
    });
    storage.session.values.openRouterApiKey = credentials.openRouterApiKey;

    const loaded = await loadSettings(storage);
    expect(loaded?.openRouterApiKey).toBe(credentials.openRouterApiKey);
    expect(loaded?.fireworksApiKey).toBe(credentials.fireworksApiKey);
    expect(storage.local.values.openRouterApiKey_local).toMatch(/^enc:v1:/);
    expect(storage.local.values.fireworksApiKey_local).toMatch(/^enc:v1:/);
    expect(storage.session.values.openRouterApiKey).toBeUndefined();
    expect(await loadApiKey(storage)).toBe(credentials.openRouterApiKey);
  });

  test("migrates plaintext OpenRouter keys through the fast path", async () => {
    const storage = memoryBackend({ openRouterApiKey_local: credentials.openRouterApiKey });
    expect(await loadApiKey(storage)).toBe(credentials.openRouterApiKey);
    expect(storage.local.values.openRouterApiKey_local).toMatch(/^enc:v1:/);
  });

  test("removes previously synced provider keys instead of restoring them", async () => {
    const storage = memoryBackend();
    storage.sync.values.userSettings = {
      providerMode: "openrouter",
      openRouterApiKey: "old-synced-secret",
      geminiApiKey: "old-gemini-secret",
    };
    const loaded = await loadSettings(storage);
    expect(loaded?.openRouterApiKey).toBe("");
    expect(loaded?.geminiApiKey).toBe("");
    expect(storage.sync.values.userSettings).not.toHaveProperty("openRouterApiKey");
    expect(storage.sync.values.userSettings).not.toHaveProperty("geminiApiKey");
  });

  test("does not return ciphertext when decryption fails", async () => {
    const storage = memoryBackend({ openRouterApiKey_local: "enc:v1:broken" });
    await expect(loadApiKey(storage)).rejects.toThrow();
  });
});
