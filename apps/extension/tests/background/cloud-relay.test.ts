import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { cloudRelayFetch } from "../../src/background/llm/cloud-relay";

describe("cloud relay transport", () => {
  const originalGet = chrome.storage.local.get;
  const originalSet = chrome.storage.local.set;
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    chrome.storage.local.get = vi.fn(async () => ({
      cloudExtensionSessionV1: {
        accessToken: "access-old",
        refreshToken: "refresh-old",
        accessExpiresAt: Date.now() + 60_000,
      },
    })) as typeof chrome.storage.local.get;
    chrome.storage.local.set = vi.fn(
      async () => {},
    ) as typeof chrome.storage.local.set;
  });
  afterEach(() => {
    chrome.storage.local.get = originalGet;
    chrome.storage.local.set = originalSet;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("wraps provider payload in the closed versioned relay contract", async () => {
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(
        Object.keys(body).every((key) =>
          [
            "schemaVersion",
            "requestId",
            "abortScopeId",
            "provider",
            "modelId",
            "seat",
            "messages",
            "tools",
            "temperature",
            "maxTokens",
            "stop",
            "responseFormat",
            "toolChoice",
          ].includes(key),
        ),
      ).toBe(true);
      expect(body).toMatchObject({
        schemaVersion: 1,
        provider: "openrouter",
        modelId: "allowed/model",
        seat: "planner",
        messages: [{ role: "user", content: "hello" }],
      });
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer access-old",
      );
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const response = await cloudRelayFetch(
      {
        model: "allowed/model",
        messages: [{ role: "user", content: "hello" }],
        temperature: 0,
      },
      "openrouter",
      "planner",
    );
    expect(response.status).toBe(200);
  });

  test("refreshes once after an unauthorized relay response", async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/extension/auth/refresh"))
        return new Response(
          JSON.stringify({
            accessToken: "access-new",
            refreshToken: "refresh-new",
            accessExpiresInSeconds: 900,
            account: {},
            device: {},
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const authorization = new Headers(init?.headers).get("authorization");
      return authorization === "Bearer access-new"
        ? new Response("ok", { status: 200 })
        : new Response("unauthorized", { status: 401 });
    }) as typeof fetch;
    const response = await cloudRelayFetch(
      {
        model: "allowed/model",
        messages: [{ role: "user", content: "hello" }],
      },
      "fireworks",
      "executor",
    );
    expect(response.status).toBe(200);
    expect(chrome.storage.local.set).toHaveBeenCalledOnce();
  });

  test("rejects providers outside the server allowlist before network access", async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    await expect(
      cloudRelayFetch({ model: "x", messages: [] }, "groq", "executor"),
    ).rejects.toThrow(/not available/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("sends an authenticated relay cancellation without provider fallback", async () => {
    const controller = new AbortController();
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(
        new ReadableStream({
          start() {},
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;

    await cloudRelayFetch(
      {
        model: "allowed/model",
        messages: [{ role: "user", content: "hello" }],
      },
      "openrouter",
      "executor",
      controller.signal,
    );
    controller.abort();
    await vi.waitFor(() => expect(urls).toHaveLength(2));

    expect(urls[0]).toBe(
      "https://opensidebar.com/api/v1/relay/chat/completions",
    );
    expect(urls[1]).toMatch(
      /^https:\/\/opensidebar\.com\/api\/v1\/relay\/requests\//,
    );
    const deleteCall = vi.mocked(globalThis.fetch).mock.calls[1];
    expect(deleteCall?.[1]?.method).toBe("DELETE");
    expect(new Headers(deleteCall?.[1]?.headers).get("authorization")).toBe(
      "Bearer access-old",
    );
    expect(urls.some((url) => url.includes("openrouter.ai"))).toBe(false);
  });
});
