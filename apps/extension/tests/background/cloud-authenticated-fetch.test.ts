import { describe, expect, it, vi } from "vitest";
import {
  CLOUD_EXTENSION_SESSION_KEY,
  CloudAuthenticatedFetch,
} from "../../src/cloud/authenticated-fetch";

function storage(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  return {
    values,
    port: {
      get: vi.fn(async () => ({ ...values })),
      set: vi.fn(async (items: Record<string, unknown>) => Object.assign(values, items)),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
      }),
      onChanged: vi.fn(() => () => undefined),
    },
  };
}

describe("background cloud authenticated fetch", () => {
  it("fails logged-out before making a network request", async () => {
    const stored = storage();
    const fetchImpl = vi.fn();
    await expect(new CloudAuthenticatedFetch(stored.port, "https://cloud.test", fetchImpl).request("/sessions"))
      .rejects.toThrow("cloud_sign_in_required");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes an expired session and retries with the new bearer token", async () => {
    const stored = storage({
      [CLOUD_EXTENSION_SESSION_KEY]: {
        accessToken: "old",
        refreshToken: "refresh",
        accessExpiresAt: 0,
        account: { accountId: "account", email: "a@example.test" },
        device: { deviceId: "device" },
      },
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accessToken: "new",
        refreshToken: "next",
        accessExpiresInSeconds: 900,
        account: { accountId: "account", email: "a@example.test" },
        device: { deviceId: "device" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(new CloudAuthenticatedFetch(stored.port, "https://cloud.test", fetchImpl).request("/sessions"))
      .resolves.toMatchObject({ status: 200 });
    const headers = new Headers(fetchImpl.mock.calls[1][1].headers);
    expect(headers.get("authorization")).toBe("Bearer new");
  });

  it("preserves the saved session when refresh fails transiently", async () => {
    const session = {
      accessToken: "old",
      refreshToken: "refresh",
      accessExpiresAt: 0,
      account: { accountId: "account", email: "a@example.test" },
      device: { id: "device" },
    };
    const stored = storage({ [CLOUD_EXTENSION_SESSION_KEY]: session });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 503 }));

    await expect(
      new CloudAuthenticatedFetch(stored.port, "https://cloud.test", fetchImpl).request("/sessions"),
    ).rejects.toThrow("cloud_temporarily_unavailable");
    expect(stored.values[CLOUD_EXTENSION_SESSION_KEY]).toEqual(session);
    expect(stored.port.remove).not.toHaveBeenCalled();
  });

  it("clears the saved session when the refresh credential is rejected", async () => {
    const stored = storage({
      [CLOUD_EXTENSION_SESSION_KEY]: {
        accessToken: "old",
        refreshToken: "refresh",
        accessExpiresAt: 0,
        account: { accountId: "account", email: "a@example.test" },
        device: { id: "device" },
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 401 }));

    await expect(
      new CloudAuthenticatedFetch(stored.port, "https://cloud.test", fetchImpl).request("/sessions"),
    ).rejects.toThrow("cloud_session_expired");
    expect(stored.values[CLOUD_EXTENSION_SESSION_KEY]).toBeUndefined();
  });
});
