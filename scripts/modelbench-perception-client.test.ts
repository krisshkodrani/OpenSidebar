import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { MODEL_BENCH_PERCEPTION_CASES } from "@opensidebar/scenario-engine";
import { inspectPerceptionImage } from "./modelbench-image-artifacts.js";
import { runDirectPerceptionProbe } from "./modelbench-perception-client.js";

function image() {
  const root = mkdtempSync(resolve(tmpdir(), "modelbench-perception-"));
  const path = resolve(root, "shot.png");
  writeFileSync(
    path,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKUlEQVR4nO3OIQEAAAACIP+f1hkWWEB6FgEBAQEBAQEBAQEBAQEBgXdgl/rw4unIZ5cAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  return inspectPerceptionImage({ path, detail: "high", turnNumber: 1 });
}

test("direct lane validates the forced visual-answer tool call", async () => {
  let body: {
    provider?: { allow_fallbacks?: boolean };
    messages?: Array<{
      content?: Array<{ image_url?: { url?: string; detail?: string } }>;
    }>;
  } | null = null;
  const result = await runDirectPerceptionProbe({
    case: MODEL_BENCH_PERCEPTION_CASES[0]!,
    image: image(),
    requested: {
      provider: "openrouter",
      providerPin: "openai",
      model: "vision",
    },
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return new Response(
        JSON.stringify({
          model: "vision-resolved",
          provider: "openai",
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "report_visual_answer",
                      arguments: JSON.stringify({
                        answer: "Ochre",
                        evidence: "warning badge",
                      }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 4, cost: 0.01 },
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(result.passed, true);
  assert.equal(result.resolved?.resolvedModel, "vision-resolved");
  assert.equal(result.usage?.promptTokens, 20);
  assert.equal(body?.provider?.allow_fallbacks, false);
  const imagePart = body?.messages?.[1]?.content?.[1]?.image_url;
  assert.match(imagePart?.url ?? "", /^data:image\/png;base64,/);
  assert.equal(imagePart?.detail, "high");
});

test("direct lane classifies HTTP errors as provider failures", async () => {
  const result = await runDirectPerceptionProbe({
    case: MODEL_BENCH_PERCEPTION_CASES[0]!,
    image: image(),
    requested: { provider: "fireworks", model: "vision" },
    apiKey: "test-key",
    fetchImpl: async () => new Response("rate limited", { status: 429 }),
  });
  assert.equal(result.failure?.kind, "provider");
  assert.match(result.failure?.reason ?? "", /429/);
});

test("direct lane rejects screenshot bytes that changed after capture", async () => {
  const captured = image();
  writeFileSync(captured.path, "changed");
  let called = false;
  const result = await runDirectPerceptionProbe({
    case: MODEL_BENCH_PERCEPTION_CASES[0]!,
    image: captured,
    requested: { provider: "openrouter", model: "vision" },
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return new Response("unexpected");
    },
  });
  assert.equal(called, false);
  assert.equal(result.failure?.kind, "delivery");
  assert.match(result.failure?.reason ?? "", /changed after capture/);
});
