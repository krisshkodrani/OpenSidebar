import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const storage = {
    get: vi.fn(async (keys?: string | string[]) => {
      const requested = typeof keys === "string" ? [keys] : (keys ?? []);
      return Object.fromEntries(
        requested
          .filter((key) => values.has(key))
          .map((key) => [key, values.get(key)]),
      );
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys)
        values.delete(key);
    }),
  };
  return {
    values,
    storage,
    port: {
      storage: { local: storage },
      getExtensionVersion: vi.fn(() => "0.7.0"),
      getIdentityRedirectUrl: vi.fn(
        (path: string) =>
          `https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/${path}`,
      ),
      launchWebAuthFlow: vi.fn(),
    },
  };
});

vi.mock("../../src/sidepanel/runtime", () => ({ uiRuntime: runtime.port }));

import {
  cloudPreferencesLinked,
  importCloudPreferences,
  linkCloudAccount,
  signInCloudWithPkce,
  syncCloudPreferences,
} from "../../src/sidepanel/cloud-client";

const session = {
  schemaVersion: 1,
  accessToken: "access-token",
  refreshToken: "refresh-token",
  accessExpiresInSeconds: 900,
  account: {
    schemaVersion: 1,
    accountId: "account-1",
    email: "tester@example.com",
    cloudAccess: true,
    sessionEpoch: 1,
  },
  device: {
    schemaVersion: 1,
    deviceId: "device-1",
    installationId: "installation-1",
    displayName: "Chrome",
    extensionVersion: "0.7.0",
    createdAt: "2026-08-08T00:00:00.000Z",
    lastSeenAt: "2026-08-08T00:00:00.000Z",
    revokedAt: null,
  },
};

describe("cloud account client", () => {
  beforeEach(() => {
    runtime.values.clear();
    runtime.storage.get.mockClear();
    runtime.storage.set.mockClear();
    runtime.storage.remove.mockClear();
    runtime.port.launchWebAuthFlow.mockReset();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("links a device without silently linking preferences", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(session), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    await linkCloudAccount("ABCDEFGH");

    expect(await cloudPreferencesLinked()).toBe(false);
    expect(runtime.values.get("cloudExtensionSessionV1")).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
  });

  it("syncs only allowlisted preferences and links them after a successful save", async () => {
    runtime.values.set("cloudExtensionSessionV1", {
      ...session,
      accessExpiresAt: Date.now() + 60_000,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockImplementationOnce(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          schemaVersion: 1,
          revision: 1,
          inferenceMode: "cloud",
          providerMode: "openrouter",
        });
        expect(body).not.toHaveProperty("allowDestructiveActions");
        expect(new Headers(init?.headers).get("if-match")).toBe("0");
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    await syncCloudPreferences({
      openRouterApiKey: "must-not-be-uploaded",
      inferenceMode: "cloud",
      providerMode: "openrouter",
      allowDestructiveActions: true,
    } as never);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await cloudPreferencesLinked()).toBe(true);
  });

  it("does not link preferences when no cloud preferences exist", async () => {
    runtime.values.set("cloudExtensionSessionV1", {
      ...session,
      accessExpiresAt: Date.now() + 60_000,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    expect(await importCloudPreferences()).toBeNull();
    expect(await cloudPreferencesLinked()).toBe(false);
  });

  it("refreshes and retries once when the synced preference revision conflicts", async () => {
    runtime.values.set("cloudExtensionSessionV1", {
      ...session,
      accessExpiresAt: Date.now() + 60_000,
    });
    const current = {
      schemaVersion: 1,
      revision: 4,
      inferenceMode: "cloud",
      providerMode: "openrouter",
      maxTurns: 100,
      theme: "system",
      showSessionMetrics: true,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(current), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "revision_conflict" } }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...current, revision: 5 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockImplementationOnce(async (_input, init) => {
        expect(new Headers(init?.headers).get("if-match")).toBe("5");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.revision).toBe(6);
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    await syncCloudPreferences({
      ...current,
      revision: undefined,
      openRouterApiKey: "",
    } as never);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await cloudPreferencesLinked()).toBe(true);
  });

  it("uses the exact identity redirect and verifies OAuth state before exchange", async () => {
    vi.stubEnv("VITE_OPENSIDEBAR_COGNITO_DOMAIN", "https://auth.example.com");
    vi.stubEnv("VITE_OPENSIDEBAR_COGNITO_EXTENSION_CLIENT_ID", "client-id");
    runtime.port.launchWebAuthFlow.mockImplementation(
      async (authorize: string) => {
        const url = new URL(authorize);
        expect(url.origin).toBe("https://auth.example.com");
        expect(url.searchParams.get("redirect_uri")).toBe(
          "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/opensidebar",
        );
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        return `https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/opensidebar?code=oauth-code&state=${url.searchParams.get("state")}`;
      },
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(session), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    await signInCloudWithPkce();

    const exchange = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(exchange).toMatchObject({
      code: "oauth-code",
      redirectUri:
        "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/opensidebar",
    });
    expect(exchange.codeVerifier).toEqual(expect.any(String));
  });

  it("rejects a PKCE callback with the wrong OAuth state before exchange", async () => {
    vi.stubEnv("VITE_OPENSIDEBAR_COGNITO_DOMAIN", "https://auth.example.com");
    vi.stubEnv("VITE_OPENSIDEBAR_COGNITO_EXTENSION_CLIENT_ID", "client-id");
    runtime.port.launchWebAuthFlow.mockResolvedValue(
      "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/opensidebar?code=oauth-code&state=wrong",
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(signInCloudWithPkce()).rejects.toThrow(
      "Sign-in state did not match.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
