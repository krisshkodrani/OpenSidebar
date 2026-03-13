/**
 * Perception eval markdown report generator.
 *
 * Produces structured reports for the v6 perception contract.
 */

import type {
  PerceptionEvalCase,
  PerceptionEvalResult,
} from "./types";

export interface PerceptionCritiqueData {
  cases: PerceptionEvalCase[];
  results: PerceptionEvalResult[];
}

export function buildPerceptionReport(data: PerceptionCritiqueData): string {
  const { cases, results } = data;
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const sections: string[] = [];

  sections.push("# Perception Eval Report\n");
  sections.push(`Generated: ${new Date().toISOString()}\n`);
  sections.push(buildSummary(results));
  sections.push(buildProviderComparison(results));
  sections.push(buildDimensionBreakdown(results, caseById));
  sections.push(buildFailedCases(results, caseById));
  sections.push(buildRecommendations(results, caseById));

  return sections.join("\n");
}

function buildSummary(results: PerceptionEvalResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errored = results.filter((r) => r.status === "error").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

  const avgSec = avg(results.map((r) => r.scores.sectionCompleteness));
  const avgBlk = avg(results.map((r) => r.scores.blockerDetection));
  const avgAff = avg(results.map((r) => r.scores.affordanceGrounding));
  const avgVis = avg(results.map((r) => r.scores.visualOnlyRecall));
  const avgHal = avg(results.map((r) => r.scores.hallucination));
  const avgComp = avg(results.map((r) => r.scores.composite));

  return `## Summary

| Metric | Value |
|--------|-------|
| Total results | ${total} |
| Pass rate | ${passRate}% (${passed}/${total}) |
| Failed | ${failed} |
| Errors | ${errored} |
| Avg section completeness | ${avgSec.toFixed(3)} |
| Avg blocker detection | ${avgBlk.toFixed(3)} |
| Avg affordance grounding | ${avgAff.toFixed(3)} |
| Avg visual-only recall | ${avgVis.toFixed(3)} |
| Avg hallucination | ${avgHal.toFixed(3)} |
| Avg composite | ${avgComp.toFixed(3)} |
`;
}

function buildProviderComparison(results: PerceptionEvalResult[]): string {
  const byProvider = new Map<
    string,
    {
      total: number;
      pass: number;
      avgLocation: number;
      avgGroundedness: number;
      avgLatency: number;
      avgComposite: number;
    }
  >();

  for (const r of results) {
    const pid = r.provider.providerId;
    if (!byProvider.has(pid)) {
      byProvider.set(pid, {
        total: 0,
        pass: 0,
        avgLocation: 0,
        avgGroundedness: 0,
        avgLatency: 0,
        avgComposite: 0,
      });
    }

    const rec = byProvider.get(pid)!;
    rec.total++;
    if (r.status === "pass") rec.pass++;
    rec.avgLatency += r.durationMs;
    rec.avgComposite += r.scores.composite;
    if (r.scores.judge) {
      rec.avgLocation += r.scores.judge.locationAccuracy;
      rec.avgGroundedness += r.scores.judge.groundedness;
    }
  }

  if (byProvider.size <= 1) {
    return "## Provider Comparison\n\nOnly one provider tested - no comparison available.\n";
  }

  const rows: string[] = [];
  for (const [pid, rec] of byProvider) {
    const passRate =
      rec.total > 0 ? ((rec.pass / rec.total) * 100).toFixed(1) : "0";
    const judged = results.filter(
      (r) => r.provider.providerId === pid && r.scores.judge,
    ).length;
    rows.push(
      `| ${pid} | ${passRate}% (${rec.pass}/${rec.total}) | ${judged > 0 ? (rec.avgLocation / judged).toFixed(1) : "-"} | ${judged > 0 ? (rec.avgGroundedness / judged).toFixed(1) : "-"} | ${(rec.avgComposite / rec.total).toFixed(3)} | ${Math.round(rec.avgLatency / rec.total)}ms |`,
    );
  }

  return `## Provider Comparison

| Provider | Pass Rate | Avg Location | Avg Groundedness | Avg Composite | Avg Latency |
|----------|-----------|--------------|------------------|---------------|-------------|
${rows.join("\n")}
`;
}

function buildDimensionBreakdown(
  results: PerceptionEvalResult[],
  caseById: Map<string, PerceptionEvalCase>,
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
      const rate =
        rec.total > 0 ? ((rec.pass / rec.total) * 100).toFixed(0) : "0";
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
  results: PerceptionEvalResult[],
  caseById: Map<string, PerceptionEvalCase>,
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
      const judgeBlock = judge
        ? `  - **Judge**: loc=${judge.locationAccuracy} chg=${judge.changeAccuracy} blk=${judge.blockerQuality} aff=${judge.affordanceUsefulness} gnd=${judge.groundedness} conc=${judge.conciseness}\n` +
          `  - **Reasoning**: ${judge.reasoning}\n` +
          (judge.promptFixSuggestion
            ? `  - **Prompt fix**: ${judge.promptFixSuggestion}\n`
            : "")
        : "  - *(not judged)*\n";

      const refSnippet =
        c?.reference.interpretation.slice(0, 300) ?? "(none)";
      const actSnippet = r.actual.interpretation.slice(0, 300) || "(empty)";

      return `### ${r.caseId} [${r.provider.providerId}]

- **Dimension**: ${dim}
- **Status**: ${r.status}${r.error ? ` - ${r.error}` : ""}
- **Scores**: sec=${r.scores.sectionCompleteness.toFixed(2)} blk=${r.scores.blockerDetection.toFixed(2)} aff=${r.scores.affordanceGrounding.toFixed(2)} vis=${r.scores.visualOnlyRecall.toFixed(2)} hal=${r.scores.hallucination.toFixed(2)} comp=${r.scores.composite.toFixed(2)}
${judgeBlock}
<details>
<summary>Reference output</summary>

\`\`\`
${refSnippet}
\`\`\`
</details>

<details>
<summary>Actual output</summary>

\`\`\`
${actSnippet}
\`\`\`
</details>
`;
    })
    .join("\n");

  return `## Failed Cases (${failures.length} total)\n\n${details}`;
}

function buildRecommendations(
  results: PerceptionEvalResult[],
  caseById: Map<string, PerceptionEvalCase>,
): string {
  const suggestions = new Map<
    string,
    { suggestion: string; dimension: string; count: number }
  >();

  for (const r of results) {
    const judge = r.scores.judge;
    if (!judge?.promptFixSuggestion) continue;
    const c = caseById.get(r.caseId);
    const dim = c?.metadata.dimension ?? "untagged";
    const key = `${dim}:${judge.promptFixSuggestion.slice(0, 100)}`;
    const existing = suggestions.get(key);
    if (existing) existing.count++;
    else {
      suggestions.set(key, {
        suggestion: judge.promptFixSuggestion,
        dimension: dim,
        count: 1,
      });
    }
  }

  const recs = Array.from(suggestions.values())
    .sort((a, b) => b.count - a.count)
    .map(
      (r, i) =>
        `${i + 1}. **[${r.count >= 3 ? "HIGH" : r.count >= 2 ? "MED" : "LOW"}]** (${r.dimension}, ${r.count}x) ${r.suggestion}`,
    );

  if (recs.length === 0) {
    return "## Perception Prompt Recommendations\n\nNo specific recommendations - all cases passed.\n";
  }

  return `## Perception Prompt Recommendations\n\n${recs.join("\n")}\n`;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
