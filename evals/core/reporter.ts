/**
 * Results Reporter
 *
 * Formats and outputs evaluation results in various formats.
 */

import type {
  EvaluationResult,
  EvaluationSummary,
  ReportConfig,
  ReportFormat,
  ComparisonResult,
} from "./types.js";

/**
 * Generate report in specified format
 */
export function generateReport(
  results: EvaluationResult[],
  summary: EvaluationSummary,
  config: ReportConfig,
): string {
  switch (config.format) {
    case "json":
      return generateJSONReport(results, summary, config);
    case "markdown":
      return generateMarkdownReport(results, summary, config);
    case "html":
      return generateHTMLReport(results, summary, config);
    case "csv":
      return generateCSVReport(results, summary, config);
    default:
      throw new Error(`Unknown report format: ${config.format}`);
  }
}

/**
 * Generate JSON report
 */
function generateJSONReport(
  results: EvaluationResult[],
  summary: EvaluationSummary,
  config: ReportConfig,
): string {
  const report = {
    timestamp: new Date().toISOString(),
    summary,
    results: config.include_details
      ? results
      : results.map((r) => ({
          case_id: r.case_id,
          status: r.status,
          duration_ms: r.duration_ms,
          metrics: r.metrics,
        })),
  };

  return JSON.stringify(report, null, 2);
}

/**
 * Generate Markdown report
 */
