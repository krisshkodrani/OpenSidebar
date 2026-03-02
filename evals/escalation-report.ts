/**
 * Escalation eval markdown report generator.
 *
 * Produces structured reports with:
 * - Summary table (pass rate, avg scores per dimension)
 * - Per-case breakdown (phase 1 vs phase 2 scores)
 * - Difficulty analysis
 * - Model comparison (when both reasoning and glm results exist)
 * - Prompt recommendations from judge
 */

import type {
  EscalationGoldenCase,
  EscalationEvalResult,
} from "./escalation-types";

export interface EscalationCritiqueData {
  cases: EscalationGoldenCase[];
  results: EscalationEvalResult[];
}

export function buildEscalationReport(data: EscalationCritiqueData): string {
  const { cases, results } = data;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const sections: string[] = [];

  sections.push("# Escalation Eval Report\n");
  sections.push(`Generated: ${new Date().toISOString()}`);
  sections.push(`Planner model: ${results[0]?.plannerModel ?? "unknown"}\n`);

  sections.push(buildSummary(results));
  sections.push(buildPerCaseTable(results, caseById));
  sections.push(buildDifficultyAnalysis(results, caseById));
  sections.push(buildPhaseAnalysis(results));
  sections.push(buildFailedCases(results, caseById));
  sections.push(buildRecommendations(results));

  return sections.join("\n");
}

// ── Sections ─────────────────────────────────────────────────────────

function buildSummary(results: EscalationEvalResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const avgEsc = avg(results.map((r) => r.scores.escalationTriggered));
  const avgRsn = avg(results.map((r) => r.scores.reasonQuality));
  const avgTool = avg(results.map((r) => r.scores.toolMatch));
  const avgArgs = avg(results.map((r) => r.scores.argsMatch));
  const avgInv = avg(results.map((r) => r.scores.investigationQuality));
  const avgComp = avg(results.map((r) => r.scores.composite));

  return `## Summary

| Metric | Value |
|--------|-------|
| Total cases | ${total} |
| Pass rate | ${passRate}% (${passed}/${total}) |
| Failed | ${failed} |
| Errors | ${errored} |
| Avg escalation triggered | ${avgEsc.toFixed(3)} |
| Avg reason quality | ${avgRsn.toFixed(3)} |
| Avg tool match | ${avgTool.toFixed(3)} |
| Avg args match | ${avgArgs.toFixed(3)} |
| Avg investigation quality | ${avgInv.toFixed(3)} |
| Avg composite | ${avgComp.toFixed(3)} |
`;
}

function buildPerCaseTable(
  results: EscalationEvalResult[],
  caseById: Map<string, EscalationGoldenCase>,
): string {
  const rows = results.map((r) => {
    const c = caseById.get(r.caseId);
    const diff = c?.difficulty ?? "?";
    const statusIcon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "ERR";
    return (
      `| ${r.caseId} | ${statusIcon} | ${diff} | ` +
      `${r.scores.escalationTriggered.toFixed(2)} | ` +
      `${r.scores.toolMatch.toFixed(2)} | ` +
      `${r.scores.investigationQuality.toFixed(2)} | ` +
      `${r.scores.composite.toFixed(2)} | ${r.durationMs}ms |`
    );
  });

  return `## Per-Case Results

| Case | Status | Difficulty | Escalation | Tool Match | Investigation | Composite | Latency |
|------|--------|------------|------------|------------|---------------|-----------|---------|
${rows.join("\n")}
`;
}

function buildDifficultyAnalysis(
  results: EscalationEvalResult[],
  caseById: Map<string, EscalationGoldenCase>,
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

function buildPhaseAnalysis(results: EscalationEvalResult[]): string {
  const escalationRate = results.filter((r) => r.scores.escalationTriggered > 0).length;
  const recoveryRate = results.filter((r) => r.scores.toolMatch > 0).length;
  const total = results.length;

  return `## Phase Analysis

| Phase | Success Rate |
|-------|-------------|
| Phase 1: Escalation triggered | ${((escalationRate / total) * 100).toFixed(0)}% (${escalationRate}/${total}) |
| Phase 2: Recovery tool match | ${((recoveryRate / total) * 100).toFixed(0)}% (${recoveryRate}/${total}) |
`;
}

function buildFailedCases(
  results: EscalationEvalResult[],
  caseById: Map<string, EscalationGoldenCase>,
): string {
  const failures = results.filter((r) => r.status === "fail" || r.status === "error");
  if (failures.length === 0) {
    return "## Failed Cases\n\nNo failures.\n";
  }

  const details = failures.map((r) => {
    const c = caseById.get(r.caseId);
    const judge = r.judge;
    const judgeBlock = judge
      ? `  - **Judge**: stuck=${judge.stuckRecognition} shift=${judge.strategyShift} ` +
        `depth=${judge.investigationDepth} context=${judge.contextUsage}\n` +
        `  - **Reasoning**: ${judge.reasoning}\n` +
        (judge.promptFixSuggestion ? `  - **Prompt fix**: ${judge.promptFixSuggestion}\n` : "")
      : "  - *(not judged)*\n";

    const fastCalls = r.fastPhaseResult.toolCalls.length > 0
      ? r.fastPhaseResult.toolCalls.map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`).join(", ")
      : "(no tool calls)";

    const smartCalls = r.smartPhaseResult.toolCalls.length > 0
      ? r.smartPhaseResult.toolCalls.map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`).join(", ")
      : "(no tool calls)";

    const expected = c?.expectedSmartAction;
    const expectedStr = expected
      ? `${expected.toolName}${expected.acceptAlternatives?.length ? ` (or: ${expected.acceptAlternatives.join(", ")})` : ""}`
      : "(unknown)";

    return `### ${r.caseId} — ${r.scenario}

- **Status**: ${r.status}${r.error ? ` — ${r.error}` : ""}
- **Scores**: esc=${r.scores.escalationTriggered.toFixed(2)} tool=${r.scores.toolMatch.toFixed(2)} inv=${r.scores.investigationQuality.toFixed(2)} comp=${r.scores.composite.toFixed(2)}
${judgeBlock}
- **Executor model called**: ${fastCalls}
- **Planner model called**: ${smartCalls}
- **Expected planner action**: ${expectedStr}
`;
  }).join("\n");

  return `## Failed Cases (${failures.length} total)\n\n${details}`;
}

function buildRecommendations(results: EscalationEvalResult[]): string {
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
