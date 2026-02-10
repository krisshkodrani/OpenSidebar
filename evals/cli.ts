/**
 * CLI Entry Point
 *
 * Command-line interface for running evaluations and managing golden dataset.
 */

// Import Chrome mocks FIRST before any other imports
import "./utils/chrome-mock.js";

import { parseArgs } from "util";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  loadAllGoldenCases,
  filterGoldenCases,
  getGoldenDatasetStats,
} from "./core/loader.js";
import { EvaluationRunner, runEvaluations } from "./core/runner.js";
import { calculateSummary } from "./core/metrics.js";
import {
  generateReport,
  printToConsole,
  generateComparisonReport,
} from "./core/reporter.js";
import {
  analyzeFailure,
  analyzeMultipleFailures,
} from "./optimizer/analyzer.js";
import {
  generatePromptSuggestions,
  applySuggestion,
  rankSuggestions,
} from "./optimizer/suggester.js";
import {
  trackImprovement,
  loadImprovementHistory,
  getImprovementStats,
  generateImprovementReport,
  savePromptVersion,
  loadPromptVersion,
} from "./optimizer/tracker.js";
import type {
  EvaluationResult,
  EvaluationConfig,
  ComparisonResult,
} from "./core/types.js";

const HISTORY_DIR = join(import.meta.dir, "golden", "history");