function generateMarkdownReport(
  results: EvaluationResult[],
  summary: EvaluationSummary,
  config: ReportConfig,
): string {
  const lines: string[] = [];

  // Header
  lines.push("# OpenSidebar Evaluation Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total Cases**: ${summary.total_cases}`);
  lines.push(
    `- **Passed**: ${summary.passed} (${((summary.passed / summary.total_cases) * 100).toFixed(1)}%)`,
  );
  lines.push(
    `- **Failed**: ${summary.failed} (${((summary.failed / summary.total_cases) * 100).toFixed(1)}%)`,
  );
  lines.push(`- **Errors**: ${summary.errors}`);
  lines.push(`- **Average Duration**: ${summary.avg_duration_ms}ms`);
  lines.push("");

  // Metrics
  if (summary.avg_tool_accuracy !== undefined) {
    lines.push(
      `- **Average Tool Accuracy**: ${(summary.avg_tool_accuracy * 100).toFixed(1)}%`,
    );
  }
  if (summary.avg_text_similarity !== undefined) {
    lines.push(
      `- **Average Text Similarity**: ${(summary.avg_text_similarity * 100).toFixed(1)}%`,
    );
  }
  if (summary.avg_judge_score !== undefined) {
    lines.push(
      `- **Average Judge Score**: ${summary.avg_judge_score.toFixed(1)}/10`,
    );
  }
  lines.push("");

  // By Category
  if (Object.keys(summary.by_category).length > 0) {
    lines.push("### By Category");
    lines.push("");
    for (const [category, stats] of Object.entries(summary.by_category)) {
      const total = stats.passed + stats.failed;
      const rate = ((stats.passed / total) * 100).toFixed(1);
      lines.push(`- **${category}**: ${stats.passed}/${total} (${rate}%)`);
    }
    lines.push("");
  }

  // By Difficulty
  if (Object.keys(summary.by_difficulty).length > 0) {
    lines.push("### By Difficulty");
    lines.push("");
    for (const [difficulty, stats] of Object.entries(summary.by_difficulty)) {
      const total = stats.passed + stats.failed;
      const rate = ((stats.passed / total) * 100).toFixed(1);
      lines.push(`- **${difficulty}**: ${stats.passed}/${total} (${rate}%)`);
    }
    lines.push("");
  }

  // Detailed Results
  if (config.include_details) {
    lines.push("## Detailed Results");
    lines.push("");

    for (const result of results) {
      const icon =
        result.status === "passed"
          ? "✅"
          : result.status === "failed"
            ? "❌"
            : "⚠️";
      lines.push(`### ${icon} ${result.case_id}`);
      lines.push("");
      lines.push(`- **Status**: ${result.status}`);
      lines.push(`- **Duration**: ${result.duration_ms}ms`);
      lines.push("");

      if (result.metrics.tool_accuracy !== undefined) {
        lines.push(
          `- **Tool Accuracy**: ${(result.metrics.tool_accuracy * 100).toFixed(1)}%`,
        );
      }
      if (result.metrics.text_similarity !== undefined) {
        lines.push(
          `- **Text Similarity**: ${(result.metrics.text_similarity * 100).toFixed(1)}%`,
        );
      }
      if (result.metrics.outcome_match !== undefined) {
        lines.push(
          `- **Outcome Match**: ${result.metrics.outcome_match ? "✓" : "✗"}`,
        );
      }
      if (result.metrics.judge_score !== undefined) {
        lines.push(
          `- **Judge Score**: ${result.metrics.judge_score.toFixed(1)}/10 (${result.metrics.judge_pass ? "PASS" : "FAIL"})`,
        );
      }
      lines.push("");

      // Judge verdict details
      if (result.details.judge_verdict) {
        const v = result.details.judge_verdict;
        lines.push("**Judge Verdict**:");
        lines.push(`- Task Completion: ${v.task_completion}/10`);
        lines.push(`- Tool Selection: ${v.tool_selection}/10`);
        lines.push(`- Efficiency: ${v.efficiency}/10`);
        lines.push(`- Reasoning: ${v.reasoning}`);
        if (v.issues.length > 0) {
          lines.push("- Issues:");
          for (const issue of v.issues) {
            lines.push(`  - ${issue}`);
          }
        }
        lines.push("");
      }

      // Errors
      if (result.details.errors.length > 0) {
        lines.push("**Errors**:");
        for (const error of result.details.errors) {
          lines.push(`- ${error}`);
        }
        lines.push("");
      }

      // Analysis
      if (config.include_analysis && result.analysis) {
        lines.push("**Failure Analysis**:");
        lines.push(`- **Type**: ${result.analysis.failure_type}`);
        lines.push(`- **Severity**: ${result.analysis.severity}`);
        lines.push(`- **Root Cause**: ${result.analysis.root_cause}`);
        if (result.analysis.suggestions.length > 0) {
          lines.push("- **Suggestions**:");
          for (const suggestion of result.analysis.suggestions) {
            lines.push(`  - ${suggestion}`);
          }
        }
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Generate HTML report
 */
function generateHTMLReport(
  results: EvaluationResult[],
  summary: EvaluationSummary,
  config: ReportConfig,
): string {
  // Simple HTML template
  const markdown = generateMarkdownReport(results, summary, config);

  return `<!DOCTYPE html>
<html>
<head>
  <title>OpenSidebar Evaluation Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    h2 { color: #666; border-bottom: 2px solid #eee; padding-bottom: 10px; }
    .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .passed { color: #28a745; }
    .failed { color: #dc3545; }
    .error { color: #ffc107; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #f8f9fa; }
    .metric { display: inline-block; margin: 5px 10px; padding: 5px 10px; background: #e9ecef; border-radius: 4px; }
  </style>
</head>
<body>
  <pre>${markdown.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body>
</html>`;
}

/**
 * Generate CSV report
 */
function generateCSVReport(
  results: EvaluationResult[],
  summary: EvaluationSummary,
  config: ReportConfig,
): string {
  const headers = [
    "case_id",
    "status",
    "duration_ms",
    "tool_accuracy",
    "text_similarity",
    "outcome_match",
    "steps_taken",
    "errors",
  ];

  const rows = results.map((r) => [
    r.case_id,
    r.status,
    r.duration_ms,
    r.metrics.tool_accuracy ?? "",
    r.metrics.text_similarity ?? "",
    r.metrics.outcome_match ?? "",
    r.metrics.steps_taken,
    r.details.errors.join("; "),
  ]);

  return [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
  ].join("\n");
}

/**
 * Generate comparison report between two runs
 */
export function generateComparisonReport(comparison: ComparisonResult): string {
  const lines: string[] = [];

  lines.push("# Evaluation Comparison Report");
  lines.push("");
  lines.push(`**Baseline**: ${comparison.baseline_id}`);
  lines.push(`**Current**: ${comparison.current_id}`);
  lines.push("");

  // Overall change
  lines.push("## Overall Changes");
  lines.push("");
  const successChange = comparison.overall_change.success_rate_delta;
  const successIcon = successChange >= 0 ? "📈" : "📉";
  lines.push(
    `${successIcon} **Success Rate Change**: ${successChange > 0 ? "+" : ""}${(successChange * 100).toFixed(1)}%`,
  );

  const durationChange = comparison.overall_change.avg_duration_delta_ms;
  const durationIcon = durationChange <= 0 ? "⚡" : "🐢";
  lines.push(
    `${durationIcon} **Duration Change**: ${durationChange > 0 ? "+" : ""}${durationChange}ms`,
  );
  lines.push("");

  // Regressions
  if (comparison.regressions.length > 0) {
    lines.push("## ⚠️ Regressions");
    lines.push("");
    for (const regression of comparison.regressions) {
      lines.push(
        `- **${regression.case_id}**: ${regression.change_description}`,
      );
    }
    lines.push("");
  }

  // Improvements
  if (comparison.improvements.length > 0) {
    lines.push("## ✅ Improvements");
    lines.push("");
    for (const improvement of comparison.improvements) {
      lines.push(
        `- **${improvement.case_id}**: ${improvement.improvement_description}`,
      );
    }
    lines.push("");
  }

  // Unchanged
  if (comparison.unchanged.length > 0) {
    lines.push(`## ➖ Unchanged (${comparison.unchanged.length} cases)`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Print report to console
 */
export function printToConsole(
  results: EvaluationResult[],
  summary: EvaluationSummary,
): void {
  console.log("\n" + "=".repeat(60));
  console.log("OpenSidebar Evaluation Results");
  console.log("=".repeat(60));
  console.log();

  console.log(`Total Cases: ${summary.total_cases}`);
  console.log(
    `Passed: ${summary.passed} (${((summary.passed / summary.total_cases) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Failed: ${summary.failed} (${((summary.failed / summary.total_cases) * 100).toFixed(1)}%)`,
  );
  console.log(`Errors: ${summary.errors}`);
  console.log(`Avg Duration: ${summary.avg_duration_ms}ms`);

  if (summary.avg_tool_accuracy !== undefined) {
    console.log(
      `Avg Tool Accuracy: ${(summary.avg_tool_accuracy * 100).toFixed(1)}%`,
    );
  }
  if (summary.avg_text_similarity !== undefined) {
    console.log(
      `Avg Text Similarity: ${(summary.avg_text_similarity * 100).toFixed(1)}%`,
    );
  }
  if (summary.avg_judge_score !== undefined) {
    console.log(
      `Avg Judge Score: ${summary.avg_judge_score.toFixed(1)}/10`,
    );
  }

  console.log();
  console.log("-".repeat(60));

  // Per-case judge results
  const judgedResults = results.filter((r) => r.metrics.judge_score !== undefined);
  if (judgedResults.length > 0) {
    console.log("\nJudge Results:");
    for (const result of judgedResults) {
      const passIcon = result.metrics.judge_pass ? "PASS" : "FAIL";
      console.log(
        `  [${passIcon}] ${result.case_id} — score: ${result.metrics.judge_score!.toFixed(1)}/10`,
      );
    }
    console.log();
    console.log("-".repeat(60));
  }

  // Failed cases
  const failed = results.filter((r) => r.status !== "passed");
  if (failed.length > 0) {
    console.log("\nFailed Cases:");
    for (const result of failed) {
      const icon = result.status === "failed" ? "FAIL" : "ERR";
      console.log(`  [${icon}] ${result.case_id}`);
      if (result.details.errors.length > 0) {
        console.log(`     Error: ${result.details.errors[0]}`);
      }
      if (result.details.judge_verdict) {
        console.log(`     Judge: ${result.details.judge_verdict.reasoning}`);
      }
    }
  }

  console.log();
  console.log("=".repeat(60));
}
