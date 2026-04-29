import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { loadSettings, saveSettings } from "../../src/utils/settings-storage";

describe("settings storage", () => {
  const originalSyncGet = chrome.storage.sync.get;
  const originalSyncSet = chrome.storage.sync.set;
  const originalLocalGet = chrome.storage.local.get;
  const originalLocalSet = chrome.storage.local.set;
  const originalSessionGet = chrome.storage.session.get;
  const originalSessionRemove = chrome.storage.session.remove;

  afterEach(() => {
    chrome.storage.sync.get = originalSyncGet;
    chrome.storage.sync.set = originalSyncSet;
    chrome.storage.local.get = originalLocalGet;
    chrome.storage.local.set = originalLocalSet;
    chrome.storage.session.get = originalSessionGet;
    chrome.storage.session.remove = originalSessionRemove;
  });

  test("migrates legacy useVLExecutor to unified multimodal perception", async () => {
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

    expect(settings?.perceptionMode).toBe("unified_vl");
    expect("useVLExecutor" in (settings ?? {})).toBe(false);
    expect(settings?.kimiApiKey).toBe("sk-kimi-test");
    expect(settings?.xiaomiApiKey).toBe("sk-xiaomi-test");
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
    expect(settings?.perceptionMode).toBe("unified_vl");
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
        perceptionMode: "unified_vl",
      }),
    });
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
    expect(payload.perceptionMode).toBe("unified_vl");
  });
});
