/**
 * E2E eval markdown report generator.
 *
 * Produces structured reports with:
 * - Summary table (pass rate, avg scores per dimension)
 * - Per-step breakdown (which dimensions failed)
 * - Difficulty analysis (easy/medium/hard by action count)
 * - Common failure patterns
 * - Prompt recommendations from judge suggestions
 */

import type { E2EGoldenCase, E2EEvalResult, E2EJudgeScore } from "./e2e-types";

export interface E2ECritiqueData {
  cases: E2EGoldenCase[];
  results: E2EEvalResult[];
}

export function buildE2EReport(data: E2ECritiqueData): string {
  const { cases, results } = data;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const sections: string[] = [];

  sections.push("# E2E Eval Report\n");
  sections.push(`Generated: ${new Date().toISOString()}\n`);

  sections.push(buildSummary(results));
  sections.push(buildPerStepTable(results, caseById));
  sections.push(buildDifficultyAnalysis(results, caseById));
  sections.push(buildFailurePatterns(results, caseById));
  sections.push(buildFailedCases(results, caseById));
  sections.push(buildRecommendations(results));

  return sections.join("\n");
}

// ── Sections ─────────────────────────────────────────────────────────

function buildSummary(results: E2EEvalResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const avgCode = avg(results.map((r) => r.scores.codeDiscovery));
  const avgTool = avg(results.map((r) => r.scores.toolSelection));
  const avgSol = avg(results.map((r) => r.scores.solutionActions));
  const avgEff = avg(results.map((r) => r.scores.actionEfficiency));
  const avgTgt = avg(results.map((r) => r.scores.elementTargeting));
  const avgComp = avg(results.map((r) => r.scores.composite));

  return `## Summary

| Metric | Value |
|--------|-------|
| Total cases | ${total} |
| Pass rate | ${passRate}% (${passed}/${total}) |
| Failed | ${failed} |
| Errors | ${errored} |
| Avg code discovery | ${avgCode.toFixed(3)} |
| Avg tool selection | ${avgTool.toFixed(3)} |
| Avg solution actions | ${avgSol.toFixed(3)} |
| Avg action efficiency | ${avgEff.toFixed(3)} |
| Avg element targeting | ${avgTgt.toFixed(3)} |
| Avg composite | ${avgComp.toFixed(3)} |
`;
}

function buildPerStepTable(
  results: E2EEvalResult[],
  caseById: Map<string, E2EGoldenCase>,
): string {
  const sorted = [...results].sort((a, b) => a.stepNumber - b.stepNumber);

  const rows = sorted.map((r) => {
    const c = caseById.get(r.caseId);
    const actions = c?.actions.total ?? "?";
    const statusIcon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "ERR";
    return (
      `| ${r.stepNumber} | ${statusIcon} | ${r.scores.codeDiscovery.toFixed(2)} | ` +
      `${r.scores.solutionActions.toFixed(2)} | ${r.scores.toolSelection.toFixed(2)} | ` +
      `${r.scores.elementTargeting.toFixed(2)} | ${r.scores.actionEfficiency.toFixed(2)} | ` +
      `${r.scores.composite.toFixed(2)} | ${actions} | ${r.durationMs}ms |`
    );
  });

  return `## Per-Step Results

| Step | Status | Code | Solution | Tools | Targeting | Efficiency | Composite | Actions | Latency |
|------|--------|------|----------|-------|-----------|------------|-----------|---------|---------|
${rows.join("\n")}
`;
}

