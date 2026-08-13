import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { collectModelBenchTraceEvidence } from "./modelbench-trace-evidence.js";

test("collects actual executor, planner, and judge identities and usage", () => {
  const root = mkdtempSync(resolve(tmpdir(), "modelbench-evidence-"));
  const runs = resolve(root, "runs");
  mkdirSync(runs);
  const trace = resolve(root, "turns.jsonl");
  writeFileSync(trace, `${JSON.stringify({
    runId: "run-1",
    llmRequest: { model: "requested-executor", modelTier: "executor" },
    llmResponse: {
      actualModel: "actual-executor",
      actualProviderId: "provider-a",
      durationMs: 11,
      usage: { prompt_tokens: 10, completion_tokens: 2, cached_tokens: 3, cost: 0.4 },
    },
  })}\n`);
  writeFileSync(resolve(runs, "run-1.jsonl"), [
    {
      type: "planner_llm_call",
      data: {
        model: "actual-planner",
        durationMs: 7,
        usage: { prompt_tokens: 5, completion_tokens: 1, cost: 0.2, cacheTelemetry: { provider: "provider-b" } },
      },
    },
    {
      type: "judge_call",
      data: {
        model: "actual-judge",
        providerId: "provider-c",
        durationMs: 3,
        usage: { promptTokens: 4, completionTokens: 1, cachedTokens: 2, costUsd: 0.1 },
      },
    },
  ].map((value) => JSON.stringify(value)).join("\n"));

  const result = collectModelBenchTraceEvidence({
    traceFiles: [trace],
    tracesRoot: root,
    requestedSeats: {
      executor: { provider: "router", model: "requested-executor" },
      planner: { provider: "router", model: "actual-planner" },
      judge: { provider: "router", model: "actual-judge" },
    },
  });

  assert.equal(result.resolvedSeats.executor?.resolvedModel, "actual-executor");
  assert.equal(result.resolvedSeats.executor?.resolvedProvider, "provider-a");
  assert.equal(result.resolvedSeats.planner?.resolvedProvider, "provider-b");
  assert.equal(result.resolvedSeats.judge?.resolvedProvider, "provider-c");
  assert.deepEqual(result.usageByRole.executor, {
    calls: 1,
    promptTokens: 10,
    completionTokens: 2,
    cachedTokens: 3,
    costUsd: 0.4,
    llmTimeMs: 11,
  });
  assert.equal(result.artifactRefs.length, 2);
});

test("does not invent a resolved seat when traces contain multiple identities", () => {
  const root = mkdtempSync(resolve(tmpdir(), "modelbench-evidence-"));
  const trace = resolve(root, "turns.jsonl");
  writeFileSync(trace, ["model-a", "model-b"].map((model) => JSON.stringify({
    runId: "run-2",
    llmRequest: { model, modelTier: "executor" },
    llmResponse: { actualModel: model, actualProviderId: "provider", usage: {} },
  })).join("\n"));

  const result = collectModelBenchTraceEvidence({
    traceFiles: [trace],
    tracesRoot: root,
    requestedSeats: { executor: { provider: "provider", model: "model-a" } },
  });

  assert.equal(result.resolvedSeats.executor, undefined);
  assert.deepEqual(result.ambiguousSeats.executor, ["provider:model-a", "provider:model-b"]);
});
