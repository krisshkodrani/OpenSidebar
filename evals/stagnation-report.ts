/**
 * Stagnation eval markdown report generator.
 *
 * Sections: Summary, Escalation Accuracy, Timing Analysis,
 * Per-Dimension Breakdown, Failed Cases, Threshold Recommendations.
 */

import type { StagnationEvalCase, StagnationEvalResult } from "./types";

export interface StagnationCritiqueData {
  cases: StagnationEvalCase[];
  results: StagnationEvalResult[];
}

export function buildStagnationReport(data: StagnationCritiqueData): string {
  const { cases, results } = data;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const sections: string[] = [];

  sections.push("# Stagnation Eval Report\n");
  sections.push(`Generated: ${new Date().toISOString()}\n`);

  sections.push(buildSummary(results));
  sections.push(buildEscalationAccuracy(results, caseById));
  sections.push(buildTimingAnalysis(results, caseById));
  sections.push(buildDimensionBreakdown(results, caseById));
  sections.push(buildFailedCases(results, caseById));
  sections.push(buildThresholdRecommendations(results, caseById));

  return sections.join("\n");
}

// ── Sections ─────────────────────────────────────────────────────────

function buildSummary(results: StagnationEvalResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const avgEsc = avg(results.map((r) => r.scores.escalationAccuracy));
  const avgTim = avg(results.map((r) => r.scores.timingAccuracy));
  const avgFP = avg(results.map((r) => r.scores.falsePositiveRate));
  const avgFN = avg(results.map((r) => r.scores.falseNegativeRate));
  const avgComp = avg(results.map((r) => r.scores.composite));

  return `## Summary

| Metric | Value |
|--------|-------|
| Total results | ${total} |
| Pass rate | ${passRate}% (${passed}/${total}) |
| Failed | ${failed} |
| Errors | ${errored} |
| Avg escalation accuracy | ${avgEsc.toFixed(3)} |
| Avg timing accuracy | ${avgTim.toFixed(3)} |
| Avg false positive score | ${avgFP.toFixed(3)} |
| Avg false negative score | ${avgFN.toFixed(3)} |
| Avg composite | ${avgComp.toFixed(3)} |
`;
}

function buildEscalationAccuracy(
  results: StagnationEvalResult[],
  caseById: Map<string, StagnationEvalCase>,
): string {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const r of results) {
    if (r.status === "error") continue;
    const c = caseById.get(r.caseId);
    if (!c) continue;

    const expected = c.expected.escalation.shouldFire;
    const actual = r.actual.escalationFired;

    if (expected && actual) truePositive++;
    else if (!expected && !actual) trueNegative++;
    else if (!expected && actual) falsePositive++;
    else if (expected && !actual) falseNegative++;
  }

  const total = truePositive + trueNegative + falsePositive + falseNegative;
  const accuracy = total > 0 ? ((truePositive + trueNegative) / total * 100).toFixed(1) : "0.0";

  return `## Escalation Accuracy

| Classification | Count |
|---------------|-------|
| True Positive (stuck + escalated) | ${truePositive} |
| True Negative (not stuck + no escalation) | ${trueNegative} |
| False Positive (not stuck + escalated) | ${falsePositive} |
| False Negative (stuck + no escalation) | ${falseNegative} |
| **Overall Accuracy** | **${accuracy}%** |
`;
}

function buildTimingAnalysis(
  results: StagnationEvalResult[],
  caseById: Map<string, StagnationEvalCase>,
): string {
  const timingData: Array<{
    caseId: string;
    expectedMin?: number;
    expectedMax?: number;
    actual?: number;
    delta: string;
  }> = [];

  for (const r of results) {
    if (r.status === "error" || !r.actual.escalationFired) continue;
    const c = caseById.get(r.caseId);
    if (!c) continue;

    const range = c.expected.escalation.expectedTurnRange;
    const actualTurn = r.actual.escalationTurn;
    let delta = "N/A";

    if (range && actualTurn !== undefined) {
      if (actualTurn >= range.min && actualTurn <= range.max) {
        delta = "in range";
      } else if (actualTurn < range.min) {
        delta = `${range.min - actualTurn} early`;
      } else {
        delta = `${actualTurn - range.max} late`;
      }
    }

    timingData.push({
      caseId: r.caseId.slice(0, 25),
      expectedMin: range?.min,
      expectedMax: range?.max,
      actual: actualTurn,
      delta,
    });
  }

  if (timingData.length === 0) {
    return "## Timing Analysis\n\nNo escalation events to analyze.\n";
  }

  const rows = timingData
    .map((d) => `| ${d.caseId} | ${d.expectedMin ?? "—"}–${d.expectedMax ?? "—"} | ${d.actual ?? "—"} | ${d.delta} |`)
    .join("\n");

  return `## Timing Analysis

| Case | Expected Range | Actual Turn | Delta |
|------|---------------|-------------|-------|
${rows}
`;
}

