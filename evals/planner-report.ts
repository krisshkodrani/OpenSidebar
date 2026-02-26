/**
 * Planner eval markdown report generator.
 *
 * Sections: Summary, Difficulty Calibration, Per-Dimension Breakdown,
 * Failed Cases, Prompt Recommendations.
 */

import type { PlannerEvalCase, PlannerEvalResult, PlannerJudgeScore } from "./types";

export interface PlannerCritiqueData {
  cases: PlannerEvalCase[];
  results: PlannerEvalResult[];
}

export function buildPlannerReport(data: PlannerCritiqueData): string {
  const { cases, results } = data;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const sections: string[] = [];

  sections.push("# Planner Eval Report\n");
  sections.push(`Generated: ${new Date().toISOString()}\n`);

  // Model versions used
  const models = new Set(results.map((r) => r.modelVersion).filter(Boolean));
  if (models.size > 0) {
    sections.push(`Models: ${Array.from(models).join(", ")}\n`);
  }

  sections.push(buildSummary(results));
  sections.push(buildDifficultyCalibration(results, caseById));
  sections.push(buildDimensionBreakdown(results, caseById));
  sections.push(buildFailedCases(results, caseById));
  sections.push(buildDisagreements(results, caseById));
  sections.push(buildRecommendations(results));

  return sections.join("\n");
}

// ── Sections ─────────────────────────────────────────────────────────

function buildSummary(results: PlannerEvalResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const avgDiff = avg(results.map((r) => r.scores.difficultyAccuracy));
  const avgStep = avg(results.map((r) => r.scores.stepCountScore));
  const avgCov = avg(results.map((r) => r.scores.coverageScore));
  const avgQual = avg(results.map((r) => r.scores.stepQualityScore));
  const avgAnti = avg(results.map((r) => r.scores.antiPatternScore));
  const avgComp = avg(results.map((r) => r.scores.composite));

  const minComp = min(results.map((r) => r.scores.composite));
  const minDiff = min(results.map((r) => r.scores.difficultyAccuracy));
  const minStep = min(results.map((r) => r.scores.stepCountScore));
  const minCov = min(results.map((r) => r.scores.coverageScore));
  const minQual = min(results.map((r) => r.scores.stepQualityScore));
  const minAnti = min(results.map((r) => r.scores.antiPatternScore));

  // New dimensions — only show when any result has non-undefined values
  const spValues = results.map((r) => r.scores.stepProgressScore).filter((v): v is number => v != null);
  const tmValues = results.map((r) => r.scores.terminationScore).filter((v): v is number => v != null);
  const hasExtended = spValues.length > 0 || tmValues.length > 0;

  let extendedRows = "";
  if (hasExtended) {
    if (spValues.length > 0) {
      extendedRows += `| Step progress score | ${avg(spValues).toFixed(3)} | ${min(spValues).toFixed(3)} |\n`;
    }
    if (tmValues.length > 0) {
      extendedRows += `| Termination score | ${avg(tmValues).toFixed(3)} | ${min(tmValues).toFixed(3)} |\n`;
    }
  }

  return `## Summary

| Metric | Avg | Min (worst) |
|--------|-----|-------------|
| Total results | ${total} | — |
| Pass rate | ${passRate}% (${passed}/${total}) | — |
| Failed | ${failed} | — |
| Errors | ${errored} | — |
| Difficulty accuracy | ${avgDiff.toFixed(3)} | ${minDiff.toFixed(3)} |
| Step count score | ${avgStep.toFixed(3)} | ${minStep.toFixed(3)} |
| Coverage score | ${avgCov.toFixed(3)} | ${minCov.toFixed(3)} |
| Step quality score | ${avgQual.toFixed(3)} | ${minQual.toFixed(3)} |
| Anti-pattern score | ${avgAnti.toFixed(3)} | ${minAnti.toFixed(3)} |
${extendedRows}| Composite | ${avgComp.toFixed(3)} | ${minComp.toFixed(3)} |
`;
}

function buildDifficultyCalibration(
  results: PlannerEvalResult[],
  caseById: Map<string, PlannerEvalCase>,
): string {
  const levels = ["simple", "moderate", "complex", "extreme"];
  const matrix: Record<string, Record<string, number>> = {};

  for (const level of levels) {
    matrix[level] = {};
    for (const l2 of levels) matrix[level][l2] = 0;
  }

  for (const r of results) {
    if (r.method !== "decompose" || !r.actual.decomposition) continue;
    const c = caseById.get(r.caseId);
    const expected = c?.expected.difficulty ?? "moderate";
    const actual = r.actual.decomposition.difficulty?.toLowerCase() ?? "moderate";
    if (matrix[expected] && actual in (matrix[expected] ?? {})) {
      matrix[expected][actual]++;
    } else if (matrix[expected]) {
      // Handle unexpected difficulty values
      matrix[expected][actual] = (matrix[expected][actual] ?? 0) + 1;
    }
  }

  const header = `| Expected \\ Actual | ${levels.join(" | ")} |`;
  const divider = `|${levels.map(() => "---").join("|")}---|`;
  const rows = levels.map((exp) => {
    const cells = levels.map((act) => String(matrix[exp]?.[act] ?? 0));
    return `| ${exp} | ${cells.join(" | ")} |`;
  });

  return `## Difficulty Calibration

${header}
${divider}
${rows.join("\n")}
`;
}

