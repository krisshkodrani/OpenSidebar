#!/usr/bin/env tsx

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type {
  BenchmarkAttemptV1,
  BenchmarkReportV1,
  MetricSliceV1,
} from "@opensidebar/scenario-contracts";
import { buildBenchmarkReport } from "@opensidebar/scenario-engine";

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function rows(values: Record<string, MetricSliceV1>): string[] {
  return Object.entries(values).map(
    ([name, value]) =>
      `| ${name} | ${value.passed}/${value.valid} | ${percent(value.passAt1)} | ${value.valid}/${value.requested} |`,
  );
}

function markdown(report: BenchmarkReportV1, source: string): string {
  const roleUsageRows = Object.entries(report.usageByRole).map(([role, usage]) =>
    `| ${role} | ${usage?.calls ?? 0} | ${usage?.promptTokens ?? 0} | ${usage?.completionTokens ?? 0} | ${usage?.cachedTokens ?? 0} | $${(usage?.costUsd ?? 0).toFixed(6)} | ${usage?.llmTimeMs ?? 0} |`,
  );
  return [
    "# ModelBench-100 Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Source: ${source}`,
    `Rankable: ${report.rankable ? "yes" : "no"}`,
    `Pass@1: ${report.overall.passed}/${report.overall.valid} (${percent(report.overall.passAt1)})`,
    `Coverage: ${report.overall.valid}/${report.overall.requested} (${percent(report.coverage)})`,
    `Total cost: $${report.totalCostUsd.toFixed(6)}`,
    "",
    "## By primary role",
    "",
    "| Role | Passed/valid | Pass@1 | Valid/requested |",
    "| --- | ---: | ---: | ---: |",
    ...rows(report.byRole),
    "",
    "## Usage by model seat",
    "",
    "| Seat | Calls | Prompt tokens | Completion tokens | Cached tokens | Cost | LLM time (ms) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...roleUsageRows,
    "",
    "## By application family",
    "",
    "| Family | Passed/valid | Pass@1 | Valid/requested |",
    "| --- | ---: | ---: | ---: |",
    ...rows(report.byFamily),
    "",
    "## Reliability and economics",
    "",
    `- Invalid-run rate: ${percent(report.invalidRunRate)}`,
    `- Retry rate: ${percent(report.retryRate)}`,
    `- Judge disagreement: ${percent(report.judgeDisagreementRate)}`,
    `- Median duration: ${report.medianDurationMs ?? "n/a"} ms`,
    `- p95 duration: ${report.p95DurationMs ?? "n/a"} ms`,
    `- Median LLM time: ${report.medianLlmTimeMs ?? "n/a"} ms`,
    `- p95 LLM time: ${report.p95LlmTimeMs ?? "n/a"} ms`,
    `- Turns / tool executions / perceptions: ${report.totalTurns} / ${report.totalToolExecutions} / ${report.totalPerceptions}`,
    `- Replans / recoveries: ${report.totalReplans} / ${report.totalRecoveries}`,
    `- Cost/requested task: ${report.costPerRequestedTaskUsd === null ? "n/a" : `$${report.costPerRequestedTaskUsd.toFixed(6)}`}`,
    `- Cost/successful task: ${report.costPerSuccessfulTaskUsd === null ? "n/a" : `$${report.costPerSuccessfulTaskUsd.toFixed(6)}`}`,
    "",
    "Provider, harness, validator-disagreement, and indeterminate attempts are excluded from model pass@1. Internal judge output is diagnostic; deterministic validation is authoritative.",
    "",
  ].join("\n");
}

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: pnpm modelbench:report <attempts.json> [output-directory]");
const resolvedInput = resolve(inputPath);
const parsed = JSON.parse(readFileSync(resolvedInput, "utf8")) as
  | BenchmarkAttemptV1[]
  | { attempts: BenchmarkAttemptV1[] };
const attempts = Array.isArray(parsed) ? parsed : parsed.attempts;
if (!Array.isArray(attempts)) throw new Error("Attempt input must be an array or { attempts: [] }.");
const report = buildBenchmarkReport(attempts);
const outputDirectory = resolve(
  process.argv[3] ?? dirname(resolvedInput),
);
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  resolve(outputDirectory, "summary.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
writeFileSync(
  resolve(outputDirectory, "report.md"),
  markdown(report, basename(resolvedInput)),
);
console.log(`[modelbench:report] Wrote summary.json and report.md to ${outputDirectory}`);
