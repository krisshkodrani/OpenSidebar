import assert from "node:assert/strict";
import { test } from "node:test";
import { readOpenRouterEndpoints } from "../src/relay-metadata.js";

const allowlist = new Set(["custom/planner"]);
test("metadata lookup uses the account vault key and returns only routing measurements", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      String(url),
      "https://openrouter.ai/api/v1/models/custom/planner/endpoints",
    );
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer vaulted-key",
    );
    return Response.json({
      data: {
        endpoints: [
          {
            tag: "host/fp8",
            status: 0,
            pricing: { completion: "0.000001", prompt: "0.0001" },
            latency_last_30m: { p50: 1500, p99: 5000 },
            throughput_last_30m: { p50: 90 },
            unrelated: "excluded",
          },
          null,
        ],
      },
    });
  };
  try {
    const result = await readOpenRouterEndpoints(
      {
        decrypt: async (account, provider) => {
          assert.equal(account, "account-1");
          assert.equal(provider, "openrouter");
          return "vaulted-key";
        },
      },
      "account-1",
      "custom/planner",
      allowlist,
      new AbortController().signal,
    );
    assert.deepEqual(result.data.endpoints[0], {
      tag: "host/fp8",
      status: 0,
      pricing: { completion: "0.000001" },
      latency_last_30m: { p50: 1500 },
      throughput_last_30m: { p50: 90 },
    });
    assert.equal(result.data.endpoints[1].status, null);
    assert.equal(JSON.stringify(result).includes("vaulted-key"), false);
    assert.equal(JSON.stringify(result).includes("excluded"), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("invalid and unallowlisted models fail before vault access", async () => {
  const vault = {
    decrypt: async () => {
      throw new Error("must not decrypt");
    },
  };
  for (const model of [
    "other/model",
    "custom/../planner",
    "custom/planner?key=x",
  ]) {
    await assert.rejects(
      readOpenRouterEndpoints(
        vault,
        "a",
        model,
        allowlist,
        new AbortController().signal,
      ),
      /invalid_request/,
    );
  }
});

test("metadata upstream errors, malformed bodies and oversized bodies fail closed", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [
      new Response("secret error", { status: 500 }),
      Response.json(null),
      Response.json({ data: { endpoints: {} } }),
      new Response("x".repeat(512 * 1024 + 1)),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(
        readOpenRouterEndpoints(
          { decrypt: async () => "key" },
          "a",
          "custom/planner",
          allowlist,
          new AbortController().signal,
        ),
        /verification_failed/,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("aborted metadata lookup makes no upstream request", async () => {
  await assert.rejects(
    readOpenRouterEndpoints(
      {
        decrypt: async () => {
          throw new Error("must not decrypt");
        },
      },
      "a",
      "custom/planner",
      allowlist,
      AbortSignal.abort(),
    ),
    /AbortError/,
  );
});
