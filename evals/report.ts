/**
 * Actionable markdown report generator for eval critique results.
 *
 * Generates structured reports with:
 * - Summary table (pass rate, avg scores by pathology)
 * - Per-pathology breakdown with pass/fail counts
 * - Detailed failed case analysis with judge reasoning
 * - Ranked prompt improvement recommendations from judge suggestions
 */

import type { EvalCase, EvalResult, JudgeScore } from "./types";

export interface CritiqueData {
  cases: EvalCase[];
  results: EvalResult[];
  /** Map from caseId to EvalCase for fast lookup */
  caseById: Map<string, EvalCase>;
}

interface PathologyStats {
  total: number;
  pass: number;
  fail: number;
  error: number;
  avgToolSelection: number;
  avgAntiPattern: number;
  avgEfficiency: number;
}

interface PromptRecommendation {
  priority: "HIGH" | "MED" | "LOW";
  pathology: string;
  suggestion: string;
  occurrences: number;
}

/**
 * Build a full markdown critique report from eval data.
 */
export function buildCritiqueReport(data: CritiqueData): string {
  const { cases, results, caseById } = data;
  const sections: string[] = [];

  // Header
  sections.push(`# Eval Critique Report\n`);
  sections.push(`Generated: ${new Date().toISOString()}\n`);

  // Summary table
  sections.push(buildSummarySection(results));

  // Per-pathology breakdown
  sections.push(buildPathologySection(results, caseById));

  // Failed case details
  sections.push(buildFailedCaseSection(results, caseById));

  // Prompt improvement recommendations
  sections.push(buildRecommendationsSection(results, caseById));

  return sections.join("\n");
}

function buildSummarySection(results: EvalResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const judged = results.filter((r) => r.scores.judge);
  const avgToolSel = avg(judged.map((r) => r.scores.judge!.toolSelection));
  const avgParamAcc = avg(judged.map((r) => r.scores.judge!.parameterAccuracy ?? 0));
  const avgEff = avg(judged.map((r) => r.scores.judge!.efficiency));
  const avgAntiPat = avg(judged.map((r) => r.scores.judge!.antiPatternAvoidance ?? 0));
  const avgReason = avg(judged.map((r) => r.scores.judge!.reasoningQuality ?? 0));

  const avgNameMatch = avg(results.map((r) => r.scores.toolNameMatch));
  const avgParamMatch = avg(results.map((r) => r.scores.toolParamMatch));
  const avgSeqMatch = avg(results.map((r) => r.scores.sequenceMatch));

  return `## Summary

| Metric | Value |
|--------|-------|
| Total cases | ${total} |
| Pass rate | ${passRate}% (${passed}/${total}) |
| Failed | ${failed} |
| Errors | ${errored} |
| Avg tool name match | ${avgNameMatch.toFixed(3)} |
| Avg param match | ${avgParamMatch.toFixed(3)} |
| Avg sequence match | ${avgSeqMatch.toFixed(3)} |

### Judge Scores (${judged.length} cases judged)

| Dimension | Avg Score |
|-----------|-----------|
| Tool Selection | ${avgToolSel.toFixed(1)}/10 |
| Parameter Accuracy | ${avgParamAcc.toFixed(1)}/10 |
| Efficiency | ${avgEff.toFixed(1)}/10 |
| Anti-Pattern Avoidance | ${avgAntiPat.toFixed(1)}/10 |
| Reasoning Quality | ${avgReason.toFixed(1)}/10 |
`;
}

function buildPathologySection(results: EvalResult[], caseById: Map<string, EvalCase>): string {
  const byPathology = new Map<string, PathologyStats>();

  for (const result of results) {
    const evalCase = caseById.get(result.caseId);
    const pathology = evalCase?.metadata.pathology ?? "untagged";

    if (!byPathology.has(pathology)) {
      byPathology.set(pathology, {
        total: 0, pass: 0, fail: 0, error: 0,
        avgToolSelection: 0, avgAntiPattern: 0, avgEfficiency: 0,
      });
    }

    const stats = byPathology.get(pathology)!;
    stats.total++;
    if (result.status === "pass") stats.pass++;
    else if (result.status === "fail") stats.fail++;
    else stats.error++;

    if (result.scores.judge) {
      stats.avgToolSelection += result.scores.judge.toolSelection;
      stats.avgAntiPattern += result.scores.judge.antiPatternAvoidance ?? 0;
      stats.avgEfficiency += result.scores.judge.efficiency;
    }
  }

  // Compute averages
  for (const stats of byPathology.values()) {
    if (stats.total > 0) {
      stats.avgToolSelection /= stats.total;
      stats.avgAntiPattern /= stats.total;
      stats.avgEfficiency /= stats.total;
    }
  }

  const rows = Array.from(byPathology.entries())
    .sort((a, b) => a[1].pass / a[1].total - b[1].pass / b[1].total) // worst first
    .map(([pathology, stats]) => {
      const rate = stats.total > 0 ? ((stats.pass / stats.total) * 100).toFixed(0) : "0";
      return `| ${pathology} | ${stats.pass}/${stats.total} (${rate}%) | ${stats.fail} | ${stats.error} | ${stats.avgToolSelection.toFixed(1)} | ${stats.avgAntiPattern.toFixed(1)} |`;
    })
    .join("\n");

  return `## Per-Pathology Breakdown

| Pathology | Pass Rate | Fails | Errors | Avg ToolSel | Avg AntiPat |
|-----------|-----------|-------|--------|-------------|-------------|
${rows}
`;
}

