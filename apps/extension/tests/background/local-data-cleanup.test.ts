import { describe, expect, test } from "vitest";
import { createFakeStorageArea } from "../fakes/persistence";
import { clearLocalExtensionData } from "../../src/background/local-data-cleanup";

describe("local data cleanup", () => {
  test("removes remote mission journals and drafts while preserving account credentials", async () => {
    const local = createFakeStorageArea();
    await local.set({
      "opensidebar:composerDraft:v1:account:workspace:task": { text: "draft" },
      "opensidebar:remoteMissionAttempt:v1:mission": { state: "running" },
      "opensidebar:remoteMissionDelivery:v1": { lastSequence: 2 },
      "opensidebar:remoteMissionStatus:v1": { state: "running" },
      cloudExtensionSessionV1: { accessToken: "keep-account-session" },
    });
    await clearLocalExtensionData(local);
    expect(local.store.has("opensidebar:remoteMissionDelivery:v1")).toBe(false);
    expect(local.store.has("opensidebar:remoteMissionStatus:v1")).toBe(false);
    expect([...local.store.keys()].some((key) => key.includes("remoteMissionAttempt"))).toBe(false);
    expect([...local.store.keys()].some((key) => key.includes("composerDraft"))).toBe(false);
    expect(local.store.has("cloudExtensionSessionV1")).toBe(true);
  });
});
