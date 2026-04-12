/**
 * Trace Sampler — extracts failure patterns from traces and writes
 * a knowledge-base entry to lab/knowledge/trace-analysis-{date}.md
 *
 * Usage:
 *   npx tsx lab/trace-sampler.ts [--days N] [--limit N]
 *
 * Options:
 *   --days N   Look back N days (default: 7)
 *   --limit N  Max traces to sample (default: 200)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const TRACES_INDEX = join(PROJECT_ROOT, "traces", "index.jsonl");
const KNOWLEDGE_DIR = join(PROJECT_ROOT, "lab", "knowledge");

interface TraceEntry {
  recordedAt: string;
  runId: string;
  query: string;
  startUrl: string;
  outcome: string;
  failureCategory: string;
  failureCode: string;
  failureDetail?: string;
  turnCount: number;
  summary: string;
  metrics: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalLlmTimeMs: number;
    totalSessionTimeMs: number;
    llmCallCount: number;
    modelBreakdown: Record<
      string,
      { promptTokens: number; completionTokens: number; calls: number }
    >;
  };
  workspaceId: string;
}

// Parse CLI args
const args = process.argv.slice(2);
const daysBack = parseInt(
  args[args.indexOf("--days") + 1] || "7",
  10
);
const limit = parseInt(
  args[args.indexOf("--limit") + 1] || "200",
  10
);

// Read trace index
if (!existsSync(TRACES_INDEX)) {
  console.error("No traces/index.jsonl found");
  process.exit(1);
}

const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
const raw = readFileSync(TRACES_INDEX, "utf-8");
const lines = raw.trim().split("\n");

const traces: TraceEntry[] = [];
for (const line of lines) {
  try {
    const entry = JSON.parse(line) as TraceEntry;
    if (new Date(entry.recordedAt).getTime() >= cutoff) {
      traces.push(entry);
    }
  } catch {
    // skip malformed lines
  }
}

// Take most recent N
const sampled = traces.slice(-limit);

console.log(
  `Sampled ${sampled.length} traces from last ${daysBack} days (total in window: ${traces.length})`
);

// Aggregate stats
const outcomes: Record<string, number> = {};
const failureCategories: Record<string, number> = {};
const failureCodes: Record<string, number> = {};
const failureDetails: { code: string; detail: string; url: string; turns: number; runId: string }[] = [];

let totalTurns = 0;
let totalTokens = 0;
let totalTimeMs = 0;
let completedCount = 0;

for (const t of sampled) {
  outcomes[t.outcome] = (outcomes[t.outcome] || 0) + 1;
  totalTurns += t.turnCount;
  totalTokens += t.metrics?.totalTokens || 0;
  totalTimeMs += t.metrics?.totalSessionTimeMs || 0;

  if (t.outcome === "completed") {
    completedCount++;
  }

  if (t.failureCategory && t.failureCategory !== "none") {
    failureCategories[t.failureCategory] =
      (failureCategories[t.failureCategory] || 0) + 1;
  }

  if (t.failureCode && t.failureCode !== "none") {
    failureCodes[t.failureCode] = (failureCodes[t.failureCode] || 0) + 1;
    failureDetails.push({
      code: t.failureCode,
      detail: t.failureDetail || t.summary || "",
      url: t.startUrl,
      turns: t.turnCount,
      runId: t.runId,
    });
  }
}

// Model usage breakdown
const modelUsage: Record<string, { tokens: number; calls: number }> = {};
for (const t of sampled) {
  if (t.metrics?.modelBreakdown) {
    for (const [model, stats] of Object.entries(t.metrics.modelBreakdown)) {
      if (!modelUsage[model]) modelUsage[model] = { tokens: 0, calls: 0 };
      modelUsage[model].tokens +=
        stats.promptTokens + stats.completionTokens;
      modelUsage[model].calls += stats.calls;
    }
  }
}

// Group failure details by code, pick top 3 examples per code
const failureExamples: Record<string, typeof failureDetails> = {};
for (const fd of failureDetails) {
  if (!failureExamples[fd.code]) failureExamples[fd.code] = [];
  if (failureExamples[fd.code].length < 3) {
    failureExamples[fd.code].push(fd);
  }
}

// Generate report
const date = new Date().toISOString().split("T")[0];
const passRate =
  sampled.length > 0
    ? ((completedCount / sampled.length) * 100).toFixed(1)
    : "N/A";
const avgTurns =
  sampled.length > 0 ? (totalTurns / sampled.length).toFixed(1) : "N/A";
const avgTokens =
  sampled.length > 0
    ? Math.round(totalTokens / sampled.length).toLocaleString()
    : "N/A";
const avgTimeS =
  sampled.length > 0 ? (totalTimeMs / sampled.length / 1000).toFixed(1) : "N/A";

let md = `# Trace Analysis -- ${date}

Automated analysis of ${sampled.length} traces from the last ${daysBack} days.

## Summary

| Metric | Value |
|--------|-------|
| Traces sampled | ${sampled.length} |
| Pass rate | ${passRate}% (${completedCount}/${sampled.length}) |
| Avg turns | ${avgTurns} |
| Avg tokens | ${avgTokens} |
| Avg session time | ${avgTimeS}s |

## Outcomes

| Outcome | Count | % |
|---------|-------|---|
`;

for (const [outcome, count] of Object.entries(outcomes).sort(
  (a, b) => b[1] - a[1]
)) {
  const pct = ((count / sampled.length) * 100).toFixed(1);
  md += `| ${outcome} | ${count} | ${pct}% |\n`;
}

if (Object.keys(failureCategories).length > 0) {
  md += `\n## Failure Categories\n\n| Category | Count |\n|----------|-------|\n`;
  for (const [cat, count] of Object.entries(failureCategories).sort(
    (a, b) => b[1] - a[1]
  )) {
    md += `| ${cat} | ${count} |\n`;
  }
}

if (Object.keys(failureCodes).length > 0) {
  md += `\n## Failure Codes\n\n| Code | Count |\n|------|-------|\n`;
  for (const [code, count] of Object.entries(failureCodes).sort(
    (a, b) => b[1] - a[1]
  )) {
    md += `| ${code} | ${count} |\n`;
  }

  md += `\n## Failure Examples\n\n`;
  for (const [code, examples] of Object.entries(failureExamples)) {
    md += `### ${code} (${failureCodes[code]} occurrences)\n\n`;
    for (const ex of examples) {
      const detailShort =
        ex.detail.length > 200 ? ex.detail.slice(0, 200) + "..." : ex.detail;
      md += `- **${ex.url}** (${ex.turns} turns, run: \`${ex.runId.slice(0, 8)}\`)\n  ${detailShort}\n\n`;
    }
  }
}

if (Object.keys(modelUsage).length > 0) {
  md += `## Model Usage\n\n| Model | Tokens | Calls |\n|-------|--------|-------|\n`;
  for (const [model, stats] of Object.entries(modelUsage).sort(
    (a, b) => b[1].tokens - a[1].tokens
  )) {
    md += `| ${model} | ${stats.tokens.toLocaleString()} | ${stats.calls} |\n`;
  }
}

md += `\n---\n*Generated by lab/trace-sampler.ts on ${date}*\n`;

// Write output
const outPath = join(KNOWLEDGE_DIR, `trace-analysis-${date}.md`);
writeFileSync(outPath, md);
console.log(`\nReport written to: ${outPath}`);
console.log(`Pass rate: ${passRate}% | Avg turns: ${avgTurns} | Avg tokens: ${avgTokens}`);
