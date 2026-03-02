/**
 * E2E multi-turn eval markdown report generator.
 *
 * Produces structured reports with:
 * - Summary table (pass rate, avg scores per dimension)
 * - Per-step breakdown with turn-by-turn match/mismatch
 * - Solution phase vs exploration phase accuracy
 * - Common wrong-tool substitutions
 */

import type { E2EGoldenCase, E2EMultiturnResult, E2ETurnScore } from "./e2e-types";

export interface E2EMultiturnCritiqueData {
  cases: E2EGoldenCase[];
  results: E2EMultiturnResult[];
}

export function buildE2EMultiturnReport(data: E2EMultiturnCritiqueData): string {
  const { cases, results } = data;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const sections: string[] = [];

  sections.push("# E2E Multi-Turn Eval Report\n");
  sections.push(`Generated: ${new Date().toISOString()}\n`);

  sections.push(buildSummary(results));
  sections.push(buildPerStepTable(results, caseById));
  sections.push(buildPhaseComparison(results));
  sections.push(buildWrongToolSubstitutions(results));
  sections.push(buildPerStepDetail(results, caseById));

  return sections.join("\n");
}

// ── Sections ─────────────────────────────────────────────────────────

function buildSummary(results: E2EMultiturnResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const totalTurns = results.reduce((s, r) => s + r.turnCount, 0);
  const avgTurnAcc = avg(results.map((r) => r.scores.turnAccuracy));
  const avgArgAcc = avg(results.map((r) => r.scores.argAccuracy));
  const avgSolAcc = avg(results.map((r) => r.scores.solutionAccuracy));
  const avgExpAcc = avg(results.map((r) => r.scores.explorationAccuracy));
  const avgComp = avg(results.map((r) => r.scores.composite));

  return `## Summary

| Metric | Value |
|--------|-------|
| Total cases | ${total} |
| Total turns | ${totalTurns} |
| Pass rate | ${passRate}% (${passed}/${total}) |
| Failed | ${failed} |
| Errors | ${errored} |
| Avg turn accuracy | ${avgTurnAcc.toFixed(3)} |
| Avg arg accuracy | ${avgArgAcc.toFixed(3)} |
| Avg solution accuracy | ${avgSolAcc.toFixed(3)} |
| Avg exploration accuracy | ${avgExpAcc.toFixed(3)} |
| Avg composite | ${avgComp.toFixed(3)} |
`;
}

function buildPerStepTable(
  results: E2EMultiturnResult[],
  caseById: Map<string, E2EGoldenCase>,
): string {
  const sorted = [...results].sort((a, b) => a.stepNumber - b.stepNumber);

  const rows = sorted.map((r) => {
    const c = caseById.get(r.caseId);
    const totalActions = c?.actions.total ?? "?";
    const statusIcon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "ERR";
    const s = r.scores;
    return (
      `| ${r.stepNumber} | ${statusIcon} | ${r.turnCount} | ` +
      `${s.turnAccuracy.toFixed(2)} | ${s.argAccuracy.toFixed(2)} | ` +
      `${s.solutionAccuracy.toFixed(2)} | ${s.explorationAccuracy.toFixed(2)} | ` +
      `${s.composite.toFixed(2)} | ${totalActions} | ${r.durationMs}ms |`
    );
  });

  return `## Per-Step Results

| Step | Status | Turns | Turn Acc | Arg Acc | Sol Acc | Exp Acc | Composite | Actions | Latency |
|------|--------|-------|----------|---------|---------|---------|-----------|---------|---------|
${rows.join("\n")}
`;
}