function buildDimensionBreakdown(
  results: StagnationEvalResult[],
  caseById: Map<string, StagnationEvalCase>,
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

function buildFailedCases(
  results: StagnationEvalResult[],
  caseById: Map<string, StagnationEvalCase>,
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
      const snapCount = c?.input.snapshots.length ?? 0;

      const issue =
        r.scores.escalationAccuracy < 1.0
          ? `Escalation ${c?.expected.escalation.shouldFire ? "expected but not fired" : "fired but not expected"}`
          : r.scores.timingAccuracy < 0.5
            ? `Escalation timing off (turn ${r.actual.escalationTurn ?? "?"} vs expected ${c?.expected.escalation.expectedTurnRange?.min ?? "?"}–${c?.expected.escalation.expectedTurnRange?.max ?? "?"})`
            : "Unknown issue";

      return `### ${r.caseId}

- **Dimension**: ${dim}
- **Status**: ${r.status}${r.error ? ` — ${r.error}` : ""}
- **Snapshots**: ${snapCount} turns
- **Scores**: esc=${r.scores.escalationAccuracy.toFixed(2)} timing=${r.scores.timingAccuracy.toFixed(2)} fp=${r.scores.falsePositiveRate.toFixed(2)} fn=${r.scores.falseNegativeRate.toFixed(2)} comp=${r.scores.composite.toFixed(2)}
- **Issue**: ${issue}
- **Actual**: escalation=${r.actual.escalationFired}, turn=${r.actual.escalationTurn ?? "—"}, stagnant=${r.actual.totalStagnantTurns}, urlChanges=${r.actual.urlChanges}
`;
    })
    .join("\n");

  return `## Failed Cases (${failures.length} total)\n\n${details}`;
}

function buildThresholdRecommendations(
  results: StagnationEvalResult[],
  caseById: Map<string, StagnationEvalCase>,
): string {
  const issues: string[] = [];

  // Detect systematic bias
  const falsePositives = results.filter(
    (r) => r.status !== "error" && r.scores.falsePositiveRate < 1.0,
  );
  const falseNegatives = results.filter(
    (r) => r.status !== "error" && r.scores.falseNegativeRate < 1.0,
  );

  if (falsePositives.length > results.length * 0.3) {
    issues.push(
      `**[HIGH]** High false positive rate (${falsePositives.length}/${results.length}) — escalation fires too eagerly. Consider increasing STUCK_THRESHOLDS.ESCALATE.`,
    );
  }

  if (falseNegatives.length > results.length * 0.3) {
    issues.push(
      `**[HIGH]** High false negative rate (${falseNegatives.length}/${results.length}) — escalation fires too late or not at all. Consider decreasing STUCK_THRESHOLDS.ESCALATE.`,
    );
  }

  // Check timing bias
  const earlyFirings = results.filter((r) => {
    const c = caseById.get(r.caseId);
    if (!c || !r.actual.escalationTurn || !c.expected.escalation.expectedTurnRange) return false;
    return r.actual.escalationTurn < c.expected.escalation.expectedTurnRange.min;
  });

  const lateFirings = results.filter((r) => {
    const c = caseById.get(r.caseId);
    if (!c || !r.actual.escalationTurn || !c.expected.escalation.expectedTurnRange) return false;
    return r.actual.escalationTurn > c.expected.escalation.expectedTurnRange.max;
  });

  if (earlyFirings.length > 2) {
    issues.push(
      `**[MED]** Escalation fires early in ${earlyFirings.length} case(s). PROGRESS_DELTA_THRESHOLD may be too high (missing small but meaningful changes).`,
    );
  }

  if (lateFirings.length > 2) {
    issues.push(
      `**[MED]** Escalation fires late in ${lateFirings.length} case(s). PROGRESS_DELTA_THRESHOLD may be too low (treating noise as progress).`,
    );
  }

  if (issues.length === 0) {
    return "## Threshold Recommendations\n\nNo systematic bias detected — current thresholds appear well-calibrated.\n";
  }

  return `## Threshold Recommendations\n\n${issues.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`;
}

// ── Helpers ──────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
