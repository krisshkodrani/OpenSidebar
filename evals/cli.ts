/**
 * Eval CLI — entry point for the trace-based evaluation pipeline.
 *
 * Usage: bun run evals/cli.ts <command> [args]
 *
 * Commands:
 *   convert <session-id> [--strategy <s>]  Convert trace to eval cases
 *   run [--case <id>] [--all] [--judge]    Run eval cases
 *   results [--session <id>]               Show eval results
 *   stats                                  Aggregate statistics
 *   analyze                                Pattern analysis
 *   help                                   Show usage
 */

import { convertSession } from "./converter";
import { runEvals } from "./runner";
import { readEvalResults, readEvalCases, readSessionIndex } from "./utils";
import { analyzeSessionsContractCompliance } from "./contract-compliance";

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  switch (command) {
    case "convert":
      await cmdConvert(args.slice(1));
      break;
    case "run":
      await cmdRun(args.slice(1));
      break;
    case "results":
      cmdResults(args.slice(1));
      break;
    case "stats":
      cmdStats();
      break;
    case "analyze":
      cmdAnalyze();
      break;
    case "help":
    default:
      cmdHelp();
      break;
  }
}

async function cmdConvert(args: string[]) {
  const sessionId = args[0];
  if (!sessionId) {
    console.error("Usage: evals convert <session-id> [--strategy first-turn|any-turn|recovery|escalation|all]");
    process.exit(1);
  }

  const stratIdx = args.indexOf("--strategy");
  const strategy = (stratIdx !== -1 && args[stratIdx + 1]) ? args[stratIdx + 1] : "all";
  const validStrategies = ["first-turn", "any-turn", "recovery", "escalation", "all"];
  if (!validStrategies.includes(strategy)) {
    console.error(`Invalid strategy: ${strategy}. Valid: ${validStrategies.join(", ")}`);
    process.exit(1);
  }

  console.log(`Converting session ${sessionId} with strategy: ${strategy}`);
  const count = await convertSession(sessionId, strategy as any);
  console.log(`${c.green}Generated ${count} eval case(s)${c.reset}`);
}

async function cmdRun(args: string[]) {
  const caseIdx = args.indexOf("--case");
  const caseId = caseIdx !== -1 ? args[caseIdx + 1] : undefined;
  const all = args.includes("--all");
  const judge = args.includes("--judge");
  const modelIdx = args.indexOf("--model");
  const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;

  await runEvals({ caseId, all, judge, model });
}

function cmdResults(args: string[]) {
  const results = readEvalResults();
  if (results.length === 0) {
    console.log("No eval results found. Run 'evals run' first.");
    return;
  }

  const sessionIdx = args.indexOf("--session");
  const sessionFilter = sessionIdx !== -1 ? args[sessionIdx + 1] : undefined;

  let filtered = results;
  if (sessionFilter) {
    const cases = readEvalCases();
    const caseIds = new Set(
      cases
        .filter((c) => c.sourceSessionId.startsWith(sessionFilter))
        .map((c) => c.id),
    );
    filtered = results.filter((r) => caseIds.has(r.caseId));
  }

  console.log(`${c.bold}Eval Results (${filtered.length}):${c.reset}\n`);
  for (const r of filtered) {
    const statusColor = r.status === "pass" ? c.green : r.status === "fail" ? c.red : c.yellow;
    console.log(
      `  ${statusColor}${r.status.padEnd(5)}${c.reset} ` +
      `names=${r.scores.toolNameMatch.toFixed(2)} params=${r.scores.toolParamMatch.toFixed(2)} ` +
      `seq=${r.scores.sequenceMatch.toFixed(2)} ${r.durationMs}ms` +
      (r.scores.judge ? ` judge:${r.scores.judge.taskCompletion}/10` : "") +
      (r.error ? ` ${c.red}${r.error.slice(0, 60)}${c.reset}` : ""),
    );
  }
}

