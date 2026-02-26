/**
 * Context compression eval markdown report generator.
 *
 * Sections: Summary, Per-Level Breakdown, Per-Dimension Breakdown,
 * Token Efficiency, Failed Cases, Recommendations.
 */

import type { ContextEvalCase, ContextEvalResult } from "./types";

export interface ContextCritiqueData {
  cases: ContextEvalCase[];
  results: ContextEvalResult[];
}

export function buildContextReport(data: ContextCritiqueData): string {
  const { cases, results } = data;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const sections: string[] = [];

  sections.push("# Context Compression Eval Report\n");
  sections.push(`Generated: ${new Date().toISOString()}\n`);

  sections.push(buildSummary(results));
  sections.push(buildLevelBreakdown(results));
  sections.push(buildDimensionBreakdown(results, caseById));
  sections.push(buildTokenEfficiency(results));
  sections.push(buildFailedCases(results, caseById));
  sections.push(buildRecommendations(results, caseById));

  return sections.join("\n");
}

// ── Sections ─────────────────────────────────────────────────────────

function buildSummary(results: ContextEvalResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const avgGoal = avg(results.map((r) => r.scores.goalPreservation));
  const avgPlan = avg(results.map((r) => r.scores.planPreservation));
  const avgTool = avg(results.map((r) => r.scores.toolResultPreservation));
  const avgFact = avg(results.map((r) => r.scores.keyFactPreservation));
  const avgEff = avg(results.map((r) => r.scores.tokenEfficiency));
  const avgComp = avg(results.map((r) => r.scores.composite));

  const minGoal = min(results.map((r) => r.scores.goalPreservation));
  const minPlan = min(results.map((r) => r.scores.planPreservation));
  const minTool = min(results.map((r) => r.scores.toolResultPreservation));
  const minFact = min(results.map((r) => r.scores.keyFactPreservation));
  const minEff = min(results.map((r) => r.scores.tokenEfficiency));
  const minComp = min(results.map((r) => r.scores.composite));

  return `## Summary

| Metric | Avg | Min (worst) |
|--------|-----|-------------|
| Total results | ${total} | — |
| Pass rate | ${passRate}% (${passed}/${total}) | — |
| Failed | ${failed} | — |
| Errors | ${errored} | — |
| Goal preservation | ${avgGoal.toFixed(3)} | ${minGoal.toFixed(3)} |
| Plan preservation | ${avgPlan.toFixed(3)} | ${minPlan.toFixed(3)} |
| Tool result preservation | ${avgTool.toFixed(3)} | ${minTool.toFixed(3)} |
| Key fact preservation | ${avgFact.toFixed(3)} | ${minFact.toFixed(3)} |
| Token efficiency | ${avgEff.toFixed(3)} | ${minEff.toFixed(3)} |
| Composite | ${avgComp.toFixed(3)} | ${minComp.toFixed(3)} |
`;
}

function buildLevelBreakdown(results: ContextEvalResult[]): string {
  const byLevel = new Map<
    string,
    { total: number; pass: number; avgReduction: number; avgComposite: number }
  >();

  for (const r of results) {
    const level = r.compressionLevel;
    if (!byLevel.has(level)) {
      byLevel.set(level, { total: 0, pass: 0, avgReduction: 0, avgComposite: 0 });
    }
    const rec = byLevel.get(level)!;
    rec.total++;
    if (r.status === "pass") rec.pass++;
    rec.avgReduction += r.actual.reductionPercent;
    rec.avgComposite += r.scores.composite;
  }

  const levelOrder = ["none", "light", "medium", "heavy"];
  const rows = levelOrder
    .filter((l) => byLevel.has(l))
    .map((level) => {
      const rec = byLevel.get(level)!;
      const rate = rec.total > 0 ? ((rec.pass / rec.total) * 100).toFixed(0) : "0";
      const avgRed = rec.total > 0 ? (rec.avgReduction / rec.total).toFixed(1) : "0.0";
      const avgComp = rec.total > 0 ? (rec.avgComposite / rec.total).toFixed(3) : "0.000";
      return `| ${level} | ${rate}% (${rec.pass}/${rec.total}) | ${avgRed}% | ${avgComp} |`;
    })
    .join("\n");

  // Include any unknown levels
  const unknownRows = Array.from(byLevel.entries())
    .filter(([l]) => !levelOrder.includes(l))
    .map(([level, rec]) => {
      const rate = rec.total > 0 ? ((rec.pass / rec.total) * 100).toFixed(0) : "0";
      const avgRed = rec.total > 0 ? (rec.avgReduction / rec.total).toFixed(1) : "0.0";
      const avgComp = rec.total > 0 ? (rec.avgComposite / rec.total).toFixed(3) : "0.000";
      return `| ${level} | ${rate}% (${rec.pass}/${rec.total}) | ${avgRed}% | ${avgComp} |`;
    })
    .join("\n");

  return `## Per-Level Breakdown

| Level | Pass Rate | Avg Token Reduction | Avg Composite |
|-------|-----------|---------------------|---------------|
${rows}${unknownRows ? "\n" + unknownRows : ""}
`;
}

