/**
 * Eval CLI — entry point for the trace-based evaluation pipeline.
 *
 * Usage: bun run evals/cli.ts <command> [args]
 *
 * Commands:
 *   convert <session-id> [--strategy <s>]  Convert trace to eval cases
 *   run [--case <id>] [--all] [--judge]    Run eval cases
 *   ab [prompt sources]                    Run prompt A/B comparison
 *   critique                               Generate AI-ready critique report
 *   results [--session <id>]               Show eval results
 *   stats                                  Aggregate statistics
 *   analyze                                Pattern analysis
 *   help                                   Show usage
 */

import { convertSession } from "./converter";
import { runEvals } from "./runner";
import {
  readEvalResults,
  readEvalCases,
  readSessionIndex,
  readPromptFile,
  readRunTraceEvents,
  readRunTraceManifests,
} from "./utils";
import { analyzeSessionsContractCompliance } from "./contract-compliance";
import type { EvalResult } from "./types";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  PromptId,
  getPromptTemplate,
  listPromptDescriptors,
} from "../src/prompts";

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

const PROMPT_IDS: PromptId[] = [
  "orchestrator.verifier.system",
  "orchestrator.verifier.critic.system",
];

function normalizePromptId(value?: string): PromptId | undefined {
  if (!value) return undefined;
  return PROMPT_IDS.includes(value as PromptId) ? (value as PromptId) : undefined;
}

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
    case "ab":
      await cmdAB(args.slice(1));
      break;
    case "critique":
      cmdCritique(args.slice(1));
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
  const promptFileIdx = args.indexOf("--prompt-file");
  const promptFile = promptFileIdx !== -1 ? args[promptFileIdx + 1] : undefined;
  const promptIdIdx = args.indexOf("--prompt-id");
  const promptIdRaw = promptIdIdx !== -1 ? args[promptIdIdx + 1] : undefined;
  const promptId = normalizePromptId(promptIdRaw);
  const promptVariantIdx = args.indexOf("--prompt-variant");
  const promptVariant =
    promptVariantIdx !== -1 ? args[promptVariantIdx + 1] : undefined;
  if (promptFile && promptIdRaw) {
    console.error("Use one of --prompt-file or --prompt-id, not both.");
    process.exit(1);
  }
  if (promptIdRaw && !promptId) {
    console.error(
      `Unknown prompt id: ${promptIdRaw}. Valid IDs: ${PROMPT_IDS.join(", ")}`,
    );
    process.exit(1);
  }
  const promptOverride = promptFile
    ? readPromptFile(promptFile)
    : promptId
      ? getPromptTemplate(promptId)
      : undefined;
  const promptRef = promptId
    ? listPromptDescriptors([promptId])[0]
    : undefined;

  await runEvals({
    caseId,
    all,
    judge,
    model,
    promptOverride,
    promptVariant,
    promptRef,
  });
}

