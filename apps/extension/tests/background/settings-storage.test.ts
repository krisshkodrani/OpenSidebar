import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { loadSettings, saveSettings } from "../../src/utils/settings-storage";

describe("settings storage", () => {
  const originalSyncGet = chrome.storage.sync.get;
  const originalLocalGet = chrome.storage.local.get;
  const originalSessionGet = chrome.storage.session.get;

  afterEach(() => {
    chrome.storage.sync.get = originalSyncGet;
    chrome.storage.local.get = originalLocalGet;
    chrome.storage.session.get = originalSessionGet;
  });

  test("migrates legacy useVLExecutor into perceptionMode", async () => {
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
      kimiApiKey_local: "sk-kimi-test",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.perceptionMode).toBe("structured");
    expect("useVLExecutor" in (settings ?? {})).toBe(false);
    expect(settings?.kimiApiKey).toBe("sk-kimi-test");
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
      kimiApiKey_local: "",
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.providerMode).toBe("fireworks");
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
      userSettings: expect.objectContaining({ providerMode: "fireworks" }),
    });
  });
});
