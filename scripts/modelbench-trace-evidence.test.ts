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
  assert.equal(result.telemetry.turns, 1);
  assert.equal(result.telemetry.replans, 0);
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

test("attributes a successful pinned OpenRouter call to its enforced upstream", () => {
  const root = mkdtempSync(resolve(tmpdir(), "modelbench-evidence-"));
  const trace = resolve(root, "turns.jsonl");
  writeFileSync(trace, `${JSON.stringify({
    runId: "run-pinned",
    llmRequest: { model: "openai/gpt-5.6-luna", modelTier: "executor" },
    llmResponse: {
      actualModel: "openai/gpt-5.6-luna",
      actualProviderId: "openrouter",
      usage: { prompt_tokens: 1 },
    },
  })}\n`);

  const result = collectModelBenchTraceEvidence({
    traceFiles: [trace],
    tracesRoot: root,
    requestedSeats: {
      executor: {
        provider: "openrouter",
        providerPin: "openai",
        model: "openai/gpt-5.6-luna",
      },
    },
  });

  assert.equal(result.resolvedSeats.executor?.resolvedProvider, "openai");
});

test("records the exact screenshot artifact and image-detail telemetry", () => {
  const root = mkdtempSync(resolve(tmpdir(), "modelbench-evidence-"));
  mkdirSync(resolve(root, "runs"));
  mkdirSync(resolve(root, "screenshots"));
  const trace = resolve(root, "session-visual.jsonl");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKUlEQVR4nO3OIQEAAAACIP+f1hkWWEB6FgEBAQEBAQEBAQEBAQEBgXdgl/rw4unIZ5cAAAAASUVORK5CYII=",
    "base64",
  );
  writeFileSync(resolve(root, "screenshots", "session-visual-T1.jpg"), png);
  writeFileSync(trace, `${JSON.stringify({
    sessionId: "session-visual",
    turnNumber: 1,
    snapshot: { url: "http://127.0.0.1/scenario-target.html" },
    elements: [{ tagName: "canvas" }],
    llmRequest: {
      model: "vision",
      modelTier: "executor",
      contextMetrics: {
        promptSections: {
          imagePromptCount: 1,
          highDetailImagePromptCount: 1,
          lowDetailImagePromptCount: 0,
          autoDetailImagePromptCount: 0,
        },
      },
    },
    llmResponse: {
      actualModel: "vision",
      actualProviderId: "provider",
      usage: {},
    },
    perception: { screenshotStatus: "captured" },
  })}\n`);

  const result = collectModelBenchTraceEvidence({
    traceFiles: [trace],
    tracesRoot: root,
    requestedSeats: {
      executor: { provider: "provider", model: "vision" },
    },
  });

  assert.equal(result.imageArtifacts.length, 1);
  assert.equal(result.imageArtifacts[0]?.width, 32);
  assert.equal(result.imageArtifacts[0]?.mimeType, "image/png");
  assert.equal(result.imageArtifacts[0]?.detail, "high");
  assert.equal(result.telemetry.screenshotsCaptured, 1);
  assert.equal(result.telemetry.imagePrompts, 1);
  assert.equal(result.telemetry.highDetailImagePrompts, 1);
  assert.equal(result.canvasObserved, true);
  assert.deepEqual(result.pageUrls, ["http://127.0.0.1/scenario-target.html"]);
});

test("collects page coordinator rollout and stale-action telemetry", () => {
  const root = mkdtempSync(resolve(tmpdir(), "modelbench-evidence-"));
  const trace = resolve(root, "session-coordinator.jsonl");
  writeFileSync(
    trace,
    `${JSON.stringify({
      events: [
        {
          type: "page_observation",
          data: { coordinatorMode: "authoritative", consistency: "consistent" },
        },
        {
          type: "page_observation",
          data: { coordinatorMode: "authoritative", consistency: "inconsistent" },
        },
        { type: "page_observation_consistency_retry", data: {} },
        { type: "page_observation_shadow_mismatch", data: {} },
        { type: "action_receipt", data: { status: "stale" } },
        { type: "stale_action_blocked", data: {} },
      ],
    })}\n`,
  );

  const result = collectModelBenchTraceEvidence({
    traceFiles: [trace],
    tracesRoot: root,
    requestedSeats: {},
  });

  assert.equal(result.telemetry.pageStateCoordinatorMode, "authoritative");
  assert.equal(result.telemetry.pageObservations, 2);
  assert.equal(result.telemetry.consistentPageObservations, 1);
  assert.equal(result.telemetry.inconsistentPageObservations, 1);
  assert.equal(result.telemetry.coordinatorConsistencyRetries, 1);
  assert.equal(result.telemetry.coordinatorShadowMismatches, 1);
  assert.equal(result.telemetry.actionReceipts, 1);
  assert.equal(result.telemetry.staleActionsBlocked, 1);
});
