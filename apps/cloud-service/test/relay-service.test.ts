import assert from "node:assert/strict";
import { test } from "node:test";
import type { RelayRequestV1 } from "@opensidebar/shared-types";
import { ControlPolicyError } from "../src/control-policy.js";
import { RelayService } from "../src/relay-service.js";
import { MemoryControlRepository } from "./memory-control-repository.js";

const request = (id: string): RelayRequestV1 => ({
  schemaVersion: 1,
  requestId: id,
  abortScopeId: `scope-${id}`,
  provider: "openrouter",
  modelId: "allowed/model",
  seat: "executor",
  messages: [{ role: "user", content: "hello" }],
});
const fireworksRequest = (id: string): RelayRequestV1 => ({
  ...request(id),
  provider: "fireworks",
  modelId: "accounts/fireworks/models/test",
});
test("relay streams provider SSE and records metadata-only token usage", async () => {
  const repository = new MemoryControlRepository();
  const relay = new RelayService(repository, {
    decrypt: async () => "sk-secret",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer sk-secret",
    );
    return new Response(
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"usage":{"prompt_tokens":12,"completion_tokens":4}}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };
  try {
    const response = await relay.stream(
      "account-1",
      request("b0e38c60-f154-4eb3-94bf-da143648153a"),
      new AbortController().signal,
    );
    assert.match(await response.text(), /hello/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(repository.usage, {
      requests: 1,
      inputTokens: 12,
      outputTokens: 4,
    });
    assert.equal(
      repository.requests.get("account-1:b0e38c60-f154-4eb3-94bf-da143648153a")
        ?.status,
      "completed",
    );
    assert.equal(relay.concurrent("account-1"), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("relay constructs the reviewed Fireworks streaming endpoint without caller headers", async () => {
  const repository = new MemoryControlRepository(),
    relay = new RelayService(repository, { decrypt: async () => "fw-key" }),
    originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://api.fireworks.ai/inference/v1/chat/completions",
    );
    const headers = new Headers(init?.headers);
    assert.deepEqual([...headers.keys()].sort(), [
      "accept",
      "authorization",
      "content-type",
    ]);
    const payload = JSON.parse(String(init?.body)) as {
      model: string;
      stream: boolean;
      stream_options: { include_usage: boolean };
    };
    assert.deepEqual(payload, {
      model: "accounts/fireworks/models/test",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
      stream_options: { include_usage: true },
    });
    return new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  try {
    const response = await relay.stream(
      "account-1",
      fireworksRequest("97cf1dcc-63b6-4078-9634-0afbd9d6ddb2"),
      new AbortController().signal,
    );
    await response.text();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("relay maps repository quota and duplicate failures without corrupting prior records", async () => {
  const repository = new MemoryControlRepository();
  const relay = new RelayService(repository, { decrypt: async () => "unused" });
  repository.usage.requests = 2_000;
  await assert.rejects(
    relay.stream(
      "account-1",
      request("5bf7a501-a7ec-45ac-b420-3f028fd10f16"),
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof ControlPolicyError && error.code === "quota_exceeded",
  );
  repository.usage.requests = 0;
  repository.requests.set("account-1:6d11ffb4-5f4f-428b-ad36-cda92330289a", {
    status: "completed",
  });
  await assert.rejects(
    relay.stream(
      "account-1",
      request("6d11ffb4-5f4f-428b-ad36-cda92330289a"),
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof ControlPolicyError && error.code === "duplicate_request",
  );
  assert.equal(
    repository.requests.get("account-1:6d11ffb4-5f4f-428b-ad36-cda92330289a")
      ?.status,
    "completed",
  );
});
test("startup recovery makes interrupted relay records terminal", async () => {
  const repository = new MemoryControlRepository();
  repository.requests.set("account-1:interrupted", {
    status: "active",
    updatedAt: new Date(0),
  });
  repository.requests.set("account-1:current", {
    status: "active",
    updatedAt: new Date(),
  });
  repository.requests.set("account-1:completed", { status: "completed" });

  assert.equal(
    await repository.recoverInterruptedRelayRequests(
      new Date(Date.now() - 16 * 60_000),
    ),
    1,
  );
  assert.equal(
    repository.requests.get("account-1:interrupted")?.status,
    "failed",
  );
  assert.equal(repository.requests.get("account-1:current")?.status, "active");
  assert.equal(
    repository.requests.get("account-1:completed")?.status,
    "completed",
  );
});
test("relay enforces response bytes and provider circuit breaker", async () => {
  const repository = new MemoryControlRepository();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response("too large", { status: 200 })
      : new Response("unavailable", { status: 503 });
  };
  const relay = new RelayService(
    repository,
    { decrypt: async () => "key" },
    { responseBytes: 3, circuitFailures: 2, circuitOpenMs: 60_000 },
  );
  try {
    const oversized = await relay.stream(
      "account-1",
      request("1440aa42-35f5-4589-8315-7918eb154882"),
      new AbortController().signal,
    );
    await assert.rejects(oversized.text(), /provider_response_too_large/);
    await assert.rejects(
      relay.stream(
        "account-1",
        request("57d39ec8-a5b1-4b43-a503-a8ea9ed3300f"),
        new AbortController().signal,
      ),
      /provider_unavailable/,
    );
    await assert.rejects(
      relay.stream(
        "account-1",
        request("3d229a26-4c71-4423-bb10-90a923ff8110"),
        new AbortController().signal,
      ),
      /provider_unavailable/,
    );
    await assert.rejects(
      relay.stream(
        "account-1",
        request("f8c028bd-32e7-4a45-a70f-65d31df9d645"),
        new AbortController().signal,
      ),
      /provider_circuit_open/,
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("relay records provider 401, 429, and 5xx failures without response content", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [index, upstreamStatus] of [401, 429, 503].entries()) {
      const repository = new MemoryControlRepository();
      globalThis.fetch = async () =>
        new Response("provider-secret-response", { status: upstreamStatus });
      const relay = new RelayService(repository, {
        decrypt: async () => "key",
      });
      const requestId = `00000000-0000-4000-8000-00000000000${index}`;

      await assert.rejects(
        relay.stream(
          "account-1",
          request(requestId),
          new AbortController().signal,
        ),
        upstreamStatus >= 500 ? /provider_unavailable/ : /provider_rejected/,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const record = repository.requests.get(`account-1:${requestId}`);
      assert.equal(record?.status, "failed");
      assert.equal(record?.statusClass, Math.floor(upstreamStatus / 100));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("relay forwards explicit cancellation and hard timeout upstream", async () => {
  const originalFetch = globalThis.fetch;
  const repository = new MemoryControlRepository();
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      ),
    );
  try {
    const relay = new RelayService(
      repository,
      { decrypt: async () => "key" },
      { hardTimeoutMs: 10 },
    );
    const pending = relay.stream(
      "account-1",
      request("9a1348d7-c1c2-49f5-9cb4-77b56dcae4cf"),
      new AbortController().signal,
    );
    await assert.rejects(pending, /AbortError/);
    const relay2 = new RelayService(
      repository,
      { decrypt: async () => "key" },
      { hardTimeoutMs: 1_000 },
    );
    const cancelled = relay2.stream(
      "account-1",
      request("1a8e2c54-cc7b-46ed-a49a-6a17d21cd9a5"),
      new AbortController().signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      relay2.cancel("account-1", "scope-1a8e2c54-cc7b-46ed-a49a-6a17d21cd9a5"),
      true,
    );
    await assert.rejects(cancelled, /AbortError/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      repository.requests.get("account-1:1a8e2c54-cc7b-46ed-a49a-6a17d21cd9a5")
        ?.status,
      "cancelled",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("relay enforces per-account concurrent stream limit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new ReadableStream({ start() {} }), { status: 200 });
  const repository = new MemoryControlRepository();
  const relay = new RelayService(repository, { decrypt: async () => "key" });
  try {
    const first = await relay.stream(
        "account-1",
        request("42535f3d-9851-44af-bc6c-516306297308"),
        new AbortController().signal,
      ),
      second = await relay.stream(
        "account-1",
        request("b4eef6b3-aafd-44de-ab2c-994eec7e8d56"),
        new AbortController().signal,
      );
    await assert.rejects(
      relay.stream(
        "account-1",
        request("776e2532-b441-45bc-a334-5924885c91b8"),
        new AbortController().signal,
      ),
      (error: unknown) =>
        error instanceof ControlPolicyError && error.code === "quota_exceeded",
    );
    await Promise.all([first.body?.cancel(), second.body?.cancel()]);
    assert.equal(relay.concurrent("account-1"), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