function buildDimensionBreakdown(
  results: PlannerEvalResult[],
  caseById: Map<string, PlannerEvalCase>,
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
  results: PlannerEvalResult[],
  caseById: Map<string, PlannerEvalCase>,
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

      const judge = r.scores.judge;
      const judgeExtras = judge
        ? [
            judge.verificationGateQuality != null ? `vgate=${judge.verificationGateQuality}` : "",
            judge.terminationAwareness != null ? `term=${judge.terminationAwareness}` : "",
          ].filter(Boolean).join(" ")
        : "";
      const judgeBlock = judge
        ? `  - **Judge**: coh=${judge.planCoherence} ali=${judge.taskAlignment} ` +
          `gran=${judge.granularity} feas=${judge.feasibility} rob=${judge.robustness}` +
          (judgeExtras ? ` ${judgeExtras}` : "") + `\n` +
          `  - **Reasoning**: ${judge.reasoning.slice(0, 300)}\n` +
          (judge.promptFixSuggestion
            ? `  - **Prompt fix**: ${judge.promptFixSuggestion}\n`
            : "")
        : "  - *(not judged)*\n";

      const actualSnippet = r.actual.decomposition
        ? `Difficulty: ${r.actual.decomposition.difficulty}, Steps: ${r.actual.decomposition.subtasks.length}`
        : r.actual.validation
          ? `Approved: ${r.actual.validation.approved}`
          : "(error)";

      const expectedSnippet = c?.expected.difficulty
        ? `Difficulty: ${c.expected.difficulty}, Steps: ${c.expected.stepCountRange?.min}-${c.expected.stepCountRange?.max}`
        : c?.expected.approved !== undefined
          ? `Approved: ${c.expected.approved}`
          : "(none)";

      return `### ${r.caseId}

- **Dimension**: ${dim}
- **Method**: ${r.method}
- **Status**: ${r.status}${r.error ? ` — ${r.error}` : ""}
- **Scores**: diff=${r.scores.difficultyAccuracy.toFixed(2)} step=${r.scores.stepCountScore.toFixed(2)} cov=${r.scores.coverageScore.toFixed(2)} qual=${r.scores.stepQualityScore.toFixed(2)} anti=${r.scores.antiPatternScore.toFixed(2)}${r.scores.stepProgressScore != null ? ` sp=${r.scores.stepProgressScore.toFixed(2)}` : ""}${r.scores.terminationScore != null ? ` term=${r.scores.terminationScore.toFixed(2)}` : ""} comp=${r.scores.composite.toFixed(2)}
- **Expected**: ${expectedSnippet}
- **Actual**: ${actualSnippet}
${judgeBlock}`;
    })
    .join("\n");

  return `## Failed Cases (${failures.length} total)\n\n${details}`;
}

function buildDisagreements(
  results: PlannerEvalResult[],
  caseById: Map<string, PlannerEvalCase>,
): string {
  const disagreements: Array<{
    caseId: string;
    dimension: string;
    scorerPass: boolean;
    judgePass: boolean;
    composite: number;
  }> = [];

  for (const r of results) {
    if (!r.scores.judge) continue;
    const scorerPass = r.status === "pass" && !r.scores.judge; // status before judge override
    // Detect: scorer said pass but judge said fail, or scorer said fail but judge said pass
    const c = caseById.get(r.caseId);
    const dim = c?.metadata.dimension ?? "untagged";

    // Compare composite-based pass (>= 0.7) vs judge pass
    const compositePass = r.scores.composite >= 0.7;
    if (compositePass !== r.scores.judge.pass) {
      disagreements.push({
        caseId: r.caseId,
        dimension: dim,
        scorerPass: compositePass,
        judgePass: r.scores.judge.pass,
        composite: r.scores.composite,
      });
    }
  }

  if (disagreements.length === 0) {
    return "## Judge-Scorer Disagreements\n\nNo disagreements — scorer and judge agree on all cases.\n";
  }

  const rows = disagreements
    .map((d) =>
      `| ${d.caseId.slice(0, 40)} | ${d.dimension} | ${d.scorerPass ? "pass" : "fail"} | ${d.judgePass ? "pass" : "fail"} | ${d.composite.toFixed(2)} |`,
    )
    .join("\n");

  return `## Judge-Scorer Disagreements (${disagreements.length} cases)

These cases need manual review — the automated scorer and LLM judge disagree on pass/fail.

| Case ID | Dimension | Scorer | Judge | Composite |
|---------|-----------|--------|-------|-----------|
${rows}
`;
}

function buildRecommendations(results: PlannerEvalResult[]): string {
  const suggestions = new Map<
    string,
    { suggestion: string; count: number }
  >();

  for (const r of results) {
    const judge = r.scores.judge;
    if (!judge?.promptFixSuggestion) continue;
    const key = judge.promptFixSuggestion.slice(0, 100);
    const existing = suggestions.get(key);
    if (existing) {
      existing.count++;
    } else {
      suggestions.set(key, { suggestion: judge.promptFixSuggestion, count: 1 });
    }
  }

  const recs = Array.from(suggestions.values())
    .sort((a, b) => b.count - a.count)
    .map(
      (r, i) =>
        `${i + 1}. **[${r.count >= 3 ? "HIGH" : r.count >= 2 ? "MED" : "LOW"}]** (${r.count}x) ${r.suggestion}`,
    );

  if (recs.length === 0) {
    return "## Prompt Recommendations\n\nNo specific recommendations — all cases passed.\n";
  }

  return `## Prompt Recommendations\n\n${recs.join("\n")}\n`;
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
