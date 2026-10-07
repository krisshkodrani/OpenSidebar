import "../setup";
import { describe, test, expect } from "vitest";
import {
  loadSettings,
  saveSettings,
  migrateToOpenRouter,
  type SettingsStorageBackend,
} from "../../src/utils/settings-storage";
import {
  getProviderKeyStatus,
  reconcileProviderSelection,
  getAvailableProviderStacks,
} from "../../src/utils/provider-keys";
import { DEFAULT_SETTINGS } from "../../src/sidepanel/store";
function storage(
  initial: Record<string, unknown>,
  local: Record<string, unknown> = {},
) {
  const values = {
    sync: { userSettings: initial } as Record<string, unknown>,
    local,
    session: {} as Record<string, unknown>,
  };
  const backend = Object.fromEntries(
    Object.entries(values).map(([name, data]) => [
      name,
      {
        get: async () => ({ ...data }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(data, items);
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys])
            delete data[key];
        },
      },
    ]),
  ) as unknown as SettingsStorageBackend;
  return { values, backend };
}
describe("OpenRouter-only migration", () => {
  test("clears retired session credentials even without saved settings", async () => {
    const { backend, values } = storage({});
    delete values.sync.userSettings;
    values.session.groqApiKey = "retired";
    values.session.fireworksApiKey_local = "retired";
    expect(await loadSettings(backend)).toBeNull();
    expect(values.session).toEqual({});
  });
  test("persists removed preferences even when the account already uses OpenRouter", async () => {
    const { backend, values } = storage({
      ...DEFAULT_SETTINGS,
      providerMode: "openrouter",
      enableVoiceInput: true,
      ttsProvider: "retired",
      audioEnabled: true,
      speechEnabled: true,
    });
    const first = await loadSettings(backend);
    for (const key of [
      "enableVoiceInput",
      "ttsProvider",
      "audioEnabled",
      "speechEnabled",
    ]) {
      expect(first).not.toHaveProperty(key);
      expect(values.sync.userSettings).not.toHaveProperty(key);
    }
    expect(await loadSettings(backend)).toEqual(first);
  });
  test("retires provider keys and resets incompatible seats without losing preferences", async () => {
    const { values, backend } = storage(
      {
        ...DEFAULT_SETTINGS,
        providerMode: "fireworks",
        executorModel: "accounts/fireworks/models/kimi-k2p7-code",
        judgeModel: "legacy/judge",
        plannerProviderPin: "old-host",
        theme: "dark",
        fireworksApiKey: "leaked",
      },
      {
        fireworksApiKey_local: "old-key",
        openRouterApiKey_local: "router-key",
      },
    );
    const first = await loadSettings(backend),
      second = await loadSettings(backend);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      providerMode: "openrouter",
      openRouterApiKey: "router-key",
      theme: "dark",
    });
    expect(first).not.toHaveProperty("executorModel");
    expect(first).not.toHaveProperty("judgeModel");
    expect(first).not.toHaveProperty("plannerProviderPin");
    expect(values.local).not.toHaveProperty("fireworksApiKey_local");
    expect(values.sync.userSettings).not.toHaveProperty("fireworksApiKey");
  });
  test("preserves compatible OpenRouter models and pins", () => {
    const settings = {
      providerMode: "openrouter",
      plannerModel: "custom/model",
      plannerProviderPin: "host",
    };
    expect(migrateToOpenRouter(settings)).toBe(false);
    expect(settings.plannerModel).toBe("custom/model");
  });
  test("missing OpenRouter key cannot reuse a retired credential", async () => {
    const { backend } = storage(
      { ...DEFAULT_SETTINGS, providerMode: "fireworks" },
      { fireworksApiKey_local: "old-key" },
    );
    const settings = (await loadSettings(backend))!;
    expect(getProviderKeyStatus(settings).hasRequiredKeys).toBe(false);
    expect(getAvailableProviderStacks(settings)).toEqual([]);
  });
  test("save strips stale credential fields from both storage areas", async () => {
    const { backend, values } = storage({}, { fireworksApiKey_local: "old" });
    await saveSettings(
      {
        ...DEFAULT_SETTINGS,
        openRouterApiKey: "router",
        fireworksApiKey: "retired",
      } as never,
      backend,
    );
    expect(values.local).toEqual({ openRouterApiKey_local: "router" });
    expect(values.sync.userSettings).not.toHaveProperty("openRouterApiKey");
    expect(values.sync.userSettings).not.toHaveProperty("fireworksApiKey");
  });
  test("cloud mode retains its account relay; local mode requires its own key", () => {
    expect(
      getProviderKeyStatus({ ...DEFAULT_SETTINGS, inferenceMode: "cloud" })
        .activeKey,
    ).toBe("__opensidebar_cloud__");
    expect(
      getProviderKeyStatus({
        ...DEFAULT_SETTINGS,
        inferenceMode: "local",
        openRouterApiKey: "",
      }).hasRequiredKeys,
    ).toBe(false);
  });
  test("reconciliation clears every legacy seat and pin", () => {
    expect(
      reconcileProviderSelection({
        ...DEFAULT_SETTINGS,
        providerMode: "moonshot",
        judgeModel: "old",
        judgeProviderPin: "old",
      } as never),
    ).not.toHaveProperty("judgeModel");
  });
});
