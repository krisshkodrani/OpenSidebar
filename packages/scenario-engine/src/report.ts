import type {
  BenchmarkAttemptV1,
  BenchmarkReportV1,
  MetricSliceV1,
} from "@opensidebar/scenario-contracts";
import { MODEL_BENCH_CASES } from "./case-catalog.js";

function percentile(values: readonly number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? null;
}

function slice(attempts: readonly BenchmarkAttemptV1[]): MetricSliceV1 {
  const firstAttempts = attempts.filter((attempt) => !attempt.retryOfAttemptId);
  const valid = firstAttempts.filter(
    (attempt) =>
      attempt.classification === "valid_pass" ||
      attempt.classification === "valid_model_failure",
  );
  const passed = valid.filter(
    (attempt) => attempt.classification === "valid_pass",
  ).length;
  return {
    requested: firstAttempts.length,
    valid: valid.length,
    passed,
    passAt1: valid.length ? passed / valid.length : null,
  };
}

function grouped(
  attempts: readonly BenchmarkAttemptV1[],
  key: (caseId: string) => string,
): Record<string, MetricSliceV1> {
  const buckets = new Map<string, BenchmarkAttemptV1[]>();
  for (const attempt of attempts) {
    const name = key(attempt.caseId);
    const target = buckets.get(name) ?? [];
    target.push(attempt);
    buckets.set(name, target);
  }
  return Object.fromEntries(
    [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, values]) => [name, slice(values)]),
  );
}

function caseFor(id: string) {
  const definition = MODEL_BENCH_CASES.find((entry) => entry.contract.id === id);
  if (!definition) throw new Error(`Attempt references unknown case: ${id}`);
  return definition.contract;
}

export function buildBenchmarkReport(
  attempts: readonly BenchmarkAttemptV1[],
  generatedAt = new Date().toISOString(),
): BenchmarkReportV1 {
  const overall = slice(attempts);
  const invalid = attempts.filter(
    (attempt) =>
      !attempt.retryOfAttemptId &&
      !["valid_pass", "valid_model_failure"].includes(attempt.classification),
  ).length;
  const retries = attempts.filter((attempt) => Boolean(attempt.retryOfAttemptId)).length;
  const disagreement = attempts.filter(
    (attempt) => attempt.classification === "validator_disagreement",
  ).length;
  const judged = attempts.filter((attempt) => attempt.validation !== null).length;
  const durations = attempts
    .filter((attempt) => !attempt.retryOfAttemptId)
    .map((attempt) => attempt.durationMs);
  const firstAttempts = attempts.filter((attempt) => !attempt.retryOfAttemptId);
  const llmTimes = firstAttempts.map((attempt) =>
    Object.values(attempt.usageByRole).reduce(
      (sum, usage) => sum + (usage?.llmTimeMs ?? 0),
      0,
    ),
  );
  const usageByRole = attempts.reduce<BenchmarkReportV1["usageByRole"]>(
    (totals, attempt) => {
      for (const [role, usage] of Object.entries(attempt.usageByRole)) {
        if (!usage) continue;
        const current = totals[role as keyof typeof totals] ?? {
          calls: 0,
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          costUsd: 0,
          llmTimeMs: 0,
        };
        totals[role as keyof typeof totals] = {
          calls: current.calls + usage.calls,
          promptTokens: current.promptTokens + usage.promptTokens,
          completionTokens: current.completionTokens + usage.completionTokens,
          cachedTokens: current.cachedTokens + usage.cachedTokens,
          costUsd: current.costUsd + usage.costUsd,
          llmTimeMs: current.llmTimeMs + usage.llmTimeMs,
        };
      }
      return totals;
    },
    {},
  );
  const totalCostUsd = attempts.reduce(
    (sum, attempt) =>
      sum +
      Object.values(attempt.usageByRole).reduce(
        (roleSum, usage) => roleSum + (usage?.costUsd ?? 0),
        0,
      ),
    0,
  );
  return {
    schemaVersion: 1,
    benchmark: "modelbench-100",
    generatedAt,
    rankable: overall.requested === 100 && overall.valid / overall.requested >= 0.98,
    coverage: overall.requested ? overall.valid / overall.requested : 0,
    overall,
    byRole: grouped(attempts, (id) => caseFor(id).primaryRole),
    byFamily: grouped(attempts, (id) => caseFor(id).capabilityTags[0] ?? "unknown"),
    byDifficulty: grouped(attempts, (id) => caseFor(id).difficulty),
    byCharacter: grouped(attempts, (id) => caseFor(id).character),
    invalidRunRate: overall.requested ? invalid / overall.requested : 0,
    retryRate: overall.requested ? retries / overall.requested : 0,
    judgeDisagreementRate: judged ? disagreement / judged : null,
    medianDurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    medianLlmTimeMs: percentile(llmTimes, 0.5),
    p95LlmTimeMs: percentile(llmTimes, 0.95),
    totalTurns: firstAttempts.reduce((sum, attempt) => sum + (attempt.telemetry?.turns ?? 0), 0),
    totalToolExecutions: firstAttempts.reduce((sum, attempt) => sum + (attempt.telemetry?.toolExecutions ?? 0), 0),
    totalPerceptions: firstAttempts.reduce((sum, attempt) => sum + (attempt.telemetry?.perceptions ?? 0), 0),
    totalReplans: firstAttempts.reduce((sum, attempt) => sum + (attempt.telemetry?.replans ?? 0), 0),
    totalRecoveries: firstAttempts.reduce((sum, attempt) => sum + (attempt.telemetry?.recoveries ?? 0), 0),
    usageByRole,
    totalCostUsd,
    costPerRequestedTaskUsd: overall.requested ? totalCostUsd / overall.requested : null,
    costPerSuccessfulTaskUsd: overall.passed ? totalCostUsd / overall.passed : null,
  };
}