async function cmdAB(args: string[]) {
  const promptAIdx = args.indexOf("--prompt-a");
  const promptBIdx = args.indexOf("--prompt-b");
  const promptAIdIdx = args.indexOf("--prompt-id-a");
  const promptBIdIdx = args.indexOf("--prompt-id-b");
  const promptAFile = promptAIdx !== -1 ? args[promptAIdx + 1] : undefined;
  const promptBFile = promptBIdx !== -1 ? args[promptBIdx + 1] : undefined;
  const promptAIdRaw = promptAIdIdx !== -1 ? args[promptAIdIdx + 1] : undefined;
  const promptBIdRaw = promptBIdIdx !== -1 ? args[promptBIdIdx + 1] : undefined;
  const promptAId = normalizePromptId(promptAIdRaw);
  const promptBId = normalizePromptId(promptBIdRaw);
  if ((promptAFile && promptAIdRaw) || (promptBFile && promptBIdRaw)) {
    console.error("For each side, use either prompt file or prompt id, not both.");
    process.exit(1);
  }
  if (promptAIdRaw && !promptAId) {
    console.error(
      `Unknown prompt id for A: ${promptAIdRaw}. Valid IDs: ${PROMPT_IDS.join(", ")}`,
    );
    process.exit(1);
  }
  if (promptBIdRaw && !promptBId) {
    console.error(
      `Unknown prompt id for B: ${promptBIdRaw}. Valid IDs: ${PROMPT_IDS.join(", ")}`,
    );
    process.exit(1);
  }
  if ((!promptAFile && !promptAId) || (!promptBFile && !promptBId)) {
    console.error(
      "Usage: evals ab (--prompt-a <file> | --prompt-id-a <id>) (--prompt-b <file> | --prompt-id-b <id>) [--case <id>] [--all] [--model <m>]",
    );
    process.exit(1);
  }

  const caseIdx = args.indexOf("--case");
  const caseId = caseIdx !== -1 ? args[caseIdx + 1] : undefined;
  const all = args.includes("--all");
  const modelIdx = args.indexOf("--model");
  const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;

  const promptA = promptAFile ? readPromptFile(promptAFile) : getPromptTemplate(promptAId!);
  const promptB = promptBFile ? readPromptFile(promptBFile) : getPromptTemplate(promptBId!);
  const promptARef = promptAId ? listPromptDescriptors([promptAId])[0] : undefined;
  const promptBRef = promptBId ? listPromptDescriptors([promptBId])[0] : undefined;

  console.log(`${c.bold}Running A/B evals${c.reset}`);
  console.log(`  A: ${promptAFile || promptAId}`);
  console.log(`  B: ${promptBFile || promptBId}`);

  const [resultsA, resultsB] = await Promise.all([
    runEvals({
      caseId,
      all,
      model,
      promptOverride: promptA,
      promptVariant: "A",
      promptRef: promptARef,
    }),
    runEvals({
      caseId,
      all,
      model,
      promptOverride: promptB,
      promptVariant: "B",
      promptRef: promptBRef,
    }),
  ]);

  const byCaseA = new Map(resultsA.map((r) => [r.caseId, r]));
  const byCaseB = new Map(resultsB.map((r) => [r.caseId, r]));
  const commonCaseIds = Array.from(byCaseA.keys()).filter((id) => byCaseB.has(id));

  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  for (const caseIdKey of commonCaseIds) {
    const a = byCaseA.get(caseIdKey)!;
    const b = byCaseB.get(caseIdKey)!;
    const winner = compareResults(a, b);
    if (winner === "A") aWins += 1;
    else if (winner === "B") bWins += 1;
    else ties += 1;
  }

  console.log(`\n${c.bold}A/B Summary${c.reset}`);
  console.log(`  Cases compared: ${commonCaseIds.length}`);
  console.log(`  A wins: ${aWins}`);
  console.log(`  B wins: ${bWins}`);
  console.log(`  Ties: ${ties}`);
  if (commonCaseIds.length > 0) {
    const aRate = ((aWins / commonCaseIds.length) * 100).toFixed(1);
    const bRate = ((bWins / commonCaseIds.length) * 100).toFixed(1);
    console.log(`  Win rate: A=${aRate}% B=${bRate}%`);
  }
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
    --prompt-file <f>     Override system prompt from file
    --prompt-id <id>      Use shared production prompt id
    --prompt-variant <v>  Label written into result metadata

  ab (--prompt-a <f> | --prompt-id-a <id>) (--prompt-b <f> | --prompt-id-b <id>) [options]
    Run both prompts over the same case set and compare winners
    Options: --case <id>, --all, --model <m>

  critique [options]
    Generate AI-consumable critique artifacts from eval history
    Options:
      --session <id>   Filter by sourceSessionId/prefix
      --run <id>       Include orchestrator run-trace signals for runId/prefix
      --out <dir>      Output directory (default: evals/reports)

  results [--session <id>]                Show eval results
  stats                                   Aggregate statistics
  analyze                                 Pattern analysis
  help                                    Show this help

Workflow:
  1. Record traces: run agent with 'bun run logs' active
  2. Convert: bun run evals convert <session-id>
  3. Run: bun run evals run --all
  4. A/B: bun run evals ab --prompt-id-a orchestrator.verifier.system --prompt-b prompts/b.txt --all
  5. Analyze: bun run evals analyze
  6. Critique: bun run evals critique
`);
}

function compareResults(a: EvalResult, b: EvalResult): "A" | "B" | "tie" {
  const rank = (result: EvalResult): number => {
    if (result.status === "pass") return 3;
    if (result.status === "fail") return 2;
    return 1;
  };

  const rankA = rank(a);
  const rankB = rank(b);
  if (rankA > rankB) return "A";
  if (rankB > rankA) return "B";

  const compA = a.scores.composite ?? 0;
  const compB = b.scores.composite ?? 0;
  if (compA > compB) return "A";
  if (compB > compA) return "B";
  return "tie";
}

function cmdCritique(args: string[]) {
  const cases = readEvalCases();
  const results = readEvalResults();
  if (cases.length === 0 || results.length === 0) {
    console.log("Need eval cases and results first. Run 'evals convert' and 'evals run'.");
    return;
  }

  const sessionIdx = args.indexOf("--session");
  const sessionFilter = sessionIdx !== -1 ? args[sessionIdx + 1] : undefined;
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : join("evals", "reports");
  const runIdx = args.indexOf("--run");
  const runFilter = runIdx !== -1 ? args[runIdx + 1] : undefined;

  const filteredCases = !sessionFilter
    ? cases
    : cases.filter((c) => c.sourceSessionId.startsWith(sessionFilter));
  const caseIdSet = new Set(filteredCases.map((c) => c.id));
  const filteredResults = results.filter((r) => caseIdSet.has(r.caseId));

  if (filteredCases.length === 0 || filteredResults.length === 0) {
    console.log("No matching cases/results for critique.");
    return;
  }

  const latestByCase = new Map<string, EvalResult>();
  for (const result of filteredResults) {
    const prev = latestByCase.get(result.caseId);
    if (!prev || prev.timestamp < result.timestamp) {
      latestByCase.set(result.caseId, result);
    }
  }
  const latestResults = Array.from(latestByCase.values());

  const total = latestResults.length;
  const passed = latestResults.filter((r) => r.status === "pass").length;
  const failed = latestResults.filter((r) => r.status === "fail").length;
  const errored = latestResults.filter((r) => r.status === "error").length;

  const avgComposite = avg(latestResults.map((r) => r.scores.composite ?? 0));
  const avgToolName = avg(latestResults.map((r) => r.scores.toolNameMatch));
  const avgToolParam = avg(latestResults.map((r) => r.scores.toolParamMatch));
  const avgSequence = avg(latestResults.map((r) => r.scores.sequenceMatch));

  const caseById = new Map(filteredCases.map((c) => [c.id, c]));
  const trackStats = summarizeByTrack(latestResults, caseById);
  const missedTools = summarizeMissedTools(latestResults, caseById);
  const lowComposite = latestResults
    .filter((r) => (r.scores.composite ?? 0) < 0.6)
    .map((r) => {
      const c = caseById.get(r.caseId);
      return {
        caseId: r.caseId,
        sessionId: c?.sourceSessionId ?? "unknown",
        track: c?.promptQuality?.track ?? "unspecified",
        status: r.status,
        composite: r.scores.composite ?? 0,
        query: c?.metadata.query ?? "",
        expectedEscalation: c?.promptQuality?.expectedEscalation ?? "unspecified",
      };
    })
    .slice(0, 40);

  const goldenCoverage = summarizeGoldenCoverage(filteredCases);
  const suggestions = buildPromptSuggestions({
    failed,
    errored,
    trackStats,
    missedTools,
    lowCompositeCount: lowComposite.length,
    goldenCoverage,
  });
  const runTraceSignals = summarizeRunTraceSignals(runFilter);

  const report = {
    generatedAt: new Date().toISOString(),
    scope: {
      sessionFilter: sessionFilter ?? null,
      casesConsidered: filteredCases.length,
      latestResultsConsidered: latestResults.length,
    },
    summary: {
      passRate: total ? passed / total : 0,
      failed,
      errored,
      averages: {
        composite: avgComposite,
        toolNameMatch: avgToolName,
        toolParamMatch: avgToolParam,
        sequenceMatch: avgSequence,
      },
    },
    trackStats,
    missedTools,
    lowCompositeCases: lowComposite,
    goldenCoverage,
    runTraceSignals,
    suggestions,
    llmPromptTemplate:
      "You are evaluating prompt quality for an agentic browser system. " +
      "Given this report JSON, propose the top 3 prompt edits, each with expected impact, risk, and validation plan.",
  };

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(outDir, `critique-${stamp}.json`);
  const mdPath = join(outDir, `critique-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  writeFileSync(mdPath, renderCritiqueMarkdown(report), "utf-8");

  console.log(`${c.green}Critique report generated${c.reset}`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  MD:   ${mdPath}`);
}

function summarizeRunTraceSignals(runFilter?: string) {
  const manifests = readRunTraceManifests();
  if (manifests.length === 0) return null;

  const selected = runFilter
    ? manifests.find((m: any) => m.runId === runFilter || String(m.runId || "").startsWith(runFilter))
    : manifests[manifests.length - 1];
  if (!selected || typeof selected.runId !== "string") return null;

  const events = readRunTraceEvents(selected.runId).filter(
    (event: any) => typeof event.type === "string",
  );
  const counts: Record<string, number> = {};
  for (const event of events as any[]) {
    const type = event.type as string;
    counts[type] = (counts[type] || 0) + 1;
  }

  return {
    runId: selected.runId,
    source: selected.source ?? null,
    startedAt: selected.startedAt ?? null,
    totalEvents: events.length,
    eventCounts: counts,
    laneIsolated: counts["lane_isolated"] || 0,
    escalationsRequested: counts["escalation_requested"] || 0,
    checkpointResumes: counts["task_resumed_from_checkpoint"] || 0,
    completions: counts["task_completed"] || 0,
  };
}

function summarizeByTrack(
  results: EvalResult[],
  caseById: Map<string, ReturnType<typeof readEvalCases>[number]>,
) {
  const map: Record<
    string,
    { total: number; pass: number; fail: number; error: number; avgComposite: number }
  > = {};

  for (const result of results) {
    const track = caseById.get(result.caseId)?.promptQuality?.track ?? "unspecified";
    if (!map[track]) {
      map[track] = { total: 0, pass: 0, fail: 0, error: 0, avgComposite: 0 };
    }
    const rec = map[track];
    rec.total += 1;
    rec.avgComposite += result.scores.composite ?? 0;
    if (result.status === "pass") rec.pass += 1;
    else if (result.status === "fail") rec.fail += 1;
    else rec.error += 1;
  }

  for (const rec of Object.values(map)) {
    rec.avgComposite = rec.total > 0 ? rec.avgComposite / rec.total : 0;
  }
  return map;
}

function summarizeMissedTools(
  results: EvalResult[],
  caseById: Map<string, ReturnType<typeof readEvalCases>[number]>,
) {
  const counts: Record<string, number> = {};
  for (const result of results) {
    if (result.status === "error") continue;
    const evalCase = caseById.get(result.caseId);
    if (!evalCase) continue;
    const actualTools = new Set(result.actual.toolCalls.map((tc) => tc.toolName));
    for (const expected of evalCase.expected.toolCalls) {
      if (!actualTools.has(expected.toolName)) {
        counts[expected.toolName] = (counts[expected.toolName] || 0) + 1;
      }
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([toolName, misses]) => ({ toolName, misses }));
}

function summarizeGoldenCoverage(
  cases: ReturnType<typeof readEvalCases>,
): { byTrack: Record<string, number>; tracksMissing: string[] } {
  const requiredTracks = [
    "orchestrator_lane_isolation",
    "verifier_critic",
    "human_escalation",
    "budget_and_termination",
    "checkpoint_resume",
    "core_task_success",
  ];
  const byTrack: Record<string, number> = {};
  for (const evalCase of cases) {
    const track = evalCase.promptQuality?.track ?? "unspecified";
    byTrack[track] = (byTrack[track] || 0) + 1;
  }
  const tracksMissing = requiredTracks.filter((track) => !byTrack[track]);
  return { byTrack, tracksMissing };
}

function buildPromptSuggestions(input: {
  failed: number;
  errored: number;
  trackStats: Record<
    string,
    { total: number; pass: number; fail: number; error: number; avgComposite: number }
  >;
  missedTools: { toolName: string; misses: number }[];
  lowCompositeCount: number;
  goldenCoverage: { byTrack: Record<string, number>; tracksMissing: string[] };
}) {
  const suggestions: string[] = [];
  const worstTrack = Object.entries(input.trackStats).sort(
    (a, b) => a[1].avgComposite - b[1].avgComposite,
  )[0];
  if (worstTrack) {
    suggestions.push(
      `Prioritize prompt improvements for track '${worstTrack[0]}' (lowest avgComposite=${worstTrack[1].avgComposite.toFixed(3)}).`,
    );
  }
  if (input.missedTools.length > 0) {
    const top = input.missedTools.slice(0, 3).map((m) => m.toolName).join(", ");
    suggestions.push(
      `Strengthen tool-selection instructions for frequently missed tools: ${top}.`,
    );
  }
  if (input.lowCompositeCount > 0) {
    suggestions.push(
      `Review low-composite cases (${input.lowCompositeCount}) and extract recurring failure prompts for few-shot guidance.`,
    );
  }
  if (input.goldenCoverage.tracksMissing.length > 0) {
    suggestions.push(
      `Add golden cases for missing tracks: ${input.goldenCoverage.tracksMissing.join(", ")}.`,
    );
  }
  if (input.failed + input.errored > 0) {
    suggestions.push(
      "Add explicit 'must not' instructions in prompts for known failure modes and validate via A/B runs.",
    );
  }
  return suggestions;
}

function renderCritiqueMarkdown(report: any): string {
  const trackLines = Object.entries(report.trackStats)
    .map(([track, stats]: [string, any]) => {
      const passRate = stats.total > 0 ? (stats.pass / stats.total) * 100 : 0;
      return `- ${track}: pass=${stats.pass}/${stats.total} (${passRate.toFixed(1)}%), avgComposite=${stats.avgComposite.toFixed(3)}`;
    })
    .join("\n");

  const toolLines = report.missedTools.length
    ? report.missedTools.map((m: any) => `- ${m.toolName}: ${m.misses}`).join("\n")
    : "- none";

  const suggestions = report.suggestions.map((s: string) => `- ${s}`).join("\n");
  const runTraceSection = report.runTraceSignals
    ? `## Run Trace Signals\n\n- runId: ${report.runTraceSignals.runId}\n- totalEvents: ${report.runTraceSignals.totalEvents}\n- laneIsolated: ${report.runTraceSignals.laneIsolated}\n- escalationsRequested: ${report.runTraceSignals.escalationsRequested}\n- checkpointResumes: ${report.runTraceSignals.checkpointResumes}\n- completions: ${report.runTraceSignals.completions}\n`
    : "## Run Trace Signals\n\n- none\n";

  return `# Evals Critique Report

Generated: ${report.generatedAt}

## Summary

- cases: ${report.scope.latestResultsConsidered}
- pass rate: ${(report.summary.passRate * 100).toFixed(1)}%
- failed: ${report.summary.failed}
- errored: ${report.summary.errored}
- avg composite: ${report.summary.averages.composite.toFixed(3)}

## Track Performance

${trackLines}

## Most Missed Tools

${toolLines}

## Golden Coverage

- byTrack: ${JSON.stringify(report.goldenCoverage.byTrack)}
- missingTracks: ${report.goldenCoverage.tracksMissing.join(", ") || "none"}

${runTraceSection}

## Suggested Prompt Improvements

${suggestions}

## LLM Instruction Seed

\`\`\`
${report.llmPromptTemplate}
\`\`\`
`;
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
