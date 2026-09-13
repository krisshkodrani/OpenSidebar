import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSession, UserSettings } from "@shared-types";
import { decryptTraceBundle } from "@trace-sync";

const local = new Map<string, unknown>();
let settings: UserSettings;

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (keys?: string | string[]) => {
        const names =
          typeof keys === "string" ? [keys] : (keys ?? [...local.keys()]);
        return Object.fromEntries(names.map((name) => [name, local.get(name)]));
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) local.set(key, value);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of typeof keys === "string" ? [keys] : keys)
          local.delete(key);
      }),
    },
    sync: { get: vi.fn(async () => ({ userSettings: settings })) },
  },
};

const session = {
  sessionId: "123e4567-e89b-42d3-a456-426614174000",
  query: "Private task",
  startTime: Date.parse("2026-08-11T12:00:00.000Z"),
  endTime: Date.parse("2026-08-11T12:01:00.000Z"),
  outcome: "completed",
  turnCount: 0,
  startUrl: "https://example.com/private",
  summary: "Private result",
  failureCategory: "none",
  failureCode: "none",
  metrics: null,
  workspaceId: null,
} as TraceSession;

describe("cloud trace sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    local.clear();
    settings = { traceSyncEnabled: false } as UserSettings;
    vi.stubGlobal("chrome", chromeMock);
  });

  it("does nothing until the user explicitly opts in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { uploadCompletedTrace } =
      await import("../../src/background/cloud-trace-sync");
    expect(await uploadCompletedTrace(session, [])).toEqual({
      kind: "disabled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads opaque ciphertext and keeps the recovery key on device", async () => {
    settings = { traceSyncEnabled: true } as UserSettings;
    local.set("cloudExtensionSessionV1", {
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: Date.now() + 60_000,
      account: { accountId: "account-1" },
      device: { id: "device-1" },
    });
    let uploaded: Uint8Array | null = null;
    let intentAttempts = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/traces/upload-intents")) {
          intentAttempts += 1;
          if (intentAttempts === 1)
            return Response.json({ error: {} }, { status: 503 });
          return Response.json(
            {
              uploadUrl: `/api/v1/traces/${session.sessionId}/content`,
              commitUrl: `/api/v1/traces/${session.sessionId}/commit`,
            },
            { status: 201 },
          );
        }
        if (url.endsWith("/content")) {
          uploaded = new Uint8Array(
            await new Response(init?.body).arrayBuffer(),
          );
          return Response.json(
            { ciphertextSha256: "a".repeat(64) },
            { status: 201 },
          );
        }
        return Response.json({ state: "available" });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { uploadCompletedTrace } =
      await import("../../src/background/cloud-trace-sync");
    expect(await uploadCompletedTrace(session, [])).toEqual({
      kind: "uploaded",
    });
    expect(intentAttempts).toBe(2);
    const key = local.get("cloudTraceRecoveryKeyV1");
    expect(typeof key).toBe("string");
    expect(new TextDecoder().decode(uploaded!)).not.toContain("Private task");
    const decrypted = await decryptTraceBundle(uploaded!, key as string);
    expect((decrypted.bundle.session as { query: string }).query).toBe(
      "Private task",
    );
  });
});
