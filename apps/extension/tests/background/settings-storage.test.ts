import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import {
  DEFAULT_ENABLED_SKILL_PACK_IDS,
  DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
} from "../../src/types";
import {
  loadSettings,
  migrateRetiredProviderSettings,
  normalizeEnabledSkillPackIds,
  normalizeMaxImagePromptTokenEstimate,
  saveSettings,
} from "../../src/utils/settings-storage";

const BASE_SETTINGS = {
  maxTurns: 30,
  theme: "system",
  showSessionMetrics: true,
  requireApprovals: true,
  allowNavigation: true,
};

const RETIRED_LOCAL_KEYS = [
  "fireworksApiKey_local",
  "openaiApiKey_local",
  "geminiApiKey_local",
  "deepseekApiKey_local",
  "kimiApiKey_local",
  "xiaomiApiKey_local",
  "cerebrasApiKey_local",
];

describe("settings storage", () => {
  const originalSyncGet = chrome.storage.sync.get;
  const originalSyncSet = chrome.storage.sync.set;
  const originalLocalGet = chrome.storage.local.get;
  const originalLocalSet = chrome.storage.local.set;
  const originalLocalRemove = chrome.storage.local.remove;
  const originalSessionGet = chrome.storage.session.get;
  const originalSessionRemove = chrome.storage.session.remove;

  afterEach(() => {
    chrome.storage.sync.get = originalSyncGet;
    chrome.storage.sync.set = originalSyncSet;
    chrome.storage.local.get = originalLocalGet;
    chrome.storage.local.set = originalLocalSet;
    chrome.storage.local.remove = originalLocalRemove;
    chrome.storage.session.get = originalSessionGet;
    chrome.storage.session.remove = originalSessionRemove;
  });

  test("migrates legacy useVLExecutor to auto perception", async () => {
    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        useVLExecutor: false,
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
      },
    })) as any;
    chrome.storage.local.get = vi.fn(async () => ({
      openRouterApiKey_local: "sk-test",
      groqApiKey_local: "",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.perceptionMode).toBe("auto");
    expect("useVLExecutor" in (settings ?? {})).toBe(false);
  });

  test("persists writerModel to sync storage", async () => {
    const syncSet = vi.fn(async () => {});
    chrome.storage.sync.set = syncSet as any;
    chrome.storage.local.set = vi.fn(async () => {}) as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "sk-or-test",
      writerModel: "openai/gpt-5.5",
      maxTurns: 30,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
    });

    expect(syncSet.mock.calls[0]?.[0]?.userSettings).toMatchObject({
      writerModel: "openai/gpt-5.5",
    });
  });

  test("drops text-only executor overrides on load", async () => {
    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        executorModel: "openai/gpt-oss-120b",
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
      },
    })) as any;
    chrome.storage.local.get = vi.fn(async () => ({
      openRouterApiKey_local: "",
      groqApiKey_local: "",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.executorModel).toBeUndefined();
    expect(settings?.perceptionMode).toBe("auto");
  });

  test("dropping an ineligible executor rewrites sync storage once", async () => {
    const syncSet = vi.fn(async () => {});
    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        executorModel: "openai/gpt-oss-120b",
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
      },
    })) as any;
    chrome.storage.sync.set = syncSet as any;
    chrome.storage.local.get = vi.fn(async () => ({
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    await loadSettings();

    const payload = syncSet.mock.calls[0]?.[0]?.userSettings;
    expect(payload).toBeDefined();
    expect(payload.executorModel).toBeUndefined();
  });

  test("normalizes enabled skill pack ids on save and load", async () => {
    expect(normalizeEnabledSkillPackIds(undefined)).toEqual(
      DEFAULT_ENABLED_SKILL_PACK_IDS,
    );
    expect(
      normalizeEnabledSkillPackIds([
        "communication-workflows",
        "communication-workflows",
        "",
        123,
        "custom-pack",
      ]),
    ).toEqual(["communication-workflows", "custom-pack"]);
    expect(normalizeEnabledSkillPackIds(["procurement-workflows", "source-list-workflows"]))
      .toEqual(["source-list-workflows"]);

    const syncSet = vi.fn(async () => {});
    chrome.storage.sync.set = syncSet as any;
    chrome.storage.local.set = vi.fn(async () => {}) as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
      enabledSkillPackIds: [
        "communication-workflows",
        "communication-workflows",
        "custom-pack",
      ],
    });

    expect(syncSet.mock.calls[0]?.[0]?.userSettings).toMatchObject({
      enabledSkillPackIds: ["communication-workflows", "custom-pack"],
    });

    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
        enabledSkillPackIds: ["", "communication-workflows", 42],
      },
    })) as any;
    chrome.storage.local.get = vi.fn(async () => ({
      openRouterApiKey_local: "",
      groqApiKey_local: "",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.enabledSkillPackIds).toEqual(["communication-workflows"]);
  });

  test("normalizes invalid image prompt budgets on save and load", async () => {
    expect(normalizeMaxImagePromptTokenEstimate("12500.9")).toBe(12500);
    expect(normalizeMaxImagePromptTokenEstimate("")).toBe(
      DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
    );

    const syncSet = vi.fn(async () => {});
    chrome.storage.sync.set = syncSet as any;
    chrome.storage.local.set = vi.fn(async () => {}) as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
      maxImagePromptTokenEstimate: -1,
    });

    expect(syncSet.mock.calls[0]?.[0]?.userSettings).toMatchObject({
      maxImagePromptTokenEstimate: DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
    });

    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
        maxImagePromptTokenEstimate: Number.NaN,
      },
    })) as any;
    chrome.storage.local.get = vi.fn(async () => ({
      openRouterApiKey_local: "",
      groqApiKey_local: "",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.maxImagePromptTokenEstimate).toBe(
      DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
    );
  });

  test("does not persist text-only executor overrides", async () => {
    const syncSet = vi.fn(async () => {});
    chrome.storage.sync.set = syncSet as any;
    chrome.storage.local.set = vi.fn(async () => {}) as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "",
      executorModel: "openai/gpt-oss-120b",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
    });

    const payload = syncSet.mock.calls[0]?.[0]?.userSettings;
    expect(payload.executorModel).toBeUndefined();
    expect(payload.perceptionMode).toBe("auto");
  });

  test("strips removed voice and JobAgent MCP settings", async () => {
    const localSet = vi.fn(async () => {});
    const localRemove = vi.fn(async () => {});
    const syncSet = vi.fn(async () => {});
    chrome.storage.sync.set = syncSet as any;
    chrome.storage.local.set = localSet as any;
    chrome.storage.local.remove = localRemove as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
      voiceMode: "openai_realtime",
      jobAgentMcpEnabled: true,
      jobAgentMcpUrl: "http://127.0.0.1:3727/mcp",
      jobAgentMcpToken: "local-dev-token",
    } as any);

    expect(localSet.mock.calls[0]?.[0]).not.toHaveProperty(
      "jobAgentMcpToken_local",
    );
    expect(localRemove).toHaveBeenCalledWith(
      expect.arrayContaining(["jobAgentMcpToken_local"]),
    );
    const saved = syncSet.mock.calls[0]?.[0]?.userSettings;
    expect(saved.voiceMode).toBeUndefined();
    expect(saved.jobAgentMcpEnabled).toBeUndefined();
    expect(saved.jobAgentMcpUrl).toBeUndefined();
    expect(saved.jobAgentMcpToken).toBeUndefined();

    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
        voiceMode: "openai_realtime",
        jobAgentMcpEnabled: true,
        jobAgentMcpUrl: "http://127.0.0.1:3727/mcp",
        jobAgentMcpToken: "leaked-sync-token",
      },
    })) as any;
    chrome.storage.local.get = vi.fn(async () => ({
      openRouterApiKey_local: "",
      groqApiKey_local: "",
      jobAgentMcpToken_local: "local-token",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect((settings as any)?.voiceMode).toBeUndefined();
    expect((settings as any)?.jobAgentMcpToken).toBeUndefined();
    expect((settings as any)?.jobAgentMcpEnabled).toBeUndefined();
    expect((settings as any)?.jobAgentMcpUrl).toBeUndefined();
    expect(localRemove).toHaveBeenCalledWith(
      expect.arrayContaining(["jobAgentMcpToken_local"]),
    );
    const cleaned =
      syncSet.mock.calls[syncSet.mock.calls.length - 1]?.[0]?.userSettings;
    expect(cleaned.voiceMode).toBeUndefined();
    expect(cleaned.jobAgentMcpEnabled).toBeUndefined();
    expect(cleaned.jobAgentMcpUrl).toBeUndefined();
    expect(cleaned.jobAgentMcpToken).toBeUndefined();
  });
  describe("retired provider migration", () => {
    function stubStorage(userSettings: Record<string, unknown>) {
      const syncSet = vi.fn(async () => {});
      const localRemove = vi.fn(async () => {});
      chrome.storage.sync.get = vi.fn(async () => ({ userSettings })) as any;
      chrome.storage.sync.set = syncSet as any;
      chrome.storage.local.get = vi.fn(async () => ({
        openRouterApiKey_local: "sk-test",
      })) as any;
      chrome.storage.local.remove = localRemove as any;
      chrome.storage.session.get = vi.fn(async () => ({})) as any;
      return { syncSet, localRemove };
    }

    test("drops stored providerMode and legacy provider on load, and writes back", async () => {
      const { syncSet } = stubStorage({
        ...BASE_SETTINGS,
        providerMode: "openrouter",
        provider: "openrouter",
        executorModel: "openai/gpt-6-luna",
      });

      const settings = await loadSettings();

      expect(settings).not.toHaveProperty("providerMode");
      expect(settings).not.toHaveProperty("provider");
      expect(settings?.executorModel).toBe("openai/gpt-6-luna");
      const written = syncSet.mock.calls[0]?.[0]?.userSettings;
      expect(written).not.toHaveProperty("providerMode");
      expect(written).not.toHaveProperty("provider");
    });

    test("keeps model seats of a user who already ran OpenRouter", () => {
      const raw: Record<string, unknown> = {
        providerMode: "openrouter",
        plannerModel: "z-ai/glm-5.2",
        writerModel: "openai/gpt-6-luna",
      };
      expect(migrateRetiredProviderSettings(raw)).toBe(true);
      expect(raw).toEqual({
        plannerModel: "z-ai/glm-5.2",
        writerModel: "openai/gpt-6-luna",
      });
    });

    test.each([
      "fireworks",
      "fireworks-deepseek",
      "cerebras-fireworks",
      "openrouter-groq",
      "openai-groq",
      "moonshot",
      "xiaomi",
    ])("drops provider-native model seats of a %s user", async (mode) => {
      const { syncSet } = stubStorage({
        ...BASE_SETTINGS,
        providerMode: mode,
        executorModel: "accounts/fireworks/models/kimi-k2p7-code",
        plannerModel: "accounts/fireworks/models/glm-5p2",
        writerModel: "accounts/fireworks/models/glm-5p2",
        judgeModel: "accounts/fireworks/models/gpt-oss-120b",
      });

      const settings = await loadSettings();

      expect(settings).not.toHaveProperty("providerMode");
      for (const seat of [
        "executorModel",
        "plannerModel",
        "writerModel",
        "judgeModel",
      ]) {
        expect(settings).not.toHaveProperty(seat);
      }
      const written = syncSet.mock.calls[0]?.[0]?.userSettings;
      expect(written).not.toHaveProperty("providerMode");
      expect(written).not.toHaveProperty("plannerModel");
    });

    test("treats a legacy provider field without providerMode as that provider", () => {
      const groq: Record<string, unknown> = {
        provider: "groq",
        plannerModel: "openai/gpt-oss-120b",
      };
      expect(migrateRetiredProviderSettings(groq)).toBe(true);
      expect(groq).toEqual({});
    });

    test("does nothing when neither field is stored", () => {
      const raw: Record<string, unknown> = { plannerModel: "z-ai/glm-5.2" };
      expect(migrateRetiredProviderSettings(raw)).toBe(false);
      expect(raw).toEqual({ plannerModel: "z-ai/glm-5.2" });
    });

    test("deletes stored Fireworks and other retired keys from local storage on load", async () => {
      const { localRemove } = stubStorage({ ...BASE_SETTINGS });

      await loadSettings();

      expect(localRemove).toHaveBeenCalledWith(
        expect.arrayContaining(RETIRED_LOCAL_KEYS),
      );
    });

    test("deletes retired local keys again on save", async () => {
      const localRemove = vi.fn(async () => {});
      chrome.storage.sync.set = vi.fn(async () => {}) as any;
      chrome.storage.local.set = vi.fn(async () => {}) as any;
      chrome.storage.local.remove = localRemove as any;
      chrome.storage.session.remove = vi.fn(async () => {}) as any;

      await saveSettings({
        ...BASE_SETTINGS,
        openRouterApiKey: "sk-or-test",
      } as any);

      expect(localRemove).toHaveBeenCalledWith(
        expect.arrayContaining(RETIRED_LOCAL_KEYS),
      );
    });

    test("never writes providerMode or a retired key when saving old-shaped settings", async () => {
      const syncSet = vi.fn(async () => {});
      const localSet = vi.fn(async () => {});
      chrome.storage.sync.set = syncSet as any;
      chrome.storage.local.set = localSet as any;
      chrome.storage.local.remove = vi.fn(async () => {}) as any;
      chrome.storage.session.remove = vi.fn(async () => {}) as any;

      await saveSettings({
        ...BASE_SETTINGS,
        openRouterApiKey: "sk-or-test",
        providerMode: "fireworks",
        fireworksApiKey: "fw-secret",
        deepseekApiKey: "ds-secret",
      } as any);

      const synced = syncSet.mock.calls[0]?.[0]?.userSettings;
      expect(synced).not.toHaveProperty("providerMode");
      expect(synced).not.toHaveProperty("fireworksApiKey");
      expect(synced).not.toHaveProperty("deepseekApiKey");
      const local = localSet.mock.calls[0]?.[0] ?? {};
      for (const key of RETIRED_LOCAL_KEYS) expect(local).not.toHaveProperty(key);
    });

    test("strips Fireworks and other provider keys that leaked into sync storage", async () => {
      const { syncSet } = stubStorage({
        ...BASE_SETTINGS,
        fireworksApiKey: "leaked-sync-key",
        deepseekApiKey: "leaked-sync-key",
        kimiApiKey: "leaked-sync-key",
      });

      const settings = await loadSettings();

      expect(settings).not.toHaveProperty("fireworksApiKey");
      expect(settings).not.toHaveProperty("deepseekApiKey");
      const written = syncSet.mock.calls[0]?.[0]?.userSettings;
      expect(written).not.toHaveProperty("fireworksApiKey");
      expect(written).not.toHaveProperty("kimiApiKey");
    });

    test("still returns null when only a retired local key exists", async () => {
      chrome.storage.sync.get = vi.fn(async () => ({})) as any;
      chrome.storage.local.get = vi.fn(async () => ({
        fireworksApiKey_local: "fw-secret",
      })) as any;
      chrome.storage.local.remove = vi.fn(async () => {}) as any;
      chrome.storage.session.get = vi.fn(async () => ({})) as any;

      expect(await loadSettings()).toBeNull();
    });
  });
});
