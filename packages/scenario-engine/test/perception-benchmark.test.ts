import assert from "node:assert/strict";
import test from "node:test";
import type {
  PerceptionBenchmarkResultV1,
  PerceptionDiagnosis,
} from "@opensidebar/scenario-contracts";
import {
  MODEL_BENCH_PERCEPTION_CASES,
  buildPerceptionBenchmarkReport,
  classifyPerceptionResult,
  perceptionAnswerMatches,
} from "../src/index.js";

function result(
  overrides: Partial<PerceptionBenchmarkResultV1> = {},
): PerceptionBenchmarkResultV1 {
  const image = {
    schemaVersion: 1 as const,
    path: "/tmp/shot.jpg",
    sha256: "same",
    mimeType: "image/jpeg" as const,
    byteLength: 10,
    width: 1280,
    height: 800,
    detail: "high" as const,
    turnNumber: 1,
    screenshotStatus: "captured" as const,
  };
  return {
    schemaVersion: 1,
    benchmark: "modelbench-perception",
    case: MODEL_BENCH_PERCEPTION_CASES[0]!,
    capture: { passed: true, checks: [], image },
    direct: {
      requested: { provider: "openrouter", model: "vision" },
      imageSha256: "same",
      passed: true,
      answer: "Ochre",
      evidence: "The warning badge",
      durationMs: 1,
    },
    integrated: {
      attemptId: "attempt",
      classification: "valid_pass",
      passed: true,
      imagePromptObserved: true,
      screenshotCounts: { captured: 1, reused: 0 },
      imagePromptCounts: { total: 1, low: 0, high: 1, auto: 0 },
    },
    diagnosis: "valid_pass",
    ...overrides,
  };
}

test("exposes exactly ten image-backed ModelBench perception cases", () => {
  assert.equal(MODEL_BENCH_PERCEPTION_CASES.length, 10);
  for (const definition of MODEL_BENCH_PERCEPTION_CASES) {
    assert.ok(definition.visualCue.length > 10, definition.caseId);
  }
});

test("matches normalized compound visual answers deterministically", () => {
  assert.equal(perceptionAnswerMatches("Aurora — $82", "Aurora, $82"), true);
  assert.equal(
    perceptionAnswerMatches("Aurora costs $61", "Aurora, $82"),
    false,
  );
  assert.equal(perceptionAnswerMatches("Aurora — $182", "Aurora, $82"), false);
});

test("localizes failures across capture, delivery, model, and grounding", () => {
  const cases: Array<[PerceptionBenchmarkResultV1, PerceptionDiagnosis]> = [
    [
      result({ capture: { passed: false, checks: [], image: null } }),
      "capture_failure",
    ],
    [
      result({
        integrated: { ...result().integrated, imagePromptObserved: false },
      }),
      "delivery_failure",
    ],
    [
      result({
        capture: {
          ...result().capture,
          passed: false,
          checks: [
            {
              id: "executor-delivery",
              passed: false,
              detail: "No image attachment was recorded.",
            },
          ],
        },
      }),
      "delivery_failure",
    ],
    [
      result({ direct: { ...result().direct!, passed: false } }),
      "model_perception_failure",
    ],
    [
      result({
        integrated: {
          ...result().integrated,
          passed: false,
          classification: "valid_model_failure",
        },
      }),
      "grounding_action_failure",
    ],
  ];
  for (const [value, expected] of cases) {
    const { diagnosis: _diagnosis, ...unclassified } = value;
    assert.equal(classifyPerceptionResult(unclassified), expected);
  }
});

test("reports each lane separately from the diagnostic verdict", () => {
  const report = buildPerceptionBenchmarkReport(
    [
      result(),
      result({
        diagnosis: "model_perception_failure",
        direct: { ...result().direct!, passed: false },
      }),
    ],
    "2026-08-27T00:00:00.000Z",
  );
  assert.equal(report.capture.accuracy, 1);
  assert.equal(report.direct.accuracy, 0.5);
  assert.equal(report.integrated.accuracy, 1);
  assert.deepEqual(report.telemetry, {
    screenshotsCaptured: 2,
    screenshotsReused: 0,
    imagePrompts: 2,
    lowDetailImagePrompts: 0,
    highDetailImagePrompts: 2,
    autoDetailImagePrompts: 0,
  });
  assert.equal(report.byDiagnosis.model_perception_failure, 1);
  assert.equal(report.byModel["openrouter:vision"]?.direct.accuracy, 0.5);
  assert.equal(
    report.byModel["openrouter:vision"]?.telemetry.highDetailImagePrompts,
    2,
  );
});