function buildPhaseComparison(results: E2EMultiturnResult[]): string {
  // Collect all turn scores across all results
  const allTurnScores = results.flatMap((r) => r.turnScores);
  const solutionTurns = allTurnScores.filter((t) => t.isSolutionPhase);
  const explorationTurns = allTurnScores.filter((t) => !t.isSolutionPhase);

  const solMatch = solutionTurns.length > 0
    ? solutionTurns.filter((t) => t.toolMatch).length / solutionTurns.length
    : 0;
  const expMatch = explorationTurns.length > 0
    ? explorationTurns.filter((t) => t.toolMatch).length / explorationTurns.length
    : 0;

  const solArgAvg = avgFromMatches(solutionTurns);
  const expArgAvg = avgFromMatches(explorationTurns);

  return `## Phase Comparison

| Phase | Turns | Tool Match Rate | Avg Arg Match |
|-------|-------|----------------|---------------|
| Exploration | ${explorationTurns.length} | ${(expMatch * 100).toFixed(1)}% | ${expArgAvg.toFixed(3)} |
| Solution | ${solutionTurns.length} | ${(solMatch * 100).toFixed(1)}% | ${solArgAvg.toFixed(3)} |
| Overall | ${allTurnScores.length} | ${allTurnScores.length > 0 ? ((allTurnScores.filter((t) => t.toolMatch).length / allTurnScores.length) * 100).toFixed(1) : "0.0"}% | ${avgFromMatches(allTurnScores).toFixed(3)} |
`;
}

function buildWrongToolSubstitutions(results: E2EMultiturnResult[]): string {
  // Map: "expected → actual" → count
  const subs = new Map<string, number>();

  for (const r of results) {
    for (const ts of r.turnScores) {
      if (!ts.toolMatch && ts.actualTool) {
        const key = `${ts.expectedTool} → ${ts.actualTool}`;
        subs.set(key, (subs.get(key) ?? 0) + 1);
      }
    }
  }

  const sorted = Array.from(subs.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  if (sorted.length === 0) {
    return "## Common Wrong-Tool Substitutions\n\nNo tool mismatches found.\n";
  }

  const rows = sorted.map(
    ([sub, count]) => `| ${sub} | ${count} |`,
  );

  return `## Common Wrong-Tool Substitutions

| Expected → Actual | Count |
|--------------------|-------|
${rows.join("\n")}
`;
}

function buildPerStepDetail(
  results: E2EMultiturnResult[],
  caseById: Map<string, E2EGoldenCase>,
): string {
  const sorted = [...results]
    .filter((r) => r.status !== "error" || r.turnScores.length > 0)
    .sort((a, b) => a.stepNumber - b.stepNumber);

  if (sorted.length === 0) {
    return "## Per-Step Turn Detail\n\nNo results to display.\n";
  }

  const details = sorted.map((r) => {
    const s = r.scores;
    const header =
      `### Step ${r.stepNumber} — ${r.caseId}\n\n` +
      `- **Status**: ${r.status}${r.error ? ` — ${r.error}` : ""}\n` +
      `- **Turns**: ${r.turnCount} | Turn Acc: ${s.turnAccuracy.toFixed(2)} | ` +
      `Sol: ${s.solutionAccuracy.toFixed(2)} | Exp: ${s.explorationAccuracy.toFixed(2)} | ` +
      `Composite: ${s.composite.toFixed(2)}\n`;

    // Turn-by-turn table
    const turnRows = r.turnScores.map((ts) => {
      const match = ts.toolMatch ? "Y" : "N";
      const phase = ts.isSolutionPhase ? "SOL" : "EXP";
      const actualStr = ts.actualTool ?? "(none)";
      const argsStr = ts.toolMatch ? ts.argsMatch.toFixed(2) : "-";
      return `| ${ts.turnNumber} | ${phase} | ${ts.expectedTool} | ${actualStr} | ${match} | ${argsStr} |`;
    });

    const turnTable =
      `\n<details>\n<summary>Turn-by-turn detail (${r.turnCount} turns)</summary>\n\n` +
      "| Turn | Phase | Expected | Actual | Match | Args |\n" +
      "|------|-------|----------|--------|-------|------|\n" +
      turnRows.join("\n") +
      "\n\n</details>\n";

    return header + turnTable;
  });

  return `## Per-Step Turn Detail\n\n${details.join("\n")}`;
}

// ── Helpers ──────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function avgFromMatches(turns: E2ETurnScore[]): number {
  const matches = turns.filter((t) => t.toolMatch);
  if (matches.length === 0) return 0;
  return matches.reduce((s, t) => s + t.argsMatch, 0) / matches.length;
}
