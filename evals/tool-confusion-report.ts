/**
 * Tool-confusion eval markdown report generator.
 *
 * Produces structured reports with:
 * - Summary table (pass rate, avg scores per dimension)
 * - Per-pair confusion matrix
 * - Per-case breakdown
 * - Difficulty analysis
 * - Failed cases detail
 * - Prompt recommendations from judge
 */

import type {
  ToolConfusionGoldenCase,
  ToolConfusionEvalResult,
} from "./tool-confusion-types";
import { buildConfusionMatrix } from "./tool-confusion-scorer";

export interface ToolConfusionCritiqueData {
  cases: ToolConfusionGoldenCase[];
  results: ToolConfusionEvalResult[];
}

export function buildToolConfusionReport(data: ToolConfusionCritiqueData): string {
  const { cases, results } = data;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const sections: string[] = [];

  sections.push("# Tool-Confusion Eval Report\n");
  sections.push(`Generated: ${new Date().toISOString()}`);
  sections.push(`Model: ${results[0]?.model ?? "unknown"}\n`);

  sections.push(buildSummary(results));
  sections.push(buildConfusionMatrixSection(cases, results));
  sections.push(buildPerCaseTable(results, caseById));
  sections.push(buildDifficultyAnalysis(results, caseById));
  sections.push(buildFailedCases(results, caseById));
  sections.push(buildRecommendations(results));

  return sections.join("\n");
}

// ── Sections ─────────────────────────────────────────────────────────

function buildSummary(results: ToolConfusionEvalResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const avgCorrect = avg(results.map((r) => r.scores.correctToolPicked));
  const avgAnti = avg(results.map((r) => r.scores.avoidedAntiPattern));
  const avgParams = avg(results.map((r) => r.scores.parameterCorrectness));
  const avgReasoning = avg(results.map((r) => r.scores.reasoningQuality));
  const avgComp = avg(results.map((r) => r.scores.composite));

  return `## Summary

| Metric | Value |
|--------|-------|
| Total cases | ${total} |
| Pass rate | ${passRate}% (${passed}/${total}) |
| Failed | ${failed} |
| Errors | ${errored} |
| Avg correct tool picked | ${avgCorrect.toFixed(3)} |
| Avg anti-pattern avoided | ${avgAnti.toFixed(3)} |
| Avg parameter correctness | ${avgParams.toFixed(3)} |
| Avg reasoning quality | ${avgReasoning.toFixed(3)} |
| Avg composite | ${avgComp.toFixed(3)} |
`;
}

function buildConfusionMatrixSection(
  cases: ToolConfusionGoldenCase[],
  results: ToolConfusionEvalResult[],
): string {
  const matrix = buildConfusionMatrix(cases, results);

  if (matrix.length === 0) {
    return "## Confusion Matrix\n\nNo data.\n";
  }

  const rows = matrix
    .sort((a, b) => a.correctToolRate - b.correctToolRate)
    .map((entry) => {
      const correctPct = (entry.correctToolRate * 100).toFixed(0);
      const antiPct = (entry.antiPatternRate * 100).toFixed(0);
      const flag = entry.antiPatternRate > 0.5 ? " !!!" : entry.antiPatternRate > 0 ? " !" : "";
      return (
        `| ${entry.pair} | ${entry.toolA} | ${entry.toolB} | ` +
        `${entry.total} | ${correctPct}% | ${antiPct}%${flag} | ${entry.avgComposite.toFixed(3)} |`
      );
    });

  return `## Confusion Matrix

Shows correct-tool rate and anti-pattern rate per confusion pair. High anti-pattern rate (marked with !) indicates the model struggles to discriminate these tools.

| Pair | Tool A | Tool B | Cases | Correct Rate | Anti-Pattern Rate | Avg Composite |
|------|--------|--------|-------|-------------|-------------------|---------------|
${rows.join("\n")}
`;
}

function buildPerCaseTable(
  results: ToolConfusionEvalResult[],
  caseById: Map<string, ToolConfusionGoldenCase>,
): string {
  const rows = results.map((r) => {
    const c = caseById.get(r.caseId);
    const diff = c?.difficulty ?? "?";
    const statusIcon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "ERR";
    const firstTool = r.result.toolCalls[0]?.toolName ?? "(none)";
    const expectedTool = c?.expected.correctTool ?? "?";
    return (
      `| ${r.caseId} | ${statusIcon} | ${diff} | ${r.confusionPair} | ` +
      `${expectedTool} | ${firstTool} | ` +
      `${r.scores.correctToolPicked.toFixed(2)} | ` +
      `${r.scores.avoidedAntiPattern.toFixed(2)} | ` +
      `${r.scores.parameterCorrectness.toFixed(2)} | ` +
      `${r.scores.composite.toFixed(2)} | ${r.durationMs}ms |`
    );
  });

  return `## Per-Case Results

| Case | Status | Diff | Pair | Expected | Actual | Correct | Anti | Params | Composite | Latency |
|------|--------|------|------|----------|--------|---------|------|--------|-----------|---------|
${rows.join("\n")}
`;
}

function buildDifficultyAnalysis(
  results: ToolConfusionEvalResult[],
  caseById: Map<string, ToolConfusionGoldenCase>,
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
  results: ToolConfusionEvalResult[],
  caseById: Map<string, ToolConfusionGoldenCase>,
): string {
  const failures = results.filter((r) => r.status === "fail" || r.status === "error");
  if (failures.length === 0) {
    return "## Failed Cases\n\nNo failures.\n";
  }

  const details = failures.map((r) => {
    const c = caseById.get(r.caseId);
    const judge = r.judge;
    const judgeBlock = judge
      ? `  - **Judge**: disc=${judge.toolDiscrimination} reason=${judge.contextualReasoning} ` +
        `params=${judge.parameterPrecision} anti=${judge.antiPatternAwareness}\n` +
        `  - **Reasoning**: ${judge.reasoning}\n` +
        (judge.promptFixSuggestion ? `  - **Prompt fix**: ${judge.promptFixSuggestion}\n` : "")
      : "  - *(not judged)*\n";

    const agentCalls = r.result.toolCalls.length > 0
      ? r.result.toolCalls.map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`).join(", ")
      : "(no tool calls)";

    const expected = c?.expected;
    const expectedStr = expected
      ? `${expected.correctTool}${expected.acceptAlternatives?.length ? ` (or: ${expected.acceptAlternatives.join(", ")})` : ""}`
      : "(unknown)";

    return `### ${r.caseId} — ${r.confusionPair}

- **Status**: ${r.status}${r.error ? ` — ${r.error}` : ""}
- **Scores**: correct=${r.scores.correctToolPicked.toFixed(2)} anti=${r.scores.avoidedAntiPattern.toFixed(2)} params=${r.scores.parameterCorrectness.toFixed(2)} reason=${r.scores.reasoningQuality.toFixed(2)} comp=${r.scores.composite.toFixed(2)}
${judgeBlock}
- **Agent called**: ${agentCalls}
- **Expected tool**: ${expectedStr}
- **Rationale**: ${expected?.rationale ?? ""}
`;
  }).join("\n");

  return `## Failed Cases (${failures.length} total)\n\n${details}`;
}

function buildRecommendations(results: ToolConfusionEvalResult[]): string {
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
