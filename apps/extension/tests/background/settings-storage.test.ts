import { afterEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { loadSettings } from "../../src/utils/settings-storage";

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
    })) as any;
    chrome.storage.session.get = vi.fn(async () => ({})) as any;

    const settings = await loadSettings();

    expect(settings?.perceptionMode).toBe("structured");
    expect("useVLExecutor" in (settings ?? {})).toBe(false);
  });
});