function buildFailedCaseSection(results: EvalResult[], caseById: Map<string, EvalCase>): string {
  const failures = results.filter((r) => r.status === "fail" || r.status === "error");

  if (failures.length === 0) {
    return "## Failed Cases\n\nNo failures.\n";
  }

  const details = failures.slice(0, 20).map((result) => {
    const evalCase = caseById.get(result.caseId);
    const pathology = evalCase?.metadata.pathology ?? "untagged";
    const query = evalCase?.metadata.query ?? "unknown";
    const url = evalCase?.metadata.url ?? "unknown";

    const expectedTools = evalCase?.expected.toolCalls
      .map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`)
      .join(", ") ?? "(none)";
    const actualTools = result.actual.toolCalls
      .map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`)
      .join(", ") || "(none)";

    const judge = result.scores.judge;
    const judgeBlock = judge
      ? `  - **Judge reasoning**: ${judge.reasoning}\n` +
        `  - **Scores**: toolSel=${judge.toolSelection} paramAcc=${judge.parameterAccuracy ?? 0} eff=${judge.efficiency} antiPat=${judge.antiPatternAvoidance ?? 0} reasoning=${judge.reasoningQuality ?? 0}\n` +
        (judge.promptFixSuggestion ? `  - **Prompt fix**: ${judge.promptFixSuggestion}\n` : "")
      : "  - *(not judged)*\n";

    return `### ${result.caseId}

- **Pathology**: ${pathology}
- **Status**: ${result.status}${result.error ? ` — ${result.error}` : ""}
- **Query**: ${query}
- **URL**: ${url}
- **Expected**: ${expectedTools}
- **Actual**: ${actualTools}
- **Scores**: names=${result.scores.toolNameMatch.toFixed(2)} params=${result.scores.toolParamMatch.toFixed(2)} seq=${result.scores.sequenceMatch.toFixed(2)}
${judgeBlock}`;
  }).join("\n");

  return `## Failed Cases (${failures.length} total)\n\n${details}`;
}

function buildRecommendationsSection(results: EvalResult[], caseById: Map<string, EvalCase>): string {
  // Collect prompt fix suggestions from judge, grouped by pathology
  const suggestionMap = new Map<string, { suggestion: string; pathology: string; count: number }>();

  for (const result of results) {
    const judge = result.scores.judge;
    if (!judge?.promptFixSuggestion) continue;

    const evalCase = caseById.get(result.caseId);
    const pathology = evalCase?.metadata.pathology ?? "untagged";
    const key = `${pathology}:${judge.promptFixSuggestion.slice(0, 100)}`;

    const existing = suggestionMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      suggestionMap.set(key, {
        suggestion: judge.promptFixSuggestion,
        pathology,
        count: 1,
      });
    }
  }

  // Build ranked recommendations
  const recommendations: PromptRecommendation[] = Array.from(suggestionMap.values())
    .map((entry) => ({
      priority: entry.count >= 3 ? "HIGH" as const : entry.count >= 2 ? "MED" as const : "LOW" as const,
      pathology: entry.pathology,
      suggestion: entry.suggestion,
      occurrences: entry.count,
    }))
    .sort((a, b) => {
      const priorityOrder = { HIGH: 0, MED: 1, LOW: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority] || b.occurrences - a.occurrences;
    });

  // Also add generic recommendations from failure patterns
  const failedByPathology = new Map<string, number>();
  for (const result of results) {
    if (result.status !== "fail") continue;
    const evalCase = caseById.get(result.caseId);
    const pathology = evalCase?.metadata.pathology ?? "untagged";
    failedByPathology.set(pathology, (failedByPathology.get(pathology) ?? 0) + 1);
  }

  for (const [pathology, count] of failedByPathology) {
    const hasJudgeSuggestion = recommendations.some((r) => r.pathology === pathology);
    if (!hasJudgeSuggestion && count > 0) {
      recommendations.push({
        priority: count >= 2 ? "MED" : "LOW",
        pathology,
        suggestion: `${count} failures in "${pathology}" cases — add explicit anti-pattern instructions to system prompt for this behavior.`,
        occurrences: count,
      });
    }
  }

  if (recommendations.length === 0) {
    return "## Prompt Improvement Recommendations\n\nNo specific recommendations — all cases passed.\n";
  }

  const recLines = recommendations
    .map((r, i) => `${i + 1}. **[${r.priority}]** (${r.pathology}, ${r.occurrences}x) ${r.suggestion}`)
    .join("\n");

  return `## Prompt Improvement Recommendations

${recLines}
`;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
