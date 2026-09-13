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

  it("serializes refresh rotation across concurrent cloud clients", async () => {
    const originalLocks = Object.getOwnPropertyDescriptor(globalThis.navigator, "locks");
    const lockRequests: string[] = [];
    let lockTail: Promise<unknown> = Promise.resolve();
    Object.defineProperty(globalThis.navigator, "locks", {
      configurable: true,
      value: {
        request<T>(name: string, callback: () => Promise<T>) {
          lockRequests.push(name);
          const result = lockTail.then(callback);
          lockTail = result.catch(() => undefined);
          return result;
        },
      },
    });
    const stored = storage({
      [CLOUD_EXTENSION_SESSION_KEY]: {
        accessToken: "old",
        refreshToken: "refresh",
        accessExpiresAt: 0,
        account: { accountId: "account", email: "a@example.test" },
        device: { id: "device" },
      },
    });
    let refreshCalls = 0;
    const requestTokens: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/extension/auth/refresh")) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({
          accessToken: "new",
          refreshToken: "next",
          accessExpiresInSeconds: 900,
          account: { accountId: "account", email: "a@example.test" },
          device: { id: "device" },
        }), { status: 200 });
      }
      requestTokens.push(new Headers(init?.headers).get("authorization") ?? "");
      return new Response("{}", { status: 200 });
    });
    const first = new CloudAuthenticatedFetch(stored.port, "https://cloud.concurrent.test", fetchImpl);
    const second = new CloudAuthenticatedFetch(stored.port, "https://cloud.concurrent.test", fetchImpl);

    try {
      await Promise.all([first.request("/sessions"), second.request("/sessions")]);

      expect(lockRequests).toHaveLength(2);
      expect(refreshCalls).toBe(1);
      expect(requestTokens).toEqual(["Bearer new", "Bearer new"]);
      expect(stored.values[CLOUD_EXTENSION_SESSION_KEY]).toMatchObject({
        accessToken: "new",
        refreshToken: "next",
      });
    } finally {
      if (originalLocks)
        Object.defineProperty(globalThis.navigator, "locks", originalLocks);
      else delete (globalThis.navigator as Navigator & { locks?: unknown }).locks;
    }
  });

  it("reuses a session refreshed elsewhere after concurrent 401 responses", async () => {
    const stored = storage({
      [CLOUD_EXTENSION_SESSION_KEY]: {
        accessToken: "old",
        refreshToken: "refresh",
        accessExpiresAt: Date.now() + 60_000,
        account: { accountId: "account", email: "a@example.test" },
        device: { id: "device" },
      },
    });
    let refreshCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/extension/auth/refresh")) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(JSON.stringify({
          accessToken: "new",
          refreshToken: "next",
          accessExpiresInSeconds: 900,
          account: { accountId: "account", email: "a@example.test" },
          device: { id: "device" },
        }), { status: 200 });
      }
      const token = new Headers(init?.headers).get("authorization");
      return new Response("{}", { status: token === "Bearer new" ? 200 : 401 });
    });
    const first = new CloudAuthenticatedFetch(stored.port, "https://cloud.401.test", fetchImpl);
    const second = new CloudAuthenticatedFetch(stored.port, "https://cloud.401.test", fetchImpl);

    const responses = await Promise.all([
      first.request("/sessions"),
      second.request("/sessions"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(refreshCalls).toBe(1);
  });

  it("lets a restarted client resume from the rotated stored session", async () => {
    const stored = storage({
      [CLOUD_EXTENSION_SESSION_KEY]: {
        accessToken: "old",
        refreshToken: "refresh",
        accessExpiresAt: 0,
        account: { accountId: "account", email: "a@example.test" },
        device: { id: "device" },
      },
    });
    let refreshCalls = 0;
    const requestTokens: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/extension/auth/refresh")) {
        refreshCalls += 1;
        return new Response(JSON.stringify({
          accessToken: "new",
          refreshToken: "next",
          accessExpiresInSeconds: 900,
          account: { accountId: "account", email: "a@example.test" },
          device: { id: "device" },
        }), { status: 200 });
      }
      requestTokens.push(new Headers(init?.headers).get("authorization") ?? "");
      return new Response("{}", { status: 200 });
    });

    await new CloudAuthenticatedFetch(
      stored.port,
      "https://cloud.restart.test",
      fetchImpl,
    ).request("/sessions");
    await new CloudAuthenticatedFetch(
      stored.port,
      "https://cloud.restart.test",
      fetchImpl,
    ).request("/sessions");

    expect(refreshCalls).toBe(1);
    expect(requestTokens).toEqual(["Bearer new", "Bearer new"]);
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