const usage = `
QSidebar Evaluation System

Usage:
  bun evals [options]

Commands:
  --run, -r              Run evaluations (default if no command specified)
  --analyze, -a          Analyze failures and generate insights
  --suggest, -s          Generate prompt improvement suggestions
  --compare <id>         Compare with baseline run
  --stats                Show golden dataset statistics
  --history              Show improvement history

Options:
  --category <list>      Filter by categories (comma-separated)
  --tag <list>           Filter by tags (comma-separated)
  --difficulty <list>    Filter by difficulty: easy,medium,hard
  --id <list>            Filter by case IDs (comma-separated)
  --format <format>     Output format: json, markdown, html, csv (default: console)
  --output <path>        Output file path
  --mock                 Use mock mode (no real LLM calls)
  --no-judge             Disable LLM-as-Judge evaluation (faster, no extra API calls)
  --timeout <ms>         Timeout per case in ms (default: 60000)
  --fail-on-regression   Exit with error if regressions found
  --help, -h             Show this help message

Examples:
  bun evals                              # Run all evaluations
  bun evals --tag navigation,search      # Run only navigation and search tests
  bun evals --difficulty easy            # Run only easy tests
  bun evals --analyze --suggest          # Analyze failures and suggest improvements
  bun evals --compare baseline           # Compare with baseline
  bun evals --format markdown --output report.md
`;

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      run: { type: "boolean", short: "r" },
      analyze: { type: "boolean", short: "a" },
      suggest: { type: "boolean", short: "s" },
      compare: { type: "string" },
      stats: { type: "boolean" },
      history: { type: "boolean" },
      category: { type: "string" },
      tag: { type: "string" },
      difficulty: { type: "string" },
      id: { type: "string" },
      format: { type: "string" },
      output: { type: "string" },
      mock: { type: "boolean" },
      "no-judge": { type: "boolean" },
      timeout: { type: "string" },
      "fail-on-regression": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(usage);
    process.exit(0);
  }

  try {
    // Show stats
    if (values.stats) {
      await showStats();
      return;
    }

    // Show history
    if (values.history) {
      await showHistory();
      return;
    }

    // Analyze and suggest
    if (values.analyze || values.suggest) {
      await runAnalysis(values);
      return;
    }

    // Compare
    if (values.compare) {
      await runComparison(values.compare);
      return;
    }

    // Default: run evaluations
    await runEvaluationsCommand(values);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Show golden dataset statistics
 */
async function showStats() {
  const cases = await loadAllGoldenCases();
  const stats = getGoldenDatasetStats(cases);

  console.log("\n" + "=".repeat(60));
  console.log("Golden Dataset Statistics");
  console.log("=".repeat(60));
  console.log();
  console.log(`Total Cases: ${stats.total}`);
  console.log();

  console.log("By Difficulty:");
  for (const [diff, count] of Object.entries(stats.byDifficulty)) {
    console.log(`  ${diff}: ${count}`);
  }
  console.log();

  console.log("By Tag:");
  for (const [tag, count] of Object.entries(stats.byTag)) {
    console.log(`  ${tag}: ${count}`);
  }
  console.log();

  if (Object.keys(stats.byCategory).length > 0) {
    console.log("By Category:");
    for (const [cat, count] of Object.entries(stats.byCategory)) {
      console.log(`  ${cat}: ${count}`);
    }
    console.log();
  }

  console.log("=".repeat(60));
}

/**
 * Show improvement history
 */
async function showHistory() {
  const report = await generateImprovementReport();
  console.log(report);
}

/**
 * Ensure history directory exists
 */
function ensureHistoryDir() {
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

/**
 * Save results to history
 */
async function saveResults(results: EvaluationResult[], summary: any) {
  ensureHistoryDir();

  const data = JSON.stringify({ results, summary, timestamp: new Date().toISOString() }, null, 2);

  // Save as latest
  const latestPath = join(HISTORY_DIR, "latest-results.json");
  await Bun.write(latestPath, data);

  // Save timestamped copy
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const tsPath = join(HISTORY_DIR, `results-${ts}.json`);
  await Bun.write(tsPath, data);

  return { latestPath, tsPath };
}

/**
 * Load latest results from history
 */
async function loadLatestResults(): Promise<{ results: EvaluationResult[]; summary: any } | null> {
  const latestPath = join(HISTORY_DIR, "latest-results.json");
  if (!existsSync(latestPath)) {
    return null;
  }
  const file = Bun.file(latestPath);
  return JSON.parse(await file.text());
}

/**
 * Load results by timestamp ID
 */
async function loadResultsById(id: string): Promise<{ results: EvaluationResult[]; summary: any } | null> {
  // Try exact match first
  const exactPath = join(HISTORY_DIR, `results-${id}.json`);
  if (existsSync(exactPath)) {
    const file = Bun.file(exactPath);
    return JSON.parse(await file.text());
  }

  // Try prefix match
  const { readdirSync } = await import("fs");
  const files = readdirSync(HISTORY_DIR).filter(
    (f) => f.startsWith(`results-${id}`) && f.endsWith(".json"),
  );

  if (files.length === 0) {
    return null;
  }

  const file = Bun.file(join(HISTORY_DIR, files[0]));
  return JSON.parse(await file.text());
}

/**
 * Run evaluations
 */
async function runEvaluationsCommand(values: any) {
  // Load and filter cases
  let cases = await loadAllGoldenCases();

  if (cases.length === 0) {
    console.log("No golden cases found. Create some in evals/golden/cases/");
    return;
  }

  // Apply filters
  cases = filterGoldenCases(cases, {
    tags: values.tag?.split(","),
    difficulty: values.difficulty?.split(","),
    category: values.category?.split(","),
    ids: values.id?.split(","),
  });

  if (cases.length === 0) {
    console.log("No cases match the specified filters.");
    return;
  }

  console.log(`\nRunning ${cases.length} evaluation(s)...\n`);

  // Create runner
  const runner = new EvaluationRunner({
    mockMode: values.mock,
    enableJudge: !values["no-judge"],
    timeoutMs: values.timeout ? parseInt(values.timeout) : 60000,
    onProgress: (completed, total, current) => {
      process.stdout.write(`\rProgress: ${completed}/${total} (${current})`);
    },
  });

  // Initialize runner (loads API keys from .env)
  try {
    await runner.initialize();
  } catch (error) {
    console.error(
      "\nFailed to initialize:",
      error instanceof Error ? error.message : error,
    );
    console.log("\nMake sure you have set your API keys in .env file:");
    console.log("   CEREBRAS_API_KEY=your_key_here");
    console.log("   OPENROUTER_API_KEY=your_key_here");
    console.log("\n   Or use --mock flag to run in mock mode.");
    process.exit(1);
  }

  // Run evaluations
  const startTime = Date.now();
  const results: EvaluationResult[] = [];

  for (const testCase of cases) {
    const result = await runner.runCase(testCase);
    results.push(result);
  }

  const duration = Date.now() - startTime;
  process.stdout.write("\r" + " ".repeat(50) + "\r"); // Clear progress line

  // Calculate summary
  const summary = {
    total_cases: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    errors: results.filter((r) => r.status === "error").length,
    avg_duration_ms: Math.round(duration / results.length),
    avg_tool_accuracy: undefined as number | undefined,
    avg_text_similarity: undefined as number | undefined,
    avg_judge_score: undefined as number | undefined,
    by_category: {} as Record<string, { passed: number; failed: number }>,
    by_difficulty: {} as Record<string, { passed: number; failed: number }>,
  };

  // Calculate averages
  const toolAccuracies = results
    .map((r) => r.metrics.tool_accuracy)
    .filter((a): a is number => a !== undefined);
  if (toolAccuracies.length > 0) {
    summary.avg_tool_accuracy =
      toolAccuracies.reduce((a, b) => a + b, 0) / toolAccuracies.length;
  }

  const textSimilarities = results
    .map((r) => r.metrics.text_similarity)
    .filter((s): s is number => s !== undefined);
  if (textSimilarities.length > 0) {
    summary.avg_text_similarity =
      textSimilarities.reduce((a, b) => a + b, 0) / textSimilarities.length;
  }

  const judgeScores = results
    .map((r) => r.metrics.judge_score)
    .filter((s): s is number => s !== undefined);
  if (judgeScores.length > 0) {
    summary.avg_judge_score =
      judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length;
  }

  // Save results to history
  const { latestPath } = await saveResults(results, summary);
  console.log(`Results saved to ${latestPath}`);

  // Output results
  if (values.format) {
    const report = generateReport(results, summary, {
      format: values.format as any,
      output_path: values.output,
      include_details: true,
      include_analysis: false,
    });

    if (values.output) {
      await Bun.write(values.output, report);
      console.log(`\nReport saved to ${values.output}`);
    } else {
      console.log(report);
    }
  } else {
    printToConsole(results, summary);
  }

  // Check for regressions if comparing
  if (values["fail-on-regression"]) {
    // Would need to load baseline and compare
    console.log("\nWarning: --fail-on-regression requires --compare");
  }

  // Exit with error if any failures
  if (summary.failed > 0 || summary.errors > 0) {
    process.exit(1);
  }
}

/**
 * Run analysis on recent failures
 */
async function runAnalysis(values: any) {
  console.log("Analysis mode - loading recent results...\n");

  const data = await loadLatestResults();
  if (!data) {
    console.log("No results found. Run evaluations first: bun evals");
    console.log("Or run in mock mode: bun evals --mock");
    return;
  }

  const { results } = data;
  const failures = results.filter((r) => r.status === "failed" || r.status === "error");

  if (failures.length === 0) {
    console.log("No failures found in latest results. All cases passed!");
    return;
  }

  console.log(`Found ${failures.length} failure(s) out of ${results.length} total cases.\n`);

  // Analyze each failure
  console.log("=".repeat(60));
  console.log("Failure Analysis");
  console.log("=".repeat(60));

  for (const failure of failures) {
    console.log(`\n--- ${failure.case_id} (${failure.status}) ---`);

    if (failure.details.errors.length > 0) {
      console.log(`  Errors: ${failure.details.errors.join(", ")}`);
    }

    if (failure.metrics.tool_accuracy !== undefined) {
      console.log(`  Tool Accuracy: ${(failure.metrics.tool_accuracy * 100).toFixed(1)}%`);
    }

    if (failure.metrics.outcome_match !== undefined) {
      console.log(`  Outcome Match: ${failure.metrics.outcome_match}`);
    }

    // Show judge verdict if available
    if (failure.details.judge_verdict) {
      const v = failure.details.judge_verdict;
      console.log(`  Judge Score: ${((v.task_completion + v.tool_selection + v.efficiency) / 3).toFixed(1)}/10 (${v.overall_pass ? "PASS" : "FAIL"})`);
      console.log(`  Judge Reasoning: ${v.reasoning}`);
      if (v.issues.length > 0) {
        console.log(`  Judge Issues:`);
        for (const issue of v.issues) {
          console.log(`    - ${issue}`);
        }
      }
    }

    // Show actual vs expected tool calls
    if (failure.details.expected_tool_calls && failure.details.actual_tool_calls) {
      const expected = failure.details.expected_tool_calls
        .filter((tc) => !tc.optional)
        .map((tc) => tc.tool);
      const actual = failure.details.actual_tool_calls.map((tc) => tc.tool);
      console.log(`  Expected tools: [${expected.join(", ")}]`);
      console.log(`  Actual tools:   [${actual.join(", ")}]`);
    }

    // Run failure analysis
    try {
      const analysis = analyzeFailure(failure);
      if (analysis) {
        console.log(`  Root cause: ${analysis.root_cause}`);
        console.log(`  Severity: ${analysis.severity}`);
        if (analysis.suggestions.length > 0) {
          console.log(`  Suggestions:`);
          for (const s of analysis.suggestions) {
            console.log(`    - ${s}`);
          }
        }
      }
    } catch {
      // analyzeFailure may not handle all cases yet
    }
  }

  // Cluster common issues
  console.log("\n" + "=".repeat(60));
  console.log("Common Issues");
  console.log("=".repeat(60));

  const toolMismatches = failures.filter(
    (f) => f.metrics.tool_accuracy !== undefined && f.metrics.tool_accuracy < 0.6,
  );
  const outcomeFails = failures.filter(
    (f) => f.metrics.outcome_match === false,
  );
  const errors = failures.filter((f) => f.status === "error");

  if (toolMismatches.length > 0) {
    console.log(`\n  Tool Accuracy Issues: ${toolMismatches.length} case(s)`);
    for (const f of toolMismatches) {
      console.log(`    - ${f.case_id}: ${((f.metrics.tool_accuracy || 0) * 100).toFixed(1)}%`);
    }
  }

  if (outcomeFails.length > 0) {
    console.log(`\n  Outcome Failures: ${outcomeFails.length} case(s)`);
    for (const f of outcomeFails) {
      console.log(`    - ${f.case_id}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n  Runtime Errors: ${errors.length} case(s)`);
    for (const f of errors) {
      console.log(`    - ${f.case_id}: ${f.details.errors[0] || "unknown"}`);
    }
  }

  // Generate suggestions if requested
  if (values.suggest) {
    console.log("\n" + "=".repeat(60));
    console.log("Prompt Improvement Suggestions");
    console.log("=".repeat(60));

    try {
      const suggestions = generatePromptSuggestions(failures);
      if (suggestions.length === 0) {
        console.log("\n  No suggestions generated.");
      } else {
        const ranked = rankSuggestions(suggestions);
        for (let i = 0; i < ranked.length; i++) {
          const s = ranked[i];
          console.log(`\n  ${i + 1}. ${s.title}`);
          console.log(`     ${s.description}`);
          console.log(`     Confidence: ${s.impact.confidence}`);
          console.log(`     Affected: ${s.impact.affected_cases.join(", ")}`);
        }
      }
    } catch {
      console.log("\n  Suggestion generation not fully implemented yet.");
    }
  }
}

/**
 * Run comparison with baseline
 */
async function runComparison(baselineId: string) {
  console.log(`Comparing with baseline: ${baselineId}\n`);

  // Load baseline
  const baseline = await loadResultsById(baselineId);
  if (!baseline) {
    console.log(`Baseline "${baselineId}" not found in ${HISTORY_DIR}`);
    console.log("Available baselines:");
    try {
      const { readdirSync } = await import("fs");
      const files = readdirSync(HISTORY_DIR)
        .filter((f) => f.startsWith("results-") && f.endsWith(".json"))
        .map((f) => f.replace("results-", "").replace(".json", ""));
      for (const f of files) {
        console.log(`  ${f}`);
      }
    } catch {
      console.log("  (no history directory found)");
    }
    return;
  }

  // Load latest
  const latest = await loadLatestResults();
  if (!latest) {
    console.log("No latest results found. Run evaluations first.");
    return;
  }

  // Build comparison
  const regressions: ComparisonResult["regressions"] = [];
  const improvements: ComparisonResult["improvements"] = [];
  const unchanged: string[] = [];

  const baselineMap = new Map(baseline.results.map((r) => [r.case_id, r]));
  const latestMap = new Map(latest.results.map((r) => [r.case_id, r]));

  // Compare overlapping cases
  for (const [caseId, latestResult] of latestMap) {
    const baselineResult = baselineMap.get(caseId);
    if (!baselineResult) continue;

    if (baselineResult.status === "passed" && latestResult.status !== "passed") {
      regressions.push({
        case_id: caseId,
        baseline_status: "passed",
        current_status: latestResult.status as "failed" | "error",
        change_description: `Regressed from passed to ${latestResult.status}`,
      });
    } else if (baselineResult.status !== "passed" && latestResult.status === "passed") {
      improvements.push({
        case_id: caseId,
        baseline_status: baselineResult.status as "failed" | "error",
        current_status: "passed",
        improvement_description: `Improved from ${baselineResult.status} to passed`,
      });
    } else {
      unchanged.push(caseId);
    }
  }

  // Print comparison
  console.log("=".repeat(60));
  console.log("Comparison Report");
  console.log("=".repeat(60));

  const basePassRate = baseline.results.filter((r) => r.status === "passed").length / baseline.results.length;
  const latestPassRate = latest.results.filter((r) => r.status === "passed").length / latest.results.length;

  console.log(`\nBaseline pass rate: ${(basePassRate * 100).toFixed(1)}% (${baseline.results.length} cases)`);
  console.log(`Current pass rate:  ${(latestPassRate * 100).toFixed(1)}% (${latest.results.length} cases)`);
  console.log(`Delta:              ${((latestPassRate - basePassRate) * 100).toFixed(1)}%`);

  if (improvements.length > 0) {
    console.log(`\nImprovements (${improvements.length}):`);
    for (const imp of improvements) {
      console.log(`  + ${imp.case_id}: ${imp.improvement_description}`);
    }
  }

  if (regressions.length > 0) {
    console.log(`\nRegressions (${regressions.length}):`);
    for (const reg of regressions) {
      console.log(`  - ${reg.case_id}: ${reg.change_description}`);
    }
  }

  console.log(`\nUnchanged: ${unchanged.length} case(s)`);
  console.log("=".repeat(60));
}

// Run main
main();
