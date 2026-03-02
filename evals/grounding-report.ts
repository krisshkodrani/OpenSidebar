/**
 * Grounding eval markdown report generator.
 *
 * Produces structured reports with:
 * - Summary table (pass rate, avg scores per dimension)
 * - Per-case breakdown
 * - Scenario analysis (group by scenario type)
 * - Difficulty analysis
 * - Failed cases detail
 * - Prompt recommendations from judge
 */

import type {
  GroundingGoldenCase,
  GroundingEvalResult,
} from "./grounding-types";

export interface GroundingCritiqueData {
  cases: GroundingGoldenCase[];
  results: GroundingEvalResult[];
}

export function buildGroundingReport(data: GroundingCritiqueData): string {
  const { cases, results } = data;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const sections: string[] = [];

  sections.push("# Grounding Eval Report\n");
  sections.push(`Generated: ${new Date().toISOString()}`);
  sections.push(`Model: ${results[0]?.model ?? "unknown"}\n`);

  sections.push(buildSummary(results));
  sections.push(buildPerCaseTable(results, caseById));
  sections.push(buildScenarioAnalysis(results));
  sections.push(buildDifficultyAnalysis(results, caseById));
  sections.push(buildFailedCases(results, caseById));
  sections.push(buildRecommendations(results));

  return sections.join("\n");
}

// ── Sections ─────────────────────────────────────────────────────────

function buildSummary(results: GroundingEvalResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const avgMis = avg(results.map((r) => r.scores.mismatchDetection));
  const avgObs = avg(results.map((r) => r.scores.observeFirst));
  const avgTrap = avg(results.map((r) => r.scores.trapAvoidance));
  const avgNov = avg(results.map((r) => r.scores.strategyNovelty));
  const avgTool = avg(results.map((r) => r.scores.toolCorrectness));
  const avgComp = avg(results.map((r) => r.scores.composite));

  return `## Summary

| Metric | Value |
|--------|-------|
| Total cases | ${total} |
| Pass rate | ${passRate}% (${passed}/${total}) |
| Failed | ${failed} |
| Errors | ${errored} |
| Avg mismatch detection | ${avgMis.toFixed(3)} |
| Avg observe first | ${avgObs.toFixed(3)} |
| Avg trap avoidance | ${avgTrap.toFixed(3)} |
| Avg strategy novelty | ${avgNov.toFixed(3)} |
| Avg tool correctness | ${avgTool.toFixed(3)} |
| Avg composite | ${avgComp.toFixed(3)} |
`;
}

function buildPerCaseTable(
  results: GroundingEvalResult[],
  caseById: Map<string, GroundingGoldenCase>,
): string {
  const rows = results.map((r) => {
    const c = caseById.get(r.caseId);
    const diff = c?.difficulty ?? "?";
    const statusIcon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "ERR";
    return (
      `| ${r.caseId} | ${statusIcon} | ${diff} | ` +
      `${r.scores.mismatchDetection.toFixed(2)} | ` +
      `${r.scores.observeFirst.toFixed(2)} | ` +
      `${r.scores.trapAvoidance.toFixed(2)} | ` +
      `${r.scores.strategyNovelty.toFixed(2)} | ` +
      `${r.scores.toolCorrectness.toFixed(2)} | ` +
      `${r.scores.composite.toFixed(2)} | ${r.durationMs}ms |`
    );
  });

  return `## Per-Case Results

| Case | Status | Difficulty | Mismatch | Observe | Trap | Novelty | Tool | Composite | Latency |
|------|--------|------------|----------|---------|------|---------|------|-----------|---------|
${rows.join("\n")}
`;
}

