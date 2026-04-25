import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import {
  E2E_SEED_PENDING_INTERACTION_MESSAGE_TYPE,
  E2E_TEST_API_ENABLED_STORAGE_KEY,
  isE2ESeedPendingInteractionMessage,
  isE2ETestApiEnabled,
} from "../../src/background/e2e-test-api";

describe("E2E test API gate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("is disabled by default", async () => {
    (chrome.storage.local.get as any) = vi.fn(async () => ({}));

    await expect(isE2ETestApiEnabled()).resolves.toBe(false);
  });

  test("is enabled only by the explicit local storage flag", async () => {
    (chrome.storage.local.get as any) = vi.fn(async () => ({
      [E2E_TEST_API_ENABLED_STORAGE_KEY]: true,
    }));

    await expect(isE2ETestApiEnabled()).resolves.toBe(true);
  });

  test("recognizes only the pending interaction seed message", () => {
    expect(
      isE2ESeedPendingInteractionMessage({
        type: E2E_SEED_PENDING_INTERACTION_MESSAGE_TYPE,
        payload: {},
      }),
    ).toBe(true);

    expect(
      isE2ESeedPendingInteractionMessage({
        type: "USER_CHAT",
        payload: {},
      }),
    ).toBe(false);
  });
});
