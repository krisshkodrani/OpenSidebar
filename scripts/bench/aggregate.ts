/**
 * Score aggregation for the public benchmark adapter (RFC LP-1).
 *
 * Turns per-task results (run evidence + judge verdict) into a headline score
 * with the honest-aggregates discipline: skipped tasks are excluded from the
 * pass-rate denominator and reported separately; uncertain verdicts count as
 * non-successes (they never inflate the score). Pure and unit-tested.
 */

import type {
  BenchAggregate,
  BenchDifficulty,
  BenchTaskResult,
} from "./types";

const DIFFICULTIES: readonly BenchDifficulty[] = ["easy", "medium", "hard"];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Aggregate scored task results into a headline score. */
export function aggregateResults(results: BenchTaskResult[]): BenchAggregate {
  const byLevel: BenchAggregate["byLevel"] = {
    easy: { total: 0, successes: 0, passRate: 0 },
    medium: { total: 0, successes: 0, passRate: 0 },
    hard: { total: 0, successes: 0, passRate: 0 },
  };

  let skipped = 0;
  let successes = 0;
  let failures = 0;
  let uncertain = 0;
  let costTotal = 0;
  let sawCost = false;
  const scoredTurns: number[] = [];

  for (const result of results) {
    if (result.evidence.completionStatus === "skipped") {
      skipped += 1;
      continue;
    }

    const level = result.evidence.task.level;
    byLevel[level].total += 1;
    scoredTurns.push(result.evidence.turns);
    if (typeof result.evidence.costUsd === "number") {
      costTotal += result.evidence.costUsd;
      sawCost = true;
    }

    const outcome = result.verdict?.outcome ?? "uncertain";
    if (outcome === "success") {
      successes += 1;
      byLevel[level].successes += 1;
    } else if (outcome === "failure") {
      failures += 1;
    } else {
      uncertain += 1;
    }
  }

  for (const level of DIFFICULTIES) {
    const band = byLevel[level];
    band.passRate = band.total > 0 ? band.successes / band.total : 0;
  }

  const scored = successes + failures + uncertain;
  return {
    total: results.length,
    scored,
    skipped,
    successes,
    failures,
    uncertain,
    passRate: scored > 0 ? successes / scored : 0,
    byLevel,
    totalCostUsd: sawCost ? Number(costTotal.toFixed(4)) : null,
    medianTurns: median(scoredTurns),
  };
}

/** Render a Markdown report of the sweep, honest-aggregates style. */
export function formatBenchReport(
  aggregate: BenchAggregate,
  meta: {
    source: string;
    revision: string;
    modelConfigLabel: string;
    judgeModel: string;
    date: string;
    manualDisagreementRate?: number | null;
  },
): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`# Benchmark sweep — ${meta.source}`);
  lines.push("");
  lines.push(`- **Date:** ${meta.date}`);
  lines.push(`- **Dataset revision:** \`${meta.revision}\``);
  lines.push(`- **Model config:** ${meta.modelConfigLabel}`);
  lines.push(`- **Judge model:** ${meta.judgeModel} (WebJudge auto-eval)`);
  lines.push("");
  lines.push(
    `## Score: ${pct(aggregate.passRate)} (${aggregate.successes}/${aggregate.scored} scored)`,
  );
  lines.push("");
  lines.push(`- Scored tasks: ${aggregate.scored}`);
  lines.push(
    `- Skipped (write-mutating / out-of-scope, excluded from rate): ${aggregate.skipped}`,
  );
  lines.push(`- Successes: ${aggregate.successes}`);
  lines.push(`- Failures: ${aggregate.failures}`);
  lines.push(`- Uncertain (judge could not decide; counted as non-success): ${aggregate.uncertain}`);
  lines.push(`- Median turns: ${aggregate.medianTurns}`);
  if (aggregate.totalCostUsd != null) {
    lines.push(`- Total cost: $${aggregate.totalCostUsd.toFixed(2)}`);
    if (aggregate.scored > 0) {
      lines.push(
        `- Cost per scored task: $${(aggregate.totalCostUsd / aggregate.scored).toFixed(3)}`,
      );
    }
  }
  if (
    meta.manualDisagreementRate != null &&
    Number.isFinite(meta.manualDisagreementRate)
  ) {
    lines.push(
      `- Judge/manual disagreement (20% sample): ${pct(meta.manualDisagreementRate)}`,
    );
  } else {
    lines.push(
      `- Judge/manual disagreement (20% sample): not yet measured — required before publishing this number`,
    );
  }
  lines.push("");
  lines.push("## By difficulty");
  lines.push("");
  lines.push("| Level | Successes | Total | Pass rate |");
  lines.push("| --- | --- | --- | --- |");
  for (const level of DIFFICULTIES) {
    const band = aggregate.byLevel[level];
    lines.push(
      `| ${level} | ${band.successes} | ${band.total} | ${pct(band.passRate)} |`,
    );
  }
  lines.push("");
  if (aggregate.scored < 100) {
    lines.push(
      `> Sample size is ${aggregate.scored} scored tasks. Treat as indicative, not a published headline, until a full ≥100-task sweep with the manual disagreement check is complete.`,
    );
  }
  return `${lines.join("\n")}\n`;
}