function buildScenarioAnalysis(results: GroundingEvalResult[]): string {
  const buckets = new Map<string, { total: number; pass: number; compSum: number }>();

  for (const r of results) {
    let b = buckets.get(r.scenario);
    if (!b) {
      b = { total: 0, pass: 0, compSum: 0 };
      buckets.set(r.scenario, b);
    }
    b.total++;
    if (r.status === "pass") b.pass++;
    b.compSum += r.scores.composite;
  }

  const rows = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([scenario, b]) => {
      const rate = ((b.pass / b.total) * 100).toFixed(0);
      return `| ${scenario} | ${rate}% (${b.pass}/${b.total}) | ${(b.compSum / b.total).toFixed(3)} |`;
    });

  return `## Scenario Analysis

| Scenario | Pass Rate | Avg Composite |
|----------|-----------|---------------|
${rows.join("\n")}
`;
}

function buildDifficultyAnalysis(
  results: GroundingEvalResult[],
  caseById: Map<string, GroundingGoldenCase>,
): string {
  const buckets: Record<string, { total: number; pass: number; compSum: number }> = {
    easy: { total: 0, pass: 0, compSum: 0 },
    medium: { total: 0, pass: 0, compSum: 0 },
    hard: { total: 0, pass: 0, compSum: 0 },
  };

  for (const r of results) {
    const c = caseById.get(r.caseId);
    const diff = c?.difficulty ?? "medium";
    buckets[diff].total++;
    if (r.status === "pass") buckets[diff].pass++;
    buckets[diff].compSum += r.scores.composite;
  }

  const rows = Object.entries(buckets)
    .filter(([, b]) => b.total > 0)
    .map(([label, b]) => {
      const rate = ((b.pass / b.total) * 100).toFixed(0);
      return `| ${label} | ${rate}% (${b.pass}/${b.total}) | ${(b.compSum / b.total).toFixed(3)} |`;
    });

  return `## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
${rows.join("\n")}
`;
}

function buildFailedCases(
  results: GroundingEvalResult[],
  caseById: Map<string, GroundingGoldenCase>,
): string {
  const failures = results.filter((r) => r.status === "fail" || r.status === "error");
  if (failures.length === 0) {
    return "## Failed Cases\n\nNo failures.\n";
  }

  const details = failures.map((r) => {
    const c = caseById.get(r.caseId);
    const judge = r.judge;
    const judgeBlock = judge
      ? `  - **Judge**: aware=${judge.situationalAwareness} contra=${judge.contradictionHandling} ` +
        `strat=${judge.strategicReasoning} trap=${judge.trapResistance}\n` +
        `  - **Reasoning**: ${judge.reasoning}\n` +
        (judge.promptFixSuggestion ? `  - **Prompt fix**: ${judge.promptFixSuggestion}\n` : "")
      : "  - *(not judged)*\n";

    const agentCalls = r.result.toolCalls.length > 0
      ? r.result.toolCalls.map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`).join(", ")
      : "(no tool calls)";

    const expected = c?.expected;
    const expectedStr = expected
      ? `${expected.expectedTool}${expected.acceptAlternatives?.length ? ` (or: ${expected.acceptAlternatives.join(", ")})` : ""}`
      : "(unknown)";

    return `### ${r.caseId} — ${r.scenario}

- **Status**: ${r.status}${r.error ? ` — ${r.error}` : ""}
- **Scores**: mis=${r.scores.mismatchDetection.toFixed(2)} obs=${r.scores.observeFirst.toFixed(2)} trap=${r.scores.trapAvoidance.toFixed(2)} nov=${r.scores.strategyNovelty.toFixed(2)} tool=${r.scores.toolCorrectness.toFixed(2)} comp=${r.scores.composite.toFixed(2)}
${judgeBlock}
- **Agent called**: ${agentCalls}
- **Expected tool**: ${expectedStr}
`;
  }).join("\n");

  return `## Failed Cases (${failures.length} total)\n\n${details}`;
}

function buildRecommendations(results: GroundingEvalResult[]): string {
  const suggestions = new Map<string, { suggestion: string; count: number }>();

  for (const r of results) {
    const judge = r.judge;
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
    return "## Prompt Recommendations\n\nNo specific recommendations — all cases passed or no judge was run.\n";
  }

  return `## Prompt Recommendations\n\n${recs.join("\n")}\n`;
}

// ── Helpers ──────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