function buildDifficultyAnalysis(
  results: E2EEvalResult[],
  caseById: Map<string, E2EGoldenCase>,
): string {
  const buckets: Record<string, { total: number; pass: number; avgComp: number }> = {
    "easy (1-10)": { total: 0, pass: 0, avgComp: 0 },
    "medium (11-30)": { total: 0, pass: 0, avgComp: 0 },
    "hard (31+)": { total: 0, pass: 0, avgComp: 0 },
  };

  for (const r of results) {
    const c = caseById.get(r.caseId);
    const actions = c?.actions.total ?? 0;
    const bucket =
      actions <= 10 ? "easy (1-10)" : actions <= 30 ? "medium (11-30)" : "hard (31+)";
    buckets[bucket].total++;
    if (r.status === "pass") buckets[bucket].pass++;
    buckets[bucket].avgComp += r.scores.composite;
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

function buildFailurePatterns(
  results: E2EEvalResult[],
  caseById: Map<string, E2EGoldenCase>,
): string {
  // Which tools are most often wrong?
  const toolMisses: Record<string, number> = {};
  // Which elements most often mis-targeted?
  const elementMisses: Record<string, number> = {};

  for (const r of results) {
    if (r.status === "pass") continue;
    const c = caseById.get(r.caseId);
    if (!c) continue;

    // Tool misses
    const expectedTools = new Set(c.actions.sequence.map((a) => a.tool));
    const actualTools = new Set(r.actual.toolCalls.map((tc) => tc.toolName));
    for (const tool of expectedTools) {
      if (!actualTools.has(tool)) {
        toolMisses[tool] = (toolMisses[tool] || 0) + 1;
      }
    }

    // Element targeting misses
    const { codeInputId, submitButtonId } = c.solution;
    const targetsInput = r.actual.toolCalls.some((tc) => Number(tc.args.id) === codeInputId);
    const targetsSubmit = r.actual.toolCalls.some((tc) => Number(tc.args.id) === submitButtonId);
    if (!targetsInput) elementMisses[`codeInput [${codeInputId}]`] = (elementMisses[`codeInput [${codeInputId}]`] || 0) + 1;
    if (!targetsSubmit) elementMisses[`submitBtn [${submitButtonId}]`] = (elementMisses[`submitBtn [${submitButtonId}]`] || 0) + 1;
  }

  const toolRows = Object.entries(toolMisses)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => `| ${tool} | ${count} |`);

  const elemRows = Object.entries(elementMisses)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([elem, count]) => `| ${elem} | ${count} |`);

  const failures = results.filter((r) => r.status !== "pass").length;
  if (failures === 0) {
    return "## Failure Patterns\n\nNo failures to analyze.\n";
  }

  return `## Failure Patterns

### Missing Tools (expected but not called)

| Tool | Misses |
|------|--------|
${toolRows.length > 0 ? toolRows.join("\n") : "| (none) | 0 |"}

### Missed Element Targets

| Element | Misses |
|---------|--------|
${elemRows.length > 0 ? elemRows.join("\n") : "| (none) | 0 |"}
`;
}

function buildFailedCases(
  results: E2EEvalResult[],
  caseById: Map<string, E2EGoldenCase>,
): string {
  const failures = results.filter(
    (r) => r.status === "fail" || r.status === "error",
  );
  if (failures.length === 0) {
    return "## Failed Cases\n\nNo failures.\n";
  }

  const details = failures
    .sort((a, b) => a.stepNumber - b.stepNumber)
    .slice(0, 20)
    .map((r) => {
      const c = caseById.get(r.caseId);

      const judge = r.scores.judge;
      const judgeBlock = judge
        ? `  - **Judge**: puzzle=${judge.puzzleSolving} code=${judge.codeIdentification} ` +
          `action=${judge.actionPrecision} distract=${judge.distractorAvoidance}\n` +
          `  - **Reasoning**: ${judge.reasoning}\n` +
          (judge.promptFixSuggestion
            ? `  - **Prompt fix**: ${judge.promptFixSuggestion}\n`
            : "")
        : "  - *(not judged)*\n";

      // Expected vs actual tool calls
      const expectedCalls = c?.actions.sequence
        .map((a) => `${a.tool}(${JSON.stringify(a.args)})`)
        .join(", ") ?? "(unknown)";
      const actualCalls = r.actual.toolCalls.length > 0
        ? r.actual.toolCalls
            .map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`)
            .join(", ")
        : "(no tool calls)";

      return `### Step ${r.stepNumber} — ${r.caseId}

- **Status**: ${r.status}${r.error ? ` — ${r.error}` : ""}
- **Scores**: code=${r.scores.codeDiscovery.toFixed(2)} sol=${r.scores.solutionActions.toFixed(2)} tool=${r.scores.toolSelection.toFixed(2)} tgt=${r.scores.elementTargeting.toFixed(2)} eff=${r.scores.actionEfficiency.toFixed(2)} comp=${r.scores.composite.toFixed(2)}
${judgeBlock}
<details>
<summary>Expected actions (${c?.actions.total ?? "?"})</summary>

\`\`\`
${expectedCalls}
\`\`\`
</details>

<details>
<summary>Actual actions (${r.actual.toolCalls.length})</summary>

\`\`\`
${actualCalls}
\`\`\`
</details>
`;
    })
    .join("\n");

  return `## Failed Cases (${failures.length} total)\n\n${details}`;
}

function buildRecommendations(results: E2EEvalResult[]): string {
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
      suggestions.set(key, {
        suggestion: judge.promptFixSuggestion,
        count: 1,
      });
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
