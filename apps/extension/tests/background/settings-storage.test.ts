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
});
