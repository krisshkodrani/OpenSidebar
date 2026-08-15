import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";

const cloud = vi.hoisted(() => ({
  cloudSession: vi.fn(),
  clearPendingCloudEmailAuth: vi.fn(),
  credentialStatuses: vi.fn(),
  disableRemoteWork: vi.fn(),
  importCloudPreferences: vi.fn(),
  linkCloudAccount: vi.fn(),
  pendingCloudEmailAuth: vi.fn(),
  remoteWorkStatus: vi.fn(),
  renameCloudDevice: vi.fn(),
  requestCloudEmailCode: vi.fn(),
  signOutCloud: vi.fn(),
  subscribeCloudSession: vi.fn(),
  syncCloudPreferences: vi.fn(),
  verifyCloudEmailCode: vi.fn(),
}));

vi.mock("../../src/sidepanel/cloud-client", () => cloud);

import { CloudAccountSettings } from "../../src/sidepanel/components/settings/CloudAccountSettings";

const session = {
  account: { email: "tester@example.com" },
  device: { displayName: "Acceptance Chrome" },
};

describe("CloudAccountSettings session projection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let sessionListener: ((value: typeof session | null) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionListener = undefined;
    cloud.pendingCloudEmailAuth.mockResolvedValue(null);
    cloud.credentialStatuses.mockResolvedValue([]);
    cloud.remoteWorkStatus.mockResolvedValue(null);
    cloud.subscribeCloudSession.mockImplementation((listener) => {
      sessionListener = listener;
      return vi.fn();
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderSettings() {
    await act(async () => {
      root.render(
        <CloudAccountSettings
          formState={{ providerMode: "openrouter" } as never}
          onChange={vi.fn()}
        />,
      );
    });
  }

  test("does not restore a stale identity after an authenticated reload clears the session", async () => {
    cloud.cloudSession
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(null);

    await renderSettings();

    await expect
      .poll(() => container.textContent)
      .toContain("Email me a sign-in code");
    expect(container.textContent).not.toContain("tester@example.com");
  });

  test("returns a mounted account view to sign-in when another context removes the session", async () => {
    cloud.cloudSession.mockResolvedValue(session);
    await renderSettings();
    await expect
      .poll(() => container.textContent)
      .toContain("tester@example.com");

    await act(async () => sessionListener?.(null));

    expect(container.textContent).toContain("Email me a sign-in code");
    expect(container.textContent).not.toContain("tester@example.com");
  });
});