function buildDimensionBreakdown(
  results: ContextEvalResult[],
  caseById: Map<string, ContextEvalCase>,
): string {
  const byDimension = new Map<
    string,
    { total: number; pass: number; avgComposite: number }
  >();

  for (const r of results) {
    const c = caseById.get(r.caseId);
    const dim = c?.metadata.dimension ?? "untagged";
    if (!byDimension.has(dim)) {
      byDimension.set(dim, { total: 0, pass: 0, avgComposite: 0 });
    }
    const rec = byDimension.get(dim)!;
    rec.total++;
    if (r.status === "pass") rec.pass++;
    rec.avgComposite += r.scores.composite;
  }

  const rows = Array.from(byDimension.entries())
    .sort((a, b) => a[1].pass / a[1].total - b[1].pass / b[1].total)
    .map(([dim, rec]) => {
      const rate = rec.total > 0 ? ((rec.pass / rec.total) * 100).toFixed(0) : "0";
      return `| ${dim} | ${rate}% (${rec.pass}/${rec.total}) | ${(rec.avgComposite / rec.total).toFixed(3)} |`;
    })
    .join("\n");

  return `## Per-Dimension Breakdown

| Dimension | Pass Rate | Avg Composite |
|-----------|-----------|---------------|
${rows}
`;
}

function buildTokenEfficiency(results: ContextEvalResult[]): string {
  const validResults = results.filter((r) => r.status !== "error");
  if (validResults.length === 0) {
    return "## Token Efficiency\n\nNo valid results to analyze.\n";
  }

  const rows = validResults
    .slice(0, 20)
    .map((r) => {
      return `| ${r.caseId.slice(0, 25)} | ${r.compressionLevel} | ${r.actual.promptTokensBefore} | ${r.actual.promptTokensAfter} | ${r.actual.reductionPercent.toFixed(1)}% | ${r.actual.historyLengthBefore} → ${r.actual.historyLengthAfter} |`;
    })
    .join("\n");

  return `## Token Efficiency

| Case | Level | Before | After | Reduction | History |
|------|-------|--------|-------|-----------|---------|
${rows}
`;
}

function buildFailedCases(
  results: ContextEvalResult[],
  caseById: Map<string, ContextEvalCase>,
): string {
  const failures = results.filter(
    (r) => r.status === "fail" || r.status === "error",
  );
  if (failures.length === 0) {
    return "## Failed Cases\n\nNo failures.\n";
  }

  const details = failures
    .slice(0, 20)
    .map((r) => {
      const c = caseById.get(r.caseId);
      const dim = c?.metadata.dimension ?? "untagged";

      const lostInfo: string[] = [];
      if (r.scores.goalPreservation < 1.0) lostInfo.push("original query");
      if (r.scores.planPreservation < 0.5) lostInfo.push("plan status");
      if (r.scores.toolResultPreservation < 0.5) lostInfo.push("recent tool results");
      if (r.scores.keyFactPreservation < 0.5) lostInfo.push("key facts/errors");

      return `### ${r.caseId}

- **Dimension**: ${dim}
- **Status**: ${r.status}${r.error ? ` — ${r.error}` : ""}
- **Compression level**: ${r.compressionLevel}
- **Scores**: goal=${r.scores.goalPreservation.toFixed(2)} plan=${r.scores.planPreservation.toFixed(2)} tool=${r.scores.toolResultPreservation.toFixed(2)} fact=${r.scores.keyFactPreservation.toFixed(2)} eff=${r.scores.tokenEfficiency.toFixed(2)} comp=${r.scores.composite.toFixed(2)}
- **Info lost**: ${lostInfo.length > 0 ? lostInfo.join(", ") : "(none identified)"}
- **Token reduction**: ${r.actual.reductionPercent.toFixed(1)}% (${r.actual.promptTokensBefore} → ${r.actual.promptTokensAfter})
`;
    })
    .join("\n");

  return `## Failed Cases (${failures.length} total)\n\n${details}`;
}

function buildRecommendations(
  results: ContextEvalResult[],
  caseById: Map<string, ContextEvalCase>,
): string {
  const issues: string[] = [];

  // Analyze systematic patterns
  const goalFailures = results.filter((r) => r.scores.goalPreservation < 1.0);
  if (goalFailures.length > 0) {
    issues.push(
      `**[HIGH]** Goal amnesia detected in ${goalFailures.length} case(s) — the original query was lost during compression. Ensure the first user message is always preserved verbatim.`,
    );
  }

  const planFailures = results.filter((r) => r.scores.planPreservation < 0.5);
  if (planFailures.length > 0) {
    issues.push(
      `**[HIGH]** Plan status lost in ${planFailures.length} case(s) — subtask descriptions were removed during compression. Plan status should be in the system prompt, not in history.`,
    );
  }

  const effFailures = results.filter((r) => r.scores.tokenEfficiency < 0.5 && r.compressionLevel !== "none");
  if (effFailures.length > 0) {
    issues.push(
      `**[MED]** Insufficient compression in ${effFailures.length} case(s) — token reduction below target. Consider more aggressive tool result truncation.`,
    );
  }

  if (issues.length === 0) {
    return "## Recommendations\n\nNo specific recommendations — all cases passed.\n";
  }

  return `## Recommendations\n\n${issues.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`;
}

// ── Helpers ──────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function min(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.min(...values);
}