function cmdStats() {
  const results = readEvalResults();
  const cases = readEvalCases();

  if (results.length === 0) {
    console.log("No eval results found.");
    return;
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;

  const avgNameMatch = avg(results.map((r) => r.scores.toolNameMatch));
  const avgParamMatch = avg(results.map((r) => r.scores.toolParamMatch));
  const avgSeqMatch = avg(results.map((r) => r.scores.sequenceMatch));

  console.log(`${c.bold}Eval Statistics${c.reset}\n`);
  console.log(`  Total cases:   ${cases.length}`);
  console.log(`  Total results: ${results.length}`);
  console.log(`  ${c.green}Passed:${c.reset}      ${passed} (${pct(passed, results.length)})`);
  console.log(`  ${c.red}Failed:${c.reset}      ${failed} (${pct(failed, results.length)})`);
  console.log(`  ${c.yellow}Errors:${c.reset}      ${errors} (${pct(errors, results.length)})`);
  console.log();
  console.log(`  Avg tool name match:  ${avgNameMatch.toFixed(3)}`);
  console.log(`  Avg tool param match: ${avgParamMatch.toFixed(3)}`);
  console.log(`  Avg sequence match:   ${avgSeqMatch.toFixed(3)}`);

  // Strategy breakdown
  const byStrategy: Record<string, EvalResult[]> = {};
  for (const r of results) {
    const evalCase = cases.find((c) => c.id === r.caseId);
    const strategy = evalCase?.strategy ?? "unknown";
    if (!byStrategy[strategy]) byStrategy[strategy] = [];
    byStrategy[strategy].push(r);
  }

  console.log(`\n${c.bold}By Strategy:${c.reset}`);
  for (const [strategy, stratResults] of Object.entries(byStrategy)) {
    const p = stratResults.filter((r) => r.status === "pass").length;
    console.log(`  ${strategy.padEnd(15)} ${p}/${stratResults.length} passed (${pct(p, stratResults.length)})`);
  }

  const compliance = analyzeSessionsContractCompliance(
    Array.from(new Set(cases.map((cs) => cs.sourceSessionId))),
  );
  const compliantSessions = Math.max(
    0,
    compliance.sessionsWithContract -
      new Set(compliance.violations.map((v) => v.sessionId)).size,
  );
  console.log(`\n${c.bold}Role Contract Compliance:${c.reset}`);
  console.log(
    `  Sessions analyzed: ${compliance.sessionsAnalyzed} (with contracts: ${compliance.sessionsWithContract})`,
  );
  if (compliance.sessionsWithContract > 0) {
    console.log(
      `  Compliant sessions: ${compliantSessions}/${compliance.sessionsWithContract} (${pct(compliantSessions, compliance.sessionsWithContract)})`,
    );
  }
  console.log(`  Violations: ${compliance.violations.length}`);
}

function cmdAnalyze() {
  const results = readEvalResults();
  const cases = readEvalCases();

  if (results.length === 0) {
    console.log("No eval results found.");
    return;
  }

  console.log(`${c.bold}Pattern Analysis${c.reset}\n`);

  // Find common failure patterns
  const failures = results.filter((r) => r.status === "fail");
  const toolMismatches: Record<string, number> = {};

  for (const f of failures) {
    const evalCase = cases.find((c) => c.id === f.caseId);
    if (!evalCase) continue;

    for (const exp of evalCase.expected.toolCalls) {
      const found = f.actual.toolCalls.some((a) => a.toolName === exp.toolName);
      if (!found) {
        toolMismatches[exp.toolName] = (toolMismatches[exp.toolName] || 0) + 1;
      }
    }
  }

  if (Object.keys(toolMismatches).length > 0) {
    console.log(`  ${c.bold}Most missed tools:${c.reset}`);
    const sorted = Object.entries(toolMismatches).sort((a, b) => b[1] - a[1]);
    for (const [tool, count] of sorted.slice(0, 10)) {
      console.log(`    ${c.red}${tool.padEnd(20)}${c.reset} missed ${count} times`);
    }
    console.log();
  }

  // Score distribution
  const lowNameScores = results.filter((r) => r.scores.toolNameMatch < 0.5);
  const lowSeqScores = results.filter((r) => r.scores.sequenceMatch < 0.5);

  console.log(`  ${c.bold}Weak areas:${c.reset}`);
  console.log(`    Low tool name match (<0.5): ${lowNameScores.length} cases`);
  console.log(`    Low sequence match (<0.5):  ${lowSeqScores.length} cases`);

  // Judge analysis if available
  const judged = results.filter((r) => r.scores.judge);
  if (judged.length > 0) {
    const avgTask = avg(judged.map((r) => r.scores.judge!.taskCompletion));
    const avgTool = avg(judged.map((r) => r.scores.judge!.toolSelection));
    const avgEff = avg(judged.map((r) => r.scores.judge!.efficiency));
    console.log(`\n  ${c.bold}Judge scores (${judged.length} cases):${c.reset}`);
    console.log(`    Task completion: ${avgTask.toFixed(1)}/10`);
    console.log(`    Tool selection:  ${avgTool.toFixed(1)}/10`);
    console.log(`    Efficiency:      ${avgEff.toFixed(1)}/10`);
  }

  const compliance = analyzeSessionsContractCompliance(
    Array.from(new Set(cases.map((cs) => cs.sourceSessionId))),
  );
  if (compliance.sessionsWithContract > 0) {
    console.log(`\n  ${c.bold}Role Contract Violations:${c.reset}`);
    if (compliance.violations.length === 0) {
      console.log(`    ${c.green}No violations detected.${c.reset}`);
    } else {
      const byType: Record<string, number> = {};
      for (const violation of compliance.violations) {
        byType[violation.type] = (byType[violation.type] || 0) + 1;
      }
      for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${c.red}${type.padEnd(24)}${c.reset} ${count}`);
      }
      const sample = compliance.violations[0];
      console.log(
        `\n    First violation: session=${sample.sessionId.slice(0, 8)} role=${sample.role} turn=${sample.turnNumber ?? "-"} ${sample.message}`,
      );
    }
  }
}

function cmdHelp() {
  console.log(`
${c.bold}Eval Pipeline CLI${c.reset}

Usage: bun run evals <command> [args]

Commands:
  convert <session-id> [--strategy <s>]   Convert trace to eval cases
    Strategies: first-turn, any-turn, recovery, escalation, all (default)

  run [options]                           Run eval cases against LLM
    --case <id>    Run a specific case
    --all          Run all cases
    --judge        Enable LLM-as-judge for failures
    --model <m>    Override model

  results [--session <id>]                Show eval results
  stats                                   Aggregate statistics
  analyze                                 Pattern analysis
  help                                    Show this help

Workflow:
  1. Record traces: run agent with 'bun run logs' active
  2. Convert: bun run evals convert <session-id>
  3. Run: bun run evals run --all
  4. Analyze: bun run evals analyze
`);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(0)}%`;
}

main().catch((err) => {
  console.error(`${c.red}Error: ${err.message}${c.reset}`);
  process.exit(1);
});
