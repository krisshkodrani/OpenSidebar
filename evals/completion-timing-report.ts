/**
 * Completion-timing eval markdown report generator.
 *
 * Produces structured reports with:
 * - Summary table (pass rate, avg scores per dimension)
 * - Per-case breakdown
 * - Difficulty analysis
 * - Scenario analysis (done vs continue expected)
 * - Failed cases with judge feedback
 * - Prompt recommendations
 */

import type {
  CompletionTimingGoldenCase,
  CompletionTimingEvalResult,
} from "./completion-timing-types";

export interface CompletionTimingCritiqueData {
  cases: CompletionTimingGoldenCase[];
  results: CompletionTimingEvalResult[];
}

export function buildCompletionTimingReport(data: CompletionTimingCritiqueData): string {
  const { cases, results } = data;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const sections: string[] = [];

  sections.push("# Completion-Timing Eval Report\n");
  sections.push(`Generated: ${new Date().toISOString()}\n`);

  sections.push(buildSummary(results));
  sections.push(buildPerCaseTable(results, caseById));
  sections.push(buildDifficultyAnalysis(results, caseById));
  sections.push(buildScenarioAnalysis(results, caseById));
  sections.push(buildFailedCases(results, caseById));
  sections.push(buildRecommendations(results));

  return sections.join("\n");
}

// ── Sections ─────────────────────────────────────────────────────────

function buildSummary(results: CompletionTimingEvalResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const avgDec = avg(results.map((r) => r.scores.decisionCorrect));
  const avgSum = avg(results.map((r) => r.scores.summaryQuality));
  const avgNext = avg(results.map((r) => r.scores.nextActionQuality));
  const avgPerc = avg(results.map((r) => r.scores.perceptionUsage));
  const avgComp = avg(results.map((r) => r.scores.composite));

  return `## Summary

| Metric | Value |
|--------|-------|
| Total cases | ${total} |
| Pass rate | ${passRate}% (${passed}/${total}) |
| Failed | ${failed} |
| Errors | ${errored} |
| Avg decision correct | ${avgDec.toFixed(3)} |
| Avg summary quality | ${avgSum.toFixed(3)} |
| Avg next action quality | ${avgNext.toFixed(3)} |
| Avg perception usage | ${avgPerc.toFixed(3)} |
| Avg composite | ${avgComp.toFixed(3)} |
`;
}

function buildPerCaseTable(
  results: CompletionTimingEvalResult[],
  caseById: Map<string, CompletionTimingGoldenCase>,
): string {
  const rows = results.map((r) => {
    const c = caseById.get(r.caseId);
    const diff = c?.difficulty ?? "?";
    const expected = c?.expectedAction ?? "?";
    const statusIcon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "ERR";
    return (
      `| ${r.caseId} | ${statusIcon} | ${diff} | ${expected} | ` +
      `${r.scores.decisionCorrect.toFixed(2)} | ` +
      `${r.scores.summaryQuality.toFixed(2)} | ` +
      `${r.scores.nextActionQuality.toFixed(2)} | ` +
      `${r.scores.composite.toFixed(2)} | ${r.durationMs}ms |`
    );
  });

  return `## Per-Case Results

| Case | Status | Difficulty | Expected | Decision | Summary | Next Action | Composite | Latency |
|------|--------|------------|----------|----------|---------|-------------|-----------|---------|
${rows.join("\n")}
`;
}

function buildDifficultyAnalysis(
  results: CompletionTimingEvalResult[],
  caseById: Map<string, CompletionTimingGoldenCase>,
): string {
  const buckets: Record<string, { total: number; pass: number; avgComp: number }> = {
    easy: { total: 0, pass: 0, avgComp: 0 },
    medium: { total: 0, pass: 0, avgComp: 0 },
    hard: { total: 0, pass: 0, avgComp: 0 },
  };

  for (const r of results) {
    const c = caseById.get(r.caseId);
    const diff = c?.difficulty ?? "medium";
    buckets[diff].total++;
    if (r.status === "pass") buckets[diff].pass++;
    buckets[diff].avgComp += r.scores.composite;
  }

  const rows = Object.entries(buckets)
    .filter(([, b]) => b.total > 0)
    .map(([label, b]) => {
      const rate = ((b.pass / b.total) * 100).toFixed(0);
      return `| ${label} | ${rate}% (${b.pass}/${b.total}) | ${(b.avgComp / b.total).toFixed(3)} |`;
    });

  return `## Difficulty Analysis

| Difficulty | Pass Rate | Avg Composite |
|------------|-----------|---------------|
${rows.join("\n")}
`;
}

function buildScenarioAnalysis(
  results: CompletionTimingEvalResult[],
  caseById: Map<string, CompletionTimingGoldenCase>,
): string {
  const doneCases = results.filter((r) => caseById.get(r.caseId)?.expectedAction === "done");
  const continueCases = results.filter((r) => caseById.get(r.caseId)?.expectedAction === "continue");

  const donePass = doneCases.filter((r) => r.status === "pass").length;
  const continuePass = continueCases.filter((r) => r.status === "pass").length;

  return `## Scenario Analysis

| Expected Action | Pass Rate | Count |
|-----------------|-----------|-------|
| done | ${doneCases.length > 0 ? ((donePass / doneCases.length) * 100).toFixed(0) : "N/A"}% (${donePass}/${doneCases.length}) | ${doneCases.length} |
| continue | ${continueCases.length > 0 ? ((continuePass / continueCases.length) * 100).toFixed(0) : "N/A"}% (${continuePass}/${continueCases.length}) | ${continueCases.length} |
`;
}

function buildFailedCases(
  results: CompletionTimingEvalResult[],
  caseById: Map<string, CompletionTimingGoldenCase>,
): string {
  const failures = results.filter((r) => r.status === "fail" || r.status === "error");
  if (failures.length === 0) {
    return "## Failed Cases\n\nNo failures.\n";
  }

  const details = failures.map((r) => {
    const c = caseById.get(r.caseId);
    const judge = r.judge;
    const judgeBlock = judge
      ? `  - **Judge**: recognition=${judge.completionRecognition} timing=${judge.timingAccuracy} ` +
        `specificity=${judge.summarySpecificity} adherence=${judge.planAdherence}\n` +
        `  - **Reasoning**: ${judge.reasoning}\n` +
        (judge.promptFixSuggestion ? `  - **Prompt fix**: ${judge.promptFixSuggestion}\n` : "")
      : "  - *(not judged)*\n";

    const modelCalls = r.result.toolCalls.length > 0
      ? r.result.toolCalls.map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`).join(", ")
      : "(no tool calls)";

    return `### ${r.caseId} — ${r.scenario}

- **Status**: ${r.status}${r.error ? ` — ${r.error}` : ""}
- **Expected**: ${c?.expectedAction ?? "unknown"}
- **Scores**: dec=${r.scores.decisionCorrect.toFixed(2)} sum=${r.scores.summaryQuality.toFixed(2)} next=${r.scores.nextActionQuality.toFixed(2)} comp=${r.scores.composite.toFixed(2)}
${judgeBlock}
- **Model called**: ${modelCalls}
`;
  }).join("\n");

  return `## Failed Cases (${failures.length} total)\n\n${details}`;
}

function buildRecommendations(results: CompletionTimingEvalResult[]): string {
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
