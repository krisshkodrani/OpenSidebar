import type {
  BenchmarkAttemptV1,
  JsonObject,
  JsonValue,
  PerceptionBenchmarkCaseV1,
  PerceptionBenchmarkReportV1,
  PerceptionBenchmarkResultV1,
  PerceptionDiagnosis,
  PerceptionMetricSliceV1,
  PerceptionModelReportV1,
} from "@opensidebar/scenario-contracts";
import { MODEL_BENCH_CASES } from "./case-catalog.js";

function object(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export const MODEL_BENCH_PERCEPTION_CASES: readonly PerceptionBenchmarkCaseV1[] =
  MODEL_BENCH_CASES.filter(
    (definition) => definition.contract.primaryRole === "perception",
  ).map((definition) => {
    const presentation = object(object(definition.control.public).presentation);
    return {
      schemaVersion: 1,
      caseId: definition.contract.id,
      caseVersion: definition.contract.version,
      title: definition.contract.title,
      prompt: definition.contract.prompt,
      expected: object(definition.control.control).expected ?? null,
      visualCue: String(presentation.visualCue ?? ""),
    };
  });

export function checkPerceptionBenchmarkCases(
  cases = MODEL_BENCH_PERCEPTION_CASES,
): string[] {
  const errors: string[] = [];
  if (cases.length !== 10) {
    errors.push(
      `perception benchmark: expected 10 cases, received ${cases.length}`,
    );
  }
  const ids = new Set<string>();
  for (const definition of cases) {
    if (ids.has(definition.caseId)) {
      errors.push(`perception benchmark: duplicate case ${definition.caseId}`);
    }
    ids.add(definition.caseId);
    if (!definition.visualCue.trim()) {
      errors.push(`${definition.caseId}: visual cue is required`);
    }
    if (definition.expected === undefined || definition.expected === null) {
      errors.push(
        `${definition.caseId}: deterministic expected answer is required`,
      );
    }
  }
  return errors;
}

export function normalizePerceptionAnswer(value: JsonValue | string): string {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9#%$]+/g, " ")
    .trim();
}

export function perceptionAnswerMatches(
  answer: string | null | undefined,
  expected: JsonValue,
): boolean {
  if (!answer?.trim()) return false;
  const answerTerms = new Set(
    normalizePerceptionAnswer(answer).split(" ").filter(Boolean),
  );
  const expectedTerms = normalizePerceptionAnswer(expected)
    .split(" ")
    .filter(Boolean);
  return (
    expectedTerms.length > 0 &&
    expectedTerms.every((term) => answerTerms.has(term))
  );
}

export function classifyPerceptionResult(
  result: Omit<PerceptionBenchmarkResultV1, "diagnosis">,
): PerceptionDiagnosis {
  if (!result.capture.image) return "capture_failure";
  const captureChecks = result.capture.checks.filter(
    (check) => check.id !== "executor-delivery",
  );
  if (captureChecks.some((check) => !check.passed)) return "capture_failure";
  if (result.integrated.classification === "provider_failure") {
    return "provider_failure";
  }
  if (result.direct?.failure?.kind === "provider") return "provider_failure";
  if (result.integrated.classification === "validator_disagreement") {
    return "validator_disagreement";
  }
  const executorDelivery = result.capture.checks.find(
    (check) => check.id === "executor-delivery",
  );
  if (executorDelivery?.passed === false) return "delivery_failure";
  if (!result.integrated.imagePromptObserved) return "delivery_failure";
  if (result.direct?.failure?.kind === "delivery") return "delivery_failure";
  if (!result.direct) return "indeterminate";
  if (result.direct.imageSha256 !== result.capture.image.sha256) {
    return "delivery_failure";
  }
  if (!result.direct.passed) return "model_perception_failure";
  if (result.integrated.classification === "harness_failure") {
    return "delivery_failure";
  }
  if (!result.integrated.passed) return "grounding_action_failure";
  return "valid_pass";
}

function metric(
  results: readonly PerceptionBenchmarkResultV1[],
  passed: (result: PerceptionBenchmarkResultV1) => boolean,
  attempted: (result: PerceptionBenchmarkResultV1) => boolean = () => true,
): PerceptionMetricSliceV1 {
  const selected = results.filter(attempted);
  const passedCount = selected.filter(passed).length;
  return {
    attempted: selected.length,
    passed: passedCount,
    accuracy: selected.length ? passedCount / selected.length : null,
  };
}

export function buildPerceptionBenchmarkReport(
  results: readonly PerceptionBenchmarkResultV1[],
  generatedAt = new Date().toISOString(),
): PerceptionBenchmarkReportV1 {
  const diagnoses: PerceptionDiagnosis[] = [
    "valid_pass",
    "capture_failure",
    "delivery_failure",
    "model_perception_failure",
    "grounding_action_failure",
    "provider_failure",
    "validator_disagreement",
    "indeterminate",
  ];
  const summary = (
    selected: readonly PerceptionBenchmarkResultV1[],
  ): PerceptionModelReportV1 => ({
    capture: metric(selected, (result) => result.capture.passed),
    direct: metric(
      selected,
      (result) => result.direct?.passed === true,
      (result) => result.direct !== null,
    ),
    integrated: metric(selected, (result) => result.integrated.passed),
    telemetry: selected.reduce(
      (total, result) => ({
        screenshotsCaptured:
          total.screenshotsCaptured +
          result.integrated.screenshotCounts.captured,
        screenshotsReused:
          total.screenshotsReused + result.integrated.screenshotCounts.reused,
        imagePrompts:
          total.imagePrompts + result.integrated.imagePromptCounts.total,
        lowDetailImagePrompts:
          total.lowDetailImagePrompts + result.integrated.imagePromptCounts.low,
        highDetailImagePrompts:
          total.highDetailImagePrompts +
          result.integrated.imagePromptCounts.high,
        autoDetailImagePrompts:
          total.autoDetailImagePrompts +
          result.integrated.imagePromptCounts.auto,
      }),
      {
        screenshotsCaptured: 0,
        screenshotsReused: 0,
        imagePrompts: 0,
        lowDetailImagePrompts: 0,
        highDetailImagePrompts: 0,
        autoDetailImagePrompts: 0,
      },
    ),
    byDiagnosis: Object.fromEntries(
      diagnoses.map((diagnosis) => [
        diagnosis,
        selected.filter((result) => result.diagnosis === diagnosis).length,
      ]),
    ) as Record<PerceptionDiagnosis, number>,
  });
  const byModel = new Map<string, PerceptionBenchmarkResultV1[]>();
  for (const result of results) {
    const seat =
      result.direct?.resolved ??
      result.integrated.resolvedExecutor ??
      result.direct?.requested;
    const key = seat
      ? `${"resolvedProvider" in seat ? seat.resolvedProvider : seat.provider}:${"resolvedModel" in seat ? seat.resolvedModel : seat.model}`
      : "unresolved";
    const bucket = byModel.get(key) ?? [];
    bucket.push(result);
    byModel.set(key, bucket);
  }
  const overall = summary(results);
  return {
    schemaVersion: 1,
    benchmark: "modelbench-perception",
    generatedAt,
    cases: new Set(results.map((result) => result.case.caseId)).size,
    attempts: results.length,
    ...overall,
    byModel: Object.fromEntries(
      [...byModel.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([model, selected]) => [model, summary(selected)]),
    ),
    results,
  };
}

export function integratedPerceptionResult(
  attempt: BenchmarkAttemptV1,
): PerceptionBenchmarkResultV1["integrated"] {
  const telemetry = attempt.telemetry;
  const total = telemetry?.imagePrompts ?? telemetry?.perceptions ?? 0;
  return {
    attemptId: attempt.attemptId,
    classification: attempt.classification,
    passed: attempt.classification === "valid_pass",
    imagePromptObserved: total > 0,
    screenshotCounts: {
      captured: telemetry?.screenshotsCaptured ?? 0,
      reused: telemetry?.screenshotsReused ?? 0,
    },
    imagePromptCounts: {
      total,
      low: telemetry?.lowDetailImagePrompts ?? 0,
      high: telemetry?.highDetailImagePrompts ?? 0,
      auto: telemetry?.autoDetailImagePrompts ?? 0,
    },
    ...(attempt.resolvedSeats.executor
      ? { resolvedExecutor: attempt.resolvedSeats.executor }
      : {}),
  };
}
