import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { DEFAULT_SETTINGS } from "../../src/sidepanel/store/settings-slice";

const { cloudSession, sendMessage } = vi.hoisted(() => ({
  cloudSession: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock("../../src/sidepanel/cloud-client", () => ({
  cloudSession,
  cloudPreferenceSyncEnabled: vi.fn(async () => true),
  setCloudPreferenceSyncEnabled: vi.fn(async () => undefined),
  syncCloudPreferences: vi.fn(async () => ({})),
}));
vi.mock("../../src/sidepanel/runtime", () => ({
  uiRuntime: { sendMessage },
}));
import { SyncSettingsTab } from "../../src/sidepanel/components/settings/SyncSettingsTab";

describe("Sync settings", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    cloudSession.mockReset(); sendMessage.mockReset();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  test("directs signed-out users to the Account tab without duplicating sign-in", async () => {
    cloudSession.mockResolvedValue(null);
    await act(async () => root.render(<SyncSettingsTab formState={DEFAULT_SETTINGS} onChange={() => {}} />));
    await act(async () => undefined);
    expect(container.textContent).toContain("Connect an OpenSidebar account in the Account tab");
    expect(container.querySelector('input[type="email"]')).toBeNull();
  });

  test("centralizes category, cloud activity, and staged Profile controls", async () => {
    cloudSession.mockResolvedValue({ account: { email: "person@example.com" } });
    sendMessage.mockImplementation(async (message: { type: string }) => message.type === "PERSONAL_DATA_SYNC_STATUS"
      ? { ok: true, status: { schemaVersion: 1, capabilities: { schemaVersion: 1, reads: true, writes: true,
        profile: false, namedTester: true }, keyEpoch: 1, currentDeviceApproved: true, approvedDevices: [], documents: {}, pendingRequestCount: 0 },
        preferences: { schemaVersion: 1, accountId: "a", preferencesEnabled: true,
          categories: { saved_prompts: false, website_skills: false, profile: false },
          lastSyncedRevisions: {}, lastSyncedHashes: {} }, conflicts: [] }
      : { ok: true, requests: [] });
    await act(async () => root.render(<SyncSettingsTab formState={DEFAULT_SETTINGS} onChange={() => {}} />));
    await act(async () => undefined);
    expect(container.textContent).toContain("Saved Prompts");
    expect(container.textContent).toContain("Website Skills");
    expect(container.textContent).toContain("Profile");
    expect(container.textContent).toContain("Coming soon");
    expect(container.textContent).toContain("Task sessions");
    expect(container.textContent).toContain("Detailed traces");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Sync Profile"]')?.disabled).toBe(true);
  });
});
