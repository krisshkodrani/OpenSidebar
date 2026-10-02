import assert from "node:assert/strict";
import { test } from "node:test";
import { smokeProvider } from "./provider-smoke";

test("provider smoke sends one bounded completion and records reported usage", async () => {
  let requestedUrl = "";
  let requestBody: Record<string, unknown> = {};
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(url);
    requestBody = JSON.parse(String(init?.body));
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer test-key");
    return Response.json({
      choices: [{ message: { content: "OK" } }],
      usage: { prompt_tokens: 12, completion_tokens: 2, cost: 0.000001 },
    });
  }) as typeof fetch;

  const result = await smokeProvider("openrouter", "test-key", fetchMock);
  assert.match(requestedUrl, /openrouter\.ai/);
  assert.equal(requestBody.max_tokens, 64);
  assert.equal(requestBody.stream, false);
  assert.deepEqual(result, {
    model: "openai/gpt-6-luna",
    answer: "OK",
    promptTokens: 12,
    completionTokens: 2,
    costUsd: 0.000001,
  });
});

test("provider smoke rejects an empty completion", async () => {
  const fetchMock = (async () => Response.json({ choices: [{ message: { content: " " } }] })) as typeof fetch;
  await assert.rejects(smokeProvider("fireworks", "test-key", fetchMock), /empty completion/);
});
