import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import {
  DEFAULT_ENABLED_SKILL_PACK_IDS,
  DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
} from "../../src/types";
import {
  loadSettings,
  normalizeEnabledSkillPackIds,
  normalizeMaxImagePromptTokenEstimate,
  saveSettings,
} from "../../src/utils/settings-storage";

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
        providerMode: "fireworks",
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
      openaiApiKey_local: "",
      groqApiKey_local: "",
      geminiApiKey_local: "",
      fireworksApiKey_local: "fw-test",
      deepseekApiKey_local: "",
      kimiApiKey_local: "sk-kimi-test",
      xiaomiApiKey_local: "sk-xiaomi-test",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.perceptionMode).toBe("auto");
    expect("useVLExecutor" in (settings ?? {})).toBe(false);
    expect(settings?.kimiApiKey).toBe("sk-kimi-test");
    expect(settings?.xiaomiApiKey).toBe("sk-xiaomi-test");
  });

  test("persists writerModel to sync storage", async () => {
    const syncSet = vi.fn(async () => {});
    chrome.storage.sync.set = syncSet as any;
    chrome.storage.local.set = vi.fn(async () => {}) as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "sk-or-test",
      providerMode: "openrouter",
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

  test("defaults missing providerMode to Fireworks on load", async () => {
    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
      },
    })) as any;
    chrome.storage.local.get = vi.fn(async () => ({
      openRouterApiKey_local: "",
      openaiApiKey_local: "",
      groqApiKey_local: "",
      geminiApiKey_local: "",
      fireworksApiKey_local: "fw-test",
      deepseekApiKey_local: "",
      kimiApiKey_local: "",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.providerMode).toBe("fireworks");
  });

  test("drops text-only executor overrides on load", async () => {
    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        providerMode: "fireworks",
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
      openaiApiKey_local: "",
      groqApiKey_local: "",
      geminiApiKey_local: "",
      fireworksApiKey_local: "fw-test",
      deepseekApiKey_local: "",
      kimiApiKey_local: "",
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
        providerMode: "fireworks",
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
      fireworksApiKey_local: "fw-test",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    await loadSettings();

    const payload = syncSet.mock.calls[0]?.[0]?.userSettings;
    expect(payload).toBeDefined();
    expect(payload.executorModel).toBeUndefined();
  });

  test("keeps an eligible non-default executor override on load", async () => {
    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        providerMode: "fireworks",
        executorModel: "accounts/fireworks/routers/kimi-k2p6-turbo",
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
      },
    })) as any;
    chrome.storage.local.get = vi.fn(async () => ({
      fireworksApiKey_local: "fw-test",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.executorModel).toBe(
      "accounts/fireworks/routers/kimi-k2p6-turbo",
    );
  });

  test("persists providerMode when saving settings without an explicit mode", async () => {
    const syncSet = vi.fn(async () => {});
    chrome.storage.sync.set = syncSet as any;
    chrome.storage.local.set = vi.fn(async () => {}) as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "",
      fireworksApiKey: "fw-test",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
    });

    expect(syncSet).toHaveBeenCalledWith({
      userSettings: expect.objectContaining({
        providerMode: "fireworks",
        perceptionMode: "auto",
        maxImagePromptTokenEstimate: DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
        enabledSkillPackIds: DEFAULT_ENABLED_SKILL_PACK_IDS,
      }),
    });
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

    const syncSet = vi.fn(async () => {});
    chrome.storage.sync.set = syncSet as any;
    chrome.storage.local.set = vi.fn(async () => {}) as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "",
      fireworksApiKey: "fw-test",
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
        providerMode: "fireworks",
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
      openaiApiKey_local: "",
      groqApiKey_local: "",
      geminiApiKey_local: "",
      fireworksApiKey_local: "fw-test",
      deepseekApiKey_local: "",
      kimiApiKey_local: "",
      xiaomiApiKey_local: "",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.enabledSkillPackIds).toEqual([
      "communication-workflows",
    ]);
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
      fireworksApiKey: "fw-test",
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
        providerMode: "fireworks",
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
      openaiApiKey_local: "",
      groqApiKey_local: "",
      geminiApiKey_local: "",
      fireworksApiKey_local: "fw-test",
      deepseekApiKey_local: "",
      kimiApiKey_local: "",
      xiaomiApiKey_local: "",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.maxImagePromptTokenEstimate).toBe(
      DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
    );
  });

  test("saves and loads DeepSeek key from local storage", async () => {
    const localSet = vi.fn(async () => {});
    chrome.storage.sync.set = vi.fn(async () => {}) as any;
    chrome.storage.local.set = localSet as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "",
      fireworksApiKey: "fw-test",
      deepseekApiKey: "sk-deepseek-test",
      providerMode: "fireworks-deepseek",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
    });

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        deepseekApiKey_local: "sk-deepseek-test",
      }),
    );

    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        providerMode: "fireworks-deepseek",
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
      },
    })) as any;
    chrome.storage.local.get = vi.fn(async () => ({
      openRouterApiKey_local: "",
      openaiApiKey_local: "",
      groqApiKey_local: "",
      geminiApiKey_local: "",
      fireworksApiKey_local: "fw-test",
      deepseekApiKey_local: "sk-deepseek-test",
      kimiApiKey_local: "",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.providerMode).toBe("fireworks-deepseek");
    expect(settings?.deepseekApiKey).toBe("sk-deepseek-test");
  });

  test("strips leaked DeepSeek key from sync storage", async () => {
    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        providerMode: "fireworks-deepseek",
        deepseekApiKey: "leaked-sync-key",
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
      },
    })) as any;
    chrome.storage.local.get = vi.fn(async () => ({
      openRouterApiKey_local: "",
      openaiApiKey_local: "",
      groqApiKey_local: "",
      geminiApiKey_local: "",
      fireworksApiKey_local: "fw-test",
      deepseekApiKey_local: "local-deepseek-key",
      kimiApiKey_local: "",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.providerMode).toBe("fireworks-deepseek");
    expect(settings?.deepseekApiKey).toBe("local-deepseek-key");
  });

  test("saves and loads Xiaomi key from local storage", async () => {
    const localSet = vi.fn(async () => {});
    chrome.storage.sync.set = vi.fn(async () => {}) as any;
    chrome.storage.local.set = localSet as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "",
      xiaomiApiKey: "sk-xiaomi-test",
      providerMode: "xiaomi",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
      requireApprovals: true,
      allowNavigation: true,
    });

    expect(localSet).toHaveBeenCalledWith(
      expect.objectContaining({
        xiaomiApiKey_local: "sk-xiaomi-test",
      }),
    );

    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        providerMode: "xiaomi",
        xiaomiApiKey: "leaked-sync-key",
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
      },
    })) as any;
    chrome.storage.local.get = vi.fn(async () => ({
      openRouterApiKey_local: "",
      openaiApiKey_local: "",
      groqApiKey_local: "",
      geminiApiKey_local: "",
      fireworksApiKey_local: "",
      deepseekApiKey_local: "",
      kimiApiKey_local: "",
      xiaomiApiKey_local: "local-xiaomi-key",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.providerMode).toBe("xiaomi");
    expect(settings?.xiaomiApiKey).toBe("local-xiaomi-key");
  });

  test("does not persist text-only executor overrides", async () => {
    const syncSet = vi.fn(async () => {});
    chrome.storage.sync.set = syncSet as any;
    chrome.storage.local.set = vi.fn(async () => {}) as any;
    chrome.storage.session.remove = vi.fn(async () => {}) as any;

    await saveSettings({
      openRouterApiKey: "",
      fireworksApiKey: "fw-test",
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
      fireworksApiKey: "fw-test",
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
    expect(localRemove).toHaveBeenCalledWith("jobAgentMcpToken_local");
    const saved = syncSet.mock.calls[0]?.[0]?.userSettings;
    expect(saved.voiceMode).toBeUndefined();
    expect(saved.jobAgentMcpEnabled).toBeUndefined();
    expect(saved.jobAgentMcpUrl).toBeUndefined();
    expect(saved.jobAgentMcpToken).toBeUndefined();

    chrome.storage.sync.get = vi.fn(async () => ({
      userSettings: {
        providerMode: "fireworks",
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
      openaiApiKey_local: "",
      groqApiKey_local: "",
      geminiApiKey_local: "",
      fireworksApiKey_local: "fw-test",
      deepseekApiKey_local: "",
      kimiApiKey_local: "",
      xiaomiApiKey_local: "",
      jobAgentMcpToken_local: "local-token",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect((settings as any)?.voiceMode).toBeUndefined();
    expect((settings as any)?.jobAgentMcpToken).toBeUndefined();
    expect((settings as any)?.jobAgentMcpEnabled).toBeUndefined();
    expect((settings as any)?.jobAgentMcpUrl).toBeUndefined();
    expect(localRemove).toHaveBeenCalledWith("jobAgentMcpToken_local");
    const cleaned =
      syncSet.mock.calls[syncSet.mock.calls.length - 1]?.[0]?.userSettings;
    expect(cleaned.voiceMode).toBeUndefined();
    expect(cleaned.jobAgentMcpEnabled).toBeUndefined();
    expect(cleaned.jobAgentMcpUrl).toBeUndefined();
    expect(cleaned.jobAgentMcpToken).toBeUndefined();
  });
});
