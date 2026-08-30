import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import type {
  BenchmarkAttemptV1,
  PerceptionImageArtifactV1,
} from "@opensidebar/scenario-contracts";
import { MODEL_BENCH_PERCEPTION_CASES } from "@opensidebar/scenario-engine";
import { inspectPerceptionImage } from "./modelbench-image-artifacts.js";
import {
  buildPerceptionResult,
  captureIntegrityForAttempt,
} from "./modelbench-perception-lib.js";

function artifact(): PerceptionImageArtifactV1 {
  const root = mkdtempSync(resolve(tmpdir(), "modelbench-perception-capture-"));
  const path = resolve(root, "shot.png");
  writeFileSync(
    path,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKUlEQVR4nO3OIQEAAAACIP+f1hkWWEB6FgEBAQEBAQEBAQEBAQEBgXdgl/rw4unIZ5cAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  return inspectPerceptionImage({
    path,
    detail: "high",
    turnNumber: 1,
    screenshotStatus: "captured",
  });
}

function attempt(image: PerceptionImageArtifactV1): BenchmarkAttemptV1 {
  return {
    schemaVersion: 1,
    attemptId: "attempt-1",
    caseId: MODEL_BENCH_PERCEPTION_CASES[0]!.caseId,
    caseVersion: 1,
    caseContentHash: "case-hash",
    buildRevision: "revision",
    startedAt: "2026-08-27T00:00:00.000Z",
    durationMs: 10,
    configurationLabel: "vision-model",
    classification: "valid_pass",
    scoreEligible: true,
    requestedSeats: {
      executor: { provider: "openrouter", model: "vision" },
    },
    resolvedSeats: {
      executor: {
        provider: "openrouter",
        model: "vision",
        resolvedProvider: "openai",
        resolvedModel: "vision",
      },
    },
    usageByRole: {},
    telemetry: {
      turns: 1,
      toolExecutions: 1,
      perceptions: 1,
      replans: 0,
      recoveries: 0,
      screenshotsCaptured: 1,
      imagePrompts: 1,
      highDetailImagePrompts: 1,
    },
    validation: null,
    diagnostics: {
      pageUrls: ["http://127.0.0.1/scenario-target.html"],
      canvasObserved: true,
      imageArtifacts: [image],
    },
    artifactRefs: [image.path],
  };
}

test("capture lane verifies the exact integrated screenshot artifact", () => {
  const image = artifact();
  const capture = captureIntegrityForAttempt(attempt(image));
  assert.equal(capture.passed, true);
  assert.equal(capture.image?.sha256, image.sha256);
  assert.deepEqual(
    capture.checks.map((check) => check.id),
    [
      "target-page",
      "visual-surface",
      "screenshot-recorded",
      "screenshot-hash",
      "production-profile",
      "executor-delivery",
      "detail-recorded",
    ],
  );
});

test("capture lane prefers a high-detail screenshot over a later low-detail screenshot", () => {
  const highDetail = artifact();
  const lowDetail = {
    ...highDetail,
    detail: "low" as const,
    turnNumber: 3,
  };
  const integratedAttempt = attempt(highDetail);
  integratedAttempt.diagnostics = {
    ...integratedAttempt.diagnostics,
    imageArtifacts: [highDetail, lowDetail],
  };

  const capture = captureIntegrityForAttempt(integratedAttempt);

  assert.equal(capture.image?.detail, "high");
  assert.equal(capture.image?.turnNumber, 1);
});

test("same-image direct pass plus integrated failure localizes grounding", () => {
  const image = artifact();
  const integratedAttempt = attempt(image);
  integratedAttempt.classification = "valid_model_failure";
  const capture = captureIntegrityForAttempt(integratedAttempt);
  const result = buildPerceptionResult({
    case: MODEL_BENCH_PERCEPTION_CASES[0]!,
    attempt: integratedAttempt,
    capture,
    direct: {
      requested: { provider: "openrouter", model: "vision" },
      imageSha256: image.sha256,
      passed: true,
      answer: "Ochre",
      evidence: "warning badge",
      durationMs: 2,
    },
  });
  assert.equal(result.diagnosis, "grounding_action_failure");
});
