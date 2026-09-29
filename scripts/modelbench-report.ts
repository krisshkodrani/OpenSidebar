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
    `Recorded model cost (not an invoice total): $${report.totalCostUsd.toFixed(6)}`,
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
    ...(report.unattributedUsage?.calls
      ? [`| Unattributed | ${report.unattributedUsage.calls} | ${report.unattributedUsage.promptTokens} | ${report.unattributedUsage.completionTokens} | ${report.unattributedUsage.cachedTokens} | $${report.unattributedUsage.costUsd.toFixed(6)} | ${report.unattributedUsage.llmTimeMs} |`]
      : []),
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function html(report: BenchmarkReportV1, source: string): string {
  const sliceRows = (slices: Record<string, MetricSliceV1>) =>
    Object.entries(slices).map(([name, slice]) =>
      `<tr><th scope="row">${escapeHtml(name)}</th><td>${slice.passed}/${slice.valid}</td><td>${percent(slice.passAt1)}</td><td>${slice.valid}/${slice.requested}</td></tr>`,
    ).join("");
  const usageRows = Object.entries(report.usageByRole).map(([role, usage]) =>
    `<tr><th scope="row">${escapeHtml(role)}</th><td>${usage?.calls ?? 0}</td><td>${(usage?.promptTokens ?? 0).toLocaleString()}</td><td>${(usage?.completionTokens ?? 0).toLocaleString()}</td><td>$${(usage?.costUsd ?? 0).toFixed(6)}</td></tr>`,
  ).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ModelBench · ${escapeHtml(source)}</title>
<style>
:root{font-family:Inter,system-ui,sans-serif;color:#182925;background:#F5F8F4;color-scheme:light dark}
*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:clamp(20px,4vw,56px)}
header{display:flex;justify-content:space-between;align-items:start;gap:20px;border-bottom:1px solid #D9E4DE;padding-bottom:24px}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:11px;font-weight:750;color:#126B64}h1{font-size:clamp(30px,4vw,48px);letter-spacing:-.04em;margin:8px 0}h2{font-size:20px;letter-spacing:-.025em}p{color:#586A62;line-height:1.5}
.badge{border:1px solid #D9E4DE;border-radius:999px;padding:7px 12px;font-size:12px;white-space:nowrap;background:white}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:28px 0}.card,section{background:white;border:1px solid #D9E4DE;border-radius:12px;padding:20px}.card strong{display:block;font-size:28px;letter-spacing:-.04em;margin-top:10px}.card span{font-size:12px;color:#586A62}section{margin:16px 0;overflow:auto}table{width:100%;border-collapse:collapse;min-width:530px}th,td{text-align:right;padding:12px;border-bottom:1px solid #D9E4DE;font-size:13px}th:first-child,td:first-child{text-align:left}thead th{color:#586A62;font-size:11px;text-transform:uppercase;letter-spacing:.07em}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}.note{border-left:4px solid #A5C842;padding:4px 18px;margin:24px 0}
@media(prefers-color-scheme:dark){:root{color:#EAF4EC;background:#101B18}p,.card span{color:#B5C9BD}.eyebrow{color:#72C6B6}.badge,.card,section{background:#172621;border-color:#344D40}header,th,td{border-color:#344D40}thead th{color:#B5C9BD}}
</style></head><body><main><header><div><div class="eyebrow">OpenSidebar / ModelBench</div><h1>Benchmark evidence</h1><p>${escapeHtml(source)} · Generated ${escapeHtml(report.generatedAt)}</p></div><span class="badge">${report.rankable ? "Rankable" : "Not rankable"}</span></header>
<div class="grid"><div class="card"><span>Pass@1 on valid runs</span><strong>${percent(report.overall.passAt1)}</strong><span>${report.overall.passed} / ${report.overall.valid}</span></div><div class="card"><span>Coverage</span><strong>${percent(report.coverage)}</strong><span>${report.overall.valid} / ${report.overall.requested} requested</span></div><div class="card"><span>Recorded model cost</span><strong>$${report.totalCostUsd.toFixed(4)}</strong><span>Not an invoice total</span></div><div class="card"><span>Invalid run rate</span><strong>${percent(report.invalidRunRate)}</strong><span>Excluded from model pass@1</span></div></div>
<section><h2>By primary role</h2><table><thead><tr><th>Role</th><th>Passed / valid</th><th>Pass@1</th><th>Valid / requested</th></tr></thead><tbody>${sliceRows(report.byRole)}</tbody></table></section>
<section><h2>By application family</h2><table><thead><tr><th>Family</th><th>Passed / valid</th><th>Pass@1</th><th>Valid / requested</th></tr></thead><tbody>${sliceRows(report.byFamily)}</tbody></table></section>
<section><h2>Usage by model seat</h2><table><thead><tr><th>Seat</th><th>Calls</th><th>Prompt tokens</th><th>Completion tokens</th><th>Recorded cost</th></tr></thead><tbody>${usageRows}</tbody></table></section>
<p class="note">Provider, harness, validator disagreement, and indeterminate attempts are excluded from model pass@1. Deterministic validation is authoritative.</p></main></body></html>\n`;
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
writeFileSync(resolve(outputDirectory, "report.html"), html(report, basename(resolvedInput)));
console.log(`[modelbench:report] Wrote summary.json, report.md, and report.html to ${outputDirectory}`);
