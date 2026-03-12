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

import { convertSession, convertRun } from "./converter";
import { runEvals, replayCase, type EvalProvider } from "./runner";
import {
  readEvalResults,
  readEvalCases,
  readSessionIndex,
  readPromptFile,
  loadApiKeys,
  PLANNER_GOLDEN_DIR,
  CONTEXT_GOLDEN_DIR,
  STAGNATION_GOLDEN_DIR,
  type ApiKeys,
} from "./utils";
import { analyzeSessionsContractCompliance } from "./contract-compliance";
import { extractAndSave } from "./extractor";
import { judgeCase } from "./judge";
import { scoreToolNameMatch, scoreToolParamMatch, scoreSequenceMatch } from "./scorer";
import { buildCritiqueReport } from "./report";
import type { EvalCase, EvalResult } from "./types";
import {
  extractAndSavePerceptionCase,
  extractPerceptionCasesFromSession,
} from "./perception-extractor";
import { runPerceptionEvals, type PerceptionProvider } from "./perception-runner";
import { buildPerceptionReport } from "./perception-report";
import {
  extractAndSavePlannerCase,
  extractAndSavePlannerCaseFromRun,
  extractPlannerCasesFromSessions,
  extractPlannerCasesFromRuns,
  extractValidateDoneCases,
} from "./planner-extractor";
import { runPlannerEvals } from "./planner-runner";
import { buildPlannerReport } from "./planner-report";
import {
  extractAndSaveContextCase,
  extractContextCasesFromSession,
} from "./context-extractor";
import { runContextEvals } from "./context-runner";
import { buildContextReport } from "./context-report";
import {
  extractAndSaveStagnationCase,
  extractStagnationCasesFromSessions,
} from "./stagnation-extractor";
import { runStagnationEvals } from "./stagnation-runner";
import { buildStagnationReport } from "./stagnation-report";
import { runEscalationEvals, type PlannerModel } from "./escalation-runner";
import { buildEscalationReport } from "./escalation-report";
import { runCompletionTimingEvals, type CompletionTimingProvider } from "./completion-timing-runner";
import { buildCompletionTimingReport } from "./completion-timing-report";
import { runGroundingEvals, type GroundingProvider } from "./grounding-runner";
import { buildGroundingReport } from "./grounding-report";
import { runToolConfusionEvals, type ToolConfusionProvider } from "./tool-confusion-runner";
import { buildToolConfusionReport } from "./tool-confusion-report";
import { ToolName } from "../src/types";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
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
  "orchestrator.advisory.system",
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
    case "convert-run":
      await cmdConvertRun(args.slice(1));
      break;
    case "convert-golden":
      await cmdConvertGolden();
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
    case "extract":
      cmdExtract(args.slice(1));
      break;
    case "critique":
      await cmdCritique(args.slice(1));
      break;
    case "stats":
      cmdStats();
      break;
    case "analyze":
      cmdAnalyze();
      break;
    case "regression":
      await cmdRegression(args.slice(1));
      break;
    case "perception-extract":
      cmdPerceptionExtract(args.slice(1));
      break;
    case "perception-extract-all":
      await cmdPerceptionExtractAll(args.slice(1));
      break;
    case "perception-critique":
      await cmdPerceptionCritique(args.slice(1));
      break;
    case "planner-extract":
      cmdPlannerExtract(args.slice(1));
      break;
    case "planner-extract-all":
      cmdPlannerExtractAll(args.slice(1));
      break;
    case "planner-extract-run":
      cmdPlannerExtractRun(args.slice(1));
      break;
    case "planner-extract-runs":
      cmdPlannerExtractRuns(args.slice(1));
      break;
    case "planner-critique":
      await cmdPlannerCritique(args.slice(1));
      break;
    case "context-extract":
      cmdContextExtract(args.slice(1));
      break;
    case "context-extract-all":
      cmdContextExtractAll(args.slice(1));
      break;
    case "context-critique":
      await cmdContextCritique(args.slice(1));
      break;
    case "stagnation-extract":
      cmdStagnationExtract(args.slice(1));
      break;
    case "stagnation-extract-all":
      cmdStagnationExtractAll(args.slice(1));
      break;
    case "stagnation-critique":
      await cmdStagnationCritique(args.slice(1));
      break;
    case "escalation-critique":
      await cmdEscalationCritique(args.slice(1));
      break;
    case "escalation-validate":
      await cmdEscalationValidate();
      break;
    case "completion-timing-critique":
      await cmdCompletionTimingCritique(args.slice(1));
      break;
    case "completion-timing-validate":
      await cmdCompletionTimingValidate();
      break;
    case "grounding-critique":
      await cmdGroundingCritique(args.slice(1));
      break;
    case "grounding-validate":
      await cmdGroundingValidate();
      break;
    case "tool-confusion-critique":
      await cmdToolConfusionCritique(args.slice(1));
      break;
    case "tool-confusion-validate":
      await cmdToolConfusionValidate();
      break;
    case "context-efficiency-critique":
      await cmdContextEfficiencyCritique(args.slice(1));
      break;
    case "context-efficiency-validate":
      await cmdContextEfficiencyValidate();
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

async function cmdConvertRun(args: string[]) {
  const runId = args[0];
  if (!runId) {
    console.error("Usage: evals convert-run <run-id> [--strategy verifier-decision|lane-isolation|escalation-flow|all]");
    process.exit(1);
  }

  const stratIdx = args.indexOf("--strategy");
  const strategy = (stratIdx !== -1 && args[stratIdx + 1]) ? args[stratIdx + 1] : "all";
  const validStrategies = ["verifier-decision", "lane-isolation", "escalation-flow", "all"];
  if (!validStrategies.includes(strategy)) {
    console.error(`Invalid strategy: ${strategy}. Valid: ${validStrategies.join(", ")}`);
    process.exit(1);
  }

  console.log(`Converting run trace ${runId} with strategy: ${strategy}`);
  const count = await convertRun(runId, strategy as any);
  console.log(`${c.green}Generated ${count} eval case(s) from run trace${c.reset}`);
}

async function cmdConvertGolden() {
  const goldenDir = join("evals", "golden");
  if (!existsSync(goldenDir)) {
    console.error(`Golden directory not found: ${goldenDir}`);
    process.exit(1);
  }

  const jsonFiles = readdirSync(goldenDir).filter((f) => f.endsWith(".json"));
  const jsonlFiles = readdirSync(goldenDir).filter((f) => f.endsWith(".jsonl"));
  if (jsonFiles.length === 0 && jsonlFiles.length === 0) {
    console.error("No golden JSON or JSONL files found in evals/golden/");
    process.exit(1);
  }

  const casesDir = join("evals", "cases");
  if (!existsSync(casesDir)) {
    mkdirSync(casesDir, { recursive: true });
  }

  const cases: EvalCase[] = [];

  // Parse .json files (single EvalCase per file)
  for (const file of jsonFiles) {
    const content = readFileSync(join(goldenDir, file), "utf-8");
    const parsed = JSON.parse(content) as EvalCase;
    cases.push(parsed);
  }

  // Parse .jsonl files (one EvalCase per line, from golden recorder)
  for (const file of jsonlFiles) {
    const content = readFileSync(join(goldenDir, file), "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as EvalCase;
        cases.push(parsed);
      } catch {
        console.warn(`${c.yellow}Skipping invalid JSONL line in ${file}${c.reset}`);
      }
    }
  }

  const outputFile = join(casesDir, "golden.jsonl");
  const lines = cases.map((cs) => JSON.stringify(cs)).join("\n") + "\n";
  writeFileSync(outputFile, lines, "utf-8");
  console.log(`${c.green}Wrote ${cases.length} golden case(s) to ${outputFile} (from ${jsonFiles.length} .json + ${jsonlFiles.length} .jsonl files)${c.reset}`);
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
    const avgTool = avg(judged.map((r) => r.scores.judge!.toolSelection));
    const avgParam = avg(judged.map((r) => r.scores.judge!.parameterAccuracy ?? 0));
    const avgEff = avg(judged.map((r) => r.scores.judge!.efficiency));
    const avgAnti = avg(judged.map((r) => r.scores.judge!.antiPatternAvoidance ?? 0));
    const avgReason = avg(judged.map((r) => r.scores.judge!.reasoningQuality ?? 0));
    console.log(`\n  ${c.bold}Judge scores (${judged.length} cases):${c.reset}`);
    console.log(`    Tool selection:       ${avgTool.toFixed(1)}/10`);
    console.log(`    Parameter accuracy:   ${avgParam.toFixed(1)}/10`);
    console.log(`    Efficiency:           ${avgEff.toFixed(1)}/10`);
    console.log(`    Anti-pattern:         ${avgAnti.toFixed(1)}/10`);
    console.log(`    Reasoning quality:    ${avgReason.toFixed(1)}/10`);
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

async function cmdRegression(args: string[]) {
  const thresholdArg = args.find((a) => a.startsWith("--threshold="));
  const threshold = thresholdArg
    ? parseFloat(thresholdArg.split("=")[1])
    : 0.8;
  const offline = args.includes("--offline");

  const goldenDir = join("evals", "golden");
  if (!existsSync(goldenDir)) {
    console.log(`${c.yellow}No golden directory found — nothing to validate${c.reset}`);
    process.exit(0);
  }

  const jsonFiles = readdirSync(goldenDir).filter((f) => f.endsWith(".json"));
  const jsonlFiles = readdirSync(goldenDir).filter((f) => f.endsWith(".jsonl"));
  if (jsonFiles.length === 0 && jsonlFiles.length === 0) {
    console.log(`${c.yellow}No golden files found — nothing to validate${c.reset}`);
    process.exit(0);
  }

  // Parse all golden cases
  const cases: EvalCase[] = [];
  let parseErrors = 0;

  for (const file of jsonFiles) {
    try {
      const content = readFileSync(join(goldenDir, file), "utf-8");
      cases.push(JSON.parse(content) as EvalCase);
    } catch (e) {
      console.error(`${c.red}Parse error in ${file}: ${(e as Error).message}${c.reset}`);
      parseErrors++;
    }
  }
  for (const file of jsonlFiles) {
    const content = readFileSync(join(goldenDir, file), "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        cases.push(JSON.parse(line) as EvalCase);
      } catch {
        parseErrors++;
      }
    }
  }

  if (offline) {
    // Structural validation only
    console.log(`${c.bold}Structural validation of ${cases.length} golden case(s)${c.reset}`);
    let errors = 0;

    const validToolNames = new Set(Object.values(ToolName));
    const seenIds = new Set<string>();

    for (const cs of cases) {
      if (!cs.id) { console.error(`${c.red}  Missing id${c.reset}`); errors++; }
      if (seenIds.has(cs.id)) { console.error(`${c.red}  Duplicate id: ${cs.id}${c.reset}`); errors++; }
      seenIds.add(cs.id);

      if (!cs.input?.systemPrompt) { console.error(`${c.red}  ${cs.id}: missing input.systemPrompt${c.reset}`); errors++; }
      if (!cs.expected) { console.error(`${c.red}  ${cs.id}: missing expected${c.reset}`); errors++; }

      for (const tc of cs.expected?.toolCalls || []) {
        if (!validToolNames.has(tc.toolName as ToolName)) {
          console.error(`${c.red}  ${cs.id}: unknown tool ${tc.toolName}${c.reset}`);
          errors++;
        }
      }
    }

    errors += parseErrors;
    if (errors > 0) {
      console.error(`\n${c.red}${errors} structural error(s) found${c.reset}`);
      process.exit(1);
    }
    console.log(`${c.green}All ${cases.length} golden case(s) valid${c.reset}`);
    process.exit(0);
  }

  // Online mode: convert golden → run → report
  console.log(`${c.bold}Running regression suite (${cases.length} cases, threshold=${threshold})${c.reset}`);
  await cmdConvertGolden();

  const results = await runEvals({
    all: true,
  });

  if (results.length === 0) {
    console.log(`${c.yellow}No eval results produced${c.reset}`);
    process.exit(1);
  }

  // Per-track thresholds
  const TRACK_THRESHOLDS: Record<string, number> = {
    core_task_success: 0.9,
    budget_and_termination: 0.9,
    verifier_critic: 0.85,
  };

  const trackResults: Record<string, EvalResult[]> = {};
  const caseById = new Map(cases.map((cs) => [cs.id, cs]));
  for (const r of results) {
    const track = caseById.get(r.caseId)?.promptQuality?.track ?? "default";
    if (!trackResults[track]) trackResults[track] = [];
    trackResults[track].push(r);
  }

  let failed = false;
  for (const [track, trackRes] of Object.entries(trackResults)) {
    const passCount = trackRes.filter((r) => r.status === "pass").length;
    const rate = passCount / trackRes.length;
    const minRate = TRACK_THRESHOLDS[track] ?? threshold;
    const statusIcon = rate >= minRate ? c.green + "PASS" : c.red + "FAIL";
    console.log(
      `  ${statusIcon}${c.reset} ${track}: ${passCount}/${trackRes.length} (${(rate * 100).toFixed(1)}%, need ${(minRate * 100).toFixed(0)}%)`,
    );
    if (rate < minRate) failed = true;
  }

  const totalPass = results.filter((r) => r.status === "pass").length;
  const totalRate = totalPass / results.length;
  console.log(
    `\n  ${c.bold}Overall: ${totalPass}/${results.length} (${(totalRate * 100).toFixed(1)}%)${c.reset}`,
  );

  process.exit(failed ? 1 : 0);
}

function cmdPerceptionExtract(args: string[]) {
  const sessionId = args[0];
  const turnStr = args[1];
  if (!sessionId || !turnStr) {
    console.error(
      "Usage: evals perception-extract <session-id> <turn> [--id <id>] [--dimension <d>] [--difficulty <d>] [--notes <text>] [--page-type <t>] [--signal <status>]",
    );
    process.exit(1);
  }

  const turnNumber = parseInt(turnStr, 10);
  if (isNaN(turnNumber)) {
    console.error(`Invalid turn number: ${turnStr}`);
    process.exit(1);
  }

  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const signalStatus = getArg("--signal");
  const signal = signalStatus
    ? {
        status: signalStatus as "done" | "not_done" | "unclear",
        scope: "subtask" as const,
      }
    : undefined;

  const outputPath = extractAndSavePerceptionCase(sessionId, turnNumber, {
    id: getArg("--id"),
    dimension: getArg("--dimension") as any,
    difficulty: getArg("--difficulty") as any,
    notes: getArg("--notes"),
    pageType: getArg("--page-type"),
    signal,
  });

  console.log(`${c.green}Perception case extracted${c.reset}`);
  console.log(`  File: ${outputPath}`);
}

async function cmdPerceptionExtractAll(args: string[]) {
  const sessionId = args[0];
  if (!sessionId) {
    console.error("Usage: evals perception-extract-all <session-id> [--max <n>]");
    process.exit(1);
  }

  const maxIdx = args.indexOf("--max");
  const max = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : undefined;

  const cases = extractPerceptionCasesFromSession(sessionId, { max });

  if (cases.length === 0) {
    console.log(`${c.yellow}No perception turns found in session${c.reset}`);
    return;
  }

  // Save all cases
  const { PERCEPTION_GOLDEN_DIR } = await import("./utils");

  if (!existsSync(PERCEPTION_GOLDEN_DIR)) {
    mkdirSync(PERCEPTION_GOLDEN_DIR, { recursive: true });
  }

  for (const evalCase of cases) {
    const filename = `${evalCase.id}.json`;
    const outputPath = join(PERCEPTION_GOLDEN_DIR, filename);
    writeFileSync(outputPath, JSON.stringify(evalCase, null, 2), "utf-8");
  }

  console.log(
    `${c.green}Extracted ${cases.length} perception case(s)${c.reset}`,
  );
}

async function cmdPerceptionCritique(args: string[]) {
  const providerIdx = args.indexOf("--provider");
  const providerArg = providerIdx !== -1 ? args[providerIdx + 1] : "openrouter";
  if (providerArg !== "openrouter") {
    console.error(
      `${c.red}Invalid provider: ${providerArg}. Use "openrouter".${c.reset}`,
    );
    process.exit(1);
  }

  const dimIdx = args.indexOf("--dimension");
  const dimension = dimIdx !== -1 ? args[dimIdx + 1] : undefined;
  const judgeEnabled = args.includes("--judge");
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : join("evals", "reports");

  let keys: ApiKeys;
  try {
    keys = loadApiKeys();
  } catch (err: any) {
    console.error(`${c.red}${err.message}${c.reset}`);
    process.exit(1);
  }

  console.log(
    `${c.bold}Running perception critique [provider: ${providerArg}]${c.reset}\n`,
  );

  const { readPerceptionEvalCases } = await import("./utils");
  const cases = readPerceptionEvalCases();

  const results = await runPerceptionEvals({
    keys,
    provider: providerArg as PerceptionProvider,
    dimension,
    judge: judgeEnabled,
    outDir: join("evals", "results", "perception"),
  });

  if (results.length === 0) {
    console.log(`${c.yellow}No results produced${c.reset}`);
    return;
  }

  // Generate report
  const report = buildPerceptionReport({ cases, results });
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outDir, `perception-critique-${stamp}.md`);
  writeFileSync(mdPath, report, "utf-8");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(
    `\n${c.bold}Results: ${passed} passed, ${failed} failed, ${errors} errors${c.reset}`,
  );
  console.log(`Report: ${mdPath}`);
}

// ── Planner pipeline commands ────────────────────────────────────────

function cmdPlannerExtract(args: string[]) {
  const sessionId = args[0];
  if (!sessionId) {
    console.error("Usage: evals planner-extract <session-id> [--id <id>] [--method <decompose|validateDone>] [--dimension <d>] [--difficulty <d>]");
    process.exit(1);
  }

  const idIdx = args.indexOf("--id");
  const id = idIdx !== -1 ? args[idIdx + 1] : undefined;
  const methodIdx = args.indexOf("--method");
  const method = methodIdx !== -1 ? args[methodIdx + 1] as "decompose" | "validateDone" : undefined;
  const dimIdx = args.indexOf("--dimension");
  const dimension = dimIdx !== -1 ? args[dimIdx + 1] as any : undefined;
  const diffIdx = args.indexOf("--difficulty");
  const difficulty = diffIdx !== -1 ? args[diffIdx + 1] as any : undefined;

  if (method === "validateDone") {
    const cases = extractValidateDoneCases(sessionId);
    if (cases.length === 0) {
      console.log("No validateDone cases found in this session.");
      return;
    }
    if (!existsSync(PLANNER_GOLDEN_DIR)) mkdirSync(PLANNER_GOLDEN_DIR, { recursive: true });
    for (const evalCase of cases) {
      const outPath = join(PLANNER_GOLDEN_DIR, `${evalCase.id}.json`);
      writeFileSync(outPath, JSON.stringify(evalCase, null, 2), "utf-8");
      console.log(`${c.green}Extracted${c.reset}: ${outPath}`);
    }
    return;
  }

  const outputPath = extractAndSavePlannerCase(sessionId, { id, method, dimension, difficulty });
  console.log(`${c.green}Planner case extracted${c.reset}`);
  console.log(`  File: ${outputPath}`);
}

function cmdPlannerExtractAll(args: string[]) {
  const maxIdx = args.indexOf("--max");
  const max = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : 10;

  const cases = extractPlannerCasesFromSessions({ max });
  if (cases.length === 0) {
    console.log("No sessions with plan decompositions found.");
    return;
  }

  // PLANNER_GOLDEN_DIR imported at top level
  if (!existsSync(PLANNER_GOLDEN_DIR)) mkdirSync(PLANNER_GOLDEN_DIR, { recursive: true });

  for (const evalCase of cases) {
    const outPath = join(PLANNER_GOLDEN_DIR, `${evalCase.id}.json`);
    writeFileSync(outPath, JSON.stringify(evalCase, null, 2), "utf-8");
    console.log(`${c.green}Extracted${c.reset}: ${evalCase.id}`);
  }
  console.log(`\n${cases.length} planner case(s) extracted.`);
}

function cmdPlannerExtractRun(args: string[]) {
  const runId = args[0];
  if (!runId) {
    console.error("Usage: evals planner-extract-run <run-id> [--id <id>] [--dimension <d>] [--difficulty <d>] [--page-title <t>] [--page-url <u>]");
    process.exit(1);
  }

  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const outputPath = extractAndSavePlannerCaseFromRun(runId, {
    id: getArg("--id"),
    dimension: getArg("--dimension") as any,
    difficulty: getArg("--difficulty") as any,
    pageTitle: getArg("--page-title"),
    pageUrl: getArg("--page-url"),
  });

  console.log(`${c.green}Planner case extracted from run trace${c.reset}`);
  console.log(`  File: ${outputPath}`);
}

function cmdPlannerExtractRuns(args: string[]) {
  const maxIdx = args.indexOf("--max");
  const max = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : 10;

  const cases = extractPlannerCasesFromRuns({ max });
  if (cases.length === 0) {
    console.log("No orchestrator run traces found.");
    return;
  }

  if (!existsSync(PLANNER_GOLDEN_DIR)) mkdirSync(PLANNER_GOLDEN_DIR, { recursive: true });

  for (const evalCase of cases) {
    const outPath = join(PLANNER_GOLDEN_DIR, `${evalCase.id}.json`);
    writeFileSync(outPath, JSON.stringify(evalCase, null, 2), "utf-8");
    console.log(`${c.green}Extracted${c.reset}: ${evalCase.id}`);
  }
  console.log(`\n${cases.length} planner case(s) extracted from run traces.`);
}

async function cmdPlannerCritique(args: string[]) {
  const judgeFlag = args.includes("--judge");
  const dimIdx = args.indexOf("--dimension");
  const dimension = dimIdx !== -1 ? args[dimIdx + 1] : undefined;
  const methodIdx = args.indexOf("--method");
  const method = methodIdx !== -1 ? args[methodIdx + 1] : undefined;
  const modelIdx = args.indexOf("--model");
  const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
  const reasoningIdx = args.indexOf("--reasoning");
  const reasoningEffort =
    reasoningIdx !== -1 ? args[reasoningIdx + 1] : undefined;
  if (
    reasoningEffort &&
    reasoningEffort !== "low" &&
    reasoningEffort !== "medium" &&
    reasoningEffort !== "high"
  ) {
    console.error(
      `${c.red}Invalid --reasoning value: ${reasoningEffort}. Use low|medium|high.${c.reset}`,
    );
    process.exit(1);
  }
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : join("evals", "reports");

  let keys: ApiKeys;
  try {
    keys = loadApiKeys();
  } catch (err: any) {
    console.error(`${c.red}${err.message}${c.reset}`);
    process.exit(1);
  }

  const { readPlannerEvalCases } = await import("./utils");
  const cases = readPlannerEvalCases();

  const results = await runPlannerEvals({
    keys,
    dimension,
    method,
    judge: judgeFlag,
    model,
    reasoningEffort: reasoningEffort as "low" | "medium" | "high" | undefined,
    outDir: join(outDir, "planner"),
  });

  if (results.length === 0) return;

  const report = buildPlannerReport({ cases, results });

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outDir, `planner-critique-${stamp}.md`);
  writeFileSync(mdPath, report, "utf-8");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\n${c.bold}Planner: ${passed} passed, ${failed} failed, ${errors} errors${c.reset}`);
  console.log(`Report: ${mdPath}`);
}

// ── Context pipeline commands ────────────────────────────────────────

function cmdContextExtract(args: string[]) {
  const sessionId = args[0];
  const turnStr = args[1];
  if (!sessionId || !turnStr) {
    console.error("Usage: evals context-extract <session-id> <turn> [--id <id>] [--dimension <d>] [--difficulty <d>]");
    process.exit(1);
  }

  const turnNumber = parseInt(turnStr, 10);
  if (isNaN(turnNumber)) {
    console.error(`Invalid turn number: ${turnStr}`);
    process.exit(1);
  }

  const idIdx = args.indexOf("--id");
  const id = idIdx !== -1 ? args[idIdx + 1] : undefined;
  const dimIdx = args.indexOf("--dimension");
  const dimension = dimIdx !== -1 ? args[dimIdx + 1] as any : undefined;
  const diffIdx = args.indexOf("--difficulty");
  const difficulty = diffIdx !== -1 ? args[diffIdx + 1] as any : undefined;

  const outputPath = extractAndSaveContextCase(sessionId, turnNumber, { id, dimension, difficulty });
  console.log(`${c.green}Context case extracted${c.reset}`);
  console.log(`  File: ${outputPath}`);
}

function cmdContextExtractAll(args: string[]) {
  const sessionId = args[0];
  if (!sessionId) {
    console.error("Usage: evals context-extract-all <session-id> [--max <n>]");
    process.exit(1);
  }

  const maxIdx = args.indexOf("--max");
  const max = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : 10;

  const cases = extractContextCasesFromSession(sessionId, { max });
  if (cases.length === 0) {
    console.log("No context cases extracted (session may be too short).");
    return;
  }

  // CONTEXT_GOLDEN_DIR imported at top level
  if (!existsSync(CONTEXT_GOLDEN_DIR)) mkdirSync(CONTEXT_GOLDEN_DIR, { recursive: true });

  for (const evalCase of cases) {
    const outPath = join(CONTEXT_GOLDEN_DIR, `${evalCase.id}.json`);
    writeFileSync(outPath, JSON.stringify(evalCase, null, 2), "utf-8");
    console.log(`${c.green}Extracted${c.reset}: ${evalCase.id}`);
  }
  console.log(`\n${cases.length} context case(s) extracted.`);
}

async function cmdContextCritique(args: string[]) {
  const dimIdx = args.indexOf("--dimension");
  const dimension = dimIdx !== -1 ? args[dimIdx + 1] : undefined;
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : join("evals", "reports");

  const { readContextEvalCases } = await import("./utils");
  const cases = readContextEvalCases();

  const results = await runContextEvals({
    dimension,
    outDir: join(outDir, "context"),
  });

  if (results.length === 0) return;

  const report = buildContextReport({ cases, results });

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outDir, `context-critique-${stamp}.md`);
  writeFileSync(mdPath, report, "utf-8");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\n${c.bold}Context: ${passed} passed, ${failed} failed, ${errors} errors${c.reset}`);
  console.log(`Report: ${mdPath}`);
}

// ── Stagnation pipeline commands ─────────────────────────────────────

function cmdStagnationExtract(args: string[]) {
  const sessionId = args[0];
  if (!sessionId) {
    console.error("Usage: evals stagnation-extract <session-id> [--id <id>] [--dimension <d>] [--difficulty <d>]");
    process.exit(1);
  }

  const idIdx = args.indexOf("--id");
  const id = idIdx !== -1 ? args[idIdx + 1] : undefined;
  const dimIdx = args.indexOf("--dimension");
  const dimension = dimIdx !== -1 ? args[dimIdx + 1] as any : undefined;
  const diffIdx = args.indexOf("--difficulty");
  const difficulty = diffIdx !== -1 ? args[diffIdx + 1] as any : undefined;

  const outputPath = extractAndSaveStagnationCase(sessionId, { id, dimension, difficulty });
  console.log(`${c.green}Stagnation case extracted${c.reset}`);
  console.log(`  File: ${outputPath}`);
}

function cmdStagnationExtractAll(args: string[]) {
  const maxIdx = args.indexOf("--max");
  const max = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : 10;

  const cases = extractStagnationCasesFromSessions({ max });
  if (cases.length === 0) {
    console.log("No sessions found for stagnation extraction.");
    return;
  }

  // STAGNATION_GOLDEN_DIR imported at top level
  if (!existsSync(STAGNATION_GOLDEN_DIR)) mkdirSync(STAGNATION_GOLDEN_DIR, { recursive: true });

  for (const evalCase of cases) {
    const outPath = join(STAGNATION_GOLDEN_DIR, `${evalCase.id}.json`);
    writeFileSync(outPath, JSON.stringify(evalCase, null, 2), "utf-8");
    console.log(`${c.green}Extracted${c.reset}: ${evalCase.id}`);
  }
  console.log(`\n${cases.length} stagnation case(s) extracted.`);
}

async function cmdStagnationCritique(args: string[]) {
  const dimIdx = args.indexOf("--dimension");
  const dimension = dimIdx !== -1 ? args[dimIdx + 1] : undefined;
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : join("evals", "reports");

  const { readStagnationEvalCases } = await import("./utils");
  const cases = readStagnationEvalCases();

  const results = await runStagnationEvals({
    dimension,
    outDir: join(outDir, "stagnation"),
  });

  if (results.length === 0) return;

  const report = buildStagnationReport({ cases, results });

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outDir, `stagnation-critique-${stamp}.md`);
  writeFileSync(mdPath, report, "utf-8");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\n${c.bold}Stagnation: ${passed} passed, ${failed} failed, ${errors} errors${c.reset}`);
  console.log(`Report: ${mdPath}`);
}


function cmdHelp() {
  console.log(`
${c.bold}Eval Pipeline CLI${c.reset}

Usage: tsx evals/cli.ts <command> [args]

Commands:
  convert <session-id> [--strategy <s>]   Convert trace to eval cases
    Strategies: first-turn, any-turn, recovery, escalation, all (default)

  convert-run <run-id> [--strategy <s>]  Convert orchestrator run trace to eval cases
    Strategies: verifier-decision, lane-isolation, escalation-flow, all (default)

  convert-golden                         Convert golden fixtures to eval cases

  extract <session-id> <turn> [options]  Extract golden case from trace turn
    --correct-tool <name>   Override expected tool name
    --correct-args <json>   Override expected tool args
    --tag <pathology>       Pathology tag for the case
    --id <case-id>          Custom case ID

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
    Unified critique: load golden cases, replay, score, judge, generate report
    Options:
      --model <m>           Override replay model
      --tag <p>             Filter by pathology tag
      --out <dir>           Output directory (default: evals/reports)
      --provider <p>        Force provider (default: openrouter)

  perception-extract <session-id> <turn> [options]
    Extract a perception eval case from a trace turn
    Options:
      --id <case-id>          Custom case ID
      --dimension <d>         Dimension tag (accuracy, blockers, etc.)
      --difficulty <d>        easy, medium, or hard
      --notes <text>          Notes for the case
      --page-type <type>      Page type description
      --signal <status>       Expected completion signal (done, not_done, unclear)

  perception-extract-all <session-id> [--max <n>]
    Batch-extract all perception turns from a session

  perception-critique [options]
    Replay perception cases, score, judge, generate comparison report
    Options:
      --provider <p>          openrouter (default: both)
      --dimension <d>         Filter by dimension tag
      --judge                 Enable LLM-as-judge
      --out <dir>             Output directory (default: evals/reports)

  results [--session <id>]                Show eval results
  stats                                   Aggregate statistics
  analyze                                 Pattern analysis

  regression [options]                    CI regression gate
    --offline          Structural validation only (no LLM calls)
    --threshold=0.8    Pass rate threshold (default 0.8)

  help                                    Show this help

Workflow:
  1. Record traces: run agent with 'npm run logs' active
  2. Extract golden cases: npm run evals extract <session-id> <turn> --tag <pathology>
  3. Critique: npm run evals:critique
  4. Read report in evals/reports/

Perception workflow:
  1. Record traces with perception data (screenshots)
  2. Extract: tsx evals/cli.ts perception-extract <session-id> <turn> --dimension accuracy
  3. Or batch: tsx evals/cli.ts perception-extract-all <session-id> --max 10
  4. Critique: npm run evals:perception
  5. Read report in evals/reports/

Planner eval commands:
  planner-extract <session-id> [options]  Extract planner case from session
    --id <id>         Custom case ID
    --method <m>      decompose (default) or validateDone
    --dimension <d>   difficulty_accuracy, step_quality, coverage, done_validation
    --difficulty <d>  easy, medium, or hard

  planner-extract-all [--max <n>]        Batch-extract from all sessions with plans

  planner-extract-run <run-id> [options]  Extract planner case from orchestrator run trace
    --id <id>         Custom case ID
    --dimension <d>   difficulty_accuracy, step_quality, coverage, done_validation
    --difficulty <d>  easy, medium, or hard
    --page-title <t>  Override page title (run traces don't carry it)
    --page-url <u>    Override page URL

  planner-extract-runs [--max <n>]       Batch-extract from all orchestrator run traces

  planner-critique [options]             Replay, score, judge, generate report
    --judge           Enable LLM-as-judge
    --dimension <d>   Filter by dimension
    --method <m>      Filter by method
    --model <m>       Override planner model (default: deepseek/deepseek-v3.2-speciale)
    --reasoning <e>   Reasoning effort: low|medium|high (model-dependent)
    --out <dir>       Output directory

Context eval commands:
  context-extract <session-id> <turn> [options]  Extract context compression case
    --id <id>         Custom case ID
    --dimension <d>   goal_amnesia, plan_integrity, tool_results, token_efficiency
    --difficulty <d>  easy, medium, or hard

  context-extract-all <session-id> [--max <n>]   Auto-extract at turn 30, 60, 100

  context-critique [options]             Replay compression (no LLM), score, report
    --dimension <d>   Filter by dimension
    --out <dir>       Output directory

Stagnation eval commands:
  stagnation-extract <session-id> [options]      Extract stagnation case from session
    --id <id>         Custom case ID
    --dimension <d>   false_positive, false_negative, timing, url_handling
    --difficulty <d>  easy, medium, or hard

  stagnation-extract-all [--max <n>]     Batch-extract from all sessions

  stagnation-critique [options]          Replay through StagnationMonitor, score, report
    --dimension <d>   Filter by dimension
    --out <dir>       Output directory

Completion-timing eval commands:
  completion-timing-critique [options]   Replay completion-timing cases, score, judge, report
    --provider <p>    Force provider: openrouter
    --judge           Enable LLM-as-judge
    --scenario <s>    Filter by scenario
    --out <dir>       Output directory (default: evals/reports)

  completion-timing-validate             Structural validation of completion-timing golden cases (offline)

Grounding eval commands:
  grounding-critique [options]           Replay grounding cases, score, judge, report
    --provider <p>    Force provider: openrouter
    --judge           Enable LLM-as-judge
    --scenario <s>    Filter by scenario
    --out <dir>       Output directory (default: evals/reports)

  grounding-validate                     Structural validation of grounding golden cases (offline)

Tool-confusion eval commands:
  tool-confusion-critique [options]      Replay tool-confusion cases, score, judge, report
    --provider <p>    Force provider: openrouter
    --judge           Enable LLM-as-judge
    --pair <p>        Filter by confusion pair label
    --out <dir>       Output directory (default: evals/reports)

  tool-confusion-validate                Structural validation of tool-confusion golden cases (offline)

Context-efficiency eval commands:
  context-efficiency-critique [options]  Replay context-efficiency cases with A/B variants, score, report
    --scenario <s>    Filter by scenario (observation_masking, attribute_pruning, plan_persistence, time_awareness)

  context-efficiency-validate            Structural validation of context-efficiency golden cases (offline)
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

function cmdExtract(args: string[]) {
  const sessionId = args[0];
  const turnStr = args[1];
  if (!sessionId || !turnStr) {
    console.error("Usage: evals extract <session-id> <turn> [--correct-tool <name>] [--correct-args <json>] [--tag <pathology>] [--id <case-id>]");
    process.exit(1);
  }

  const turnNumber = parseInt(turnStr, 10);
  if (isNaN(turnNumber)) {
    console.error(`Invalid turn number: ${turnStr}`);
    process.exit(1);
  }

  const toolIdx = args.indexOf("--correct-tool");
  const correctTool = toolIdx !== -1 ? args[toolIdx + 1] : undefined;
  const argsIdx = args.indexOf("--correct-args");
  let correctArgs: Record<string, unknown> | undefined;
  if (argsIdx !== -1 && args[argsIdx + 1]) {
    try {
      correctArgs = JSON.parse(args[argsIdx + 1]);
    } catch {
      console.error("Invalid JSON for --correct-args");
      process.exit(1);
    }
  }
  const tagIdx = args.indexOf("--tag");
  const tag = tagIdx !== -1 ? args[tagIdx + 1] : undefined;
  const idIdx = args.indexOf("--id");
  const id = idIdx !== -1 ? args[idIdx + 1] : undefined;

  const outputPath = extractAndSave(sessionId, turnNumber, {
    correctTool,
    correctArgs,
    tag,
    id,
  });

  console.log(`${c.green}Golden case extracted${c.reset}`);
  console.log(`  File: ${outputPath}`);
}

async function cmdCritique(args: string[]) {
  const modelIdx = args.indexOf("--model");
  const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
  const tagIdx = args.indexOf("--tag");
  const tagFilter = tagIdx !== -1 ? args[tagIdx + 1] : undefined;
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : join("evals", "reports");
  const providerIdx = args.indexOf("--provider");
  const providerArg = providerIdx !== -1 ? args[providerIdx + 1] as EvalProvider : undefined;
  if (providerArg && providerArg !== "openrouter") {
    console.error(`${c.red}Invalid provider: ${providerArg}. Use "openrouter".${c.reset}`);
    process.exit(1);
  }

  // Load current system prompt instructions to inject into replays.
  // Golden cases have stale prompts baked in from trace extraction —
  // we replace the instructions portion while keeping original page context.
  const promptPath = join("prompts", "runtime", "agent", "system.md");
  let currentPrompt: string | undefined;
  if (existsSync(promptPath)) {
    const raw = readFileSync(promptPath, "utf-8");
    // Strip YAML front-matter and template variables
    let cleaned = raw.replace(/^---[\s\S]*?---\n?/, "").trim();
    // Remove template placeholders that won't be rendered ({{var}} lines)
    cleaned = cleaned.replace(/^\{\{[^}]+\}\}$/gm, "").replace(/\n{3,}/g, "\n\n");
    currentPrompt = cleaned.trim();
  }

  // 1. Load golden cases from evals/golden/
  const goldenDir = join("evals", "golden");
  if (!existsSync(goldenDir)) {
    console.error(`No golden directory found: ${goldenDir}`);
    process.exit(1);
  }

  const jsonFiles = readdirSync(goldenDir).filter((f) => f.endsWith(".json"));
  const jsonlFiles = readdirSync(goldenDir).filter((f) => f.endsWith(".jsonl"));
  if (jsonFiles.length === 0 && jsonlFiles.length === 0) {
    console.error("No golden files found in evals/golden/");
    process.exit(1);
  }

  let cases: EvalCase[] = [];
  for (const file of jsonFiles) {
    const content = readFileSync(join(goldenDir, file), "utf-8");
    cases.push(JSON.parse(content) as EvalCase);
  }
  for (const file of jsonlFiles) {
    const content = readFileSync(join(goldenDir, file), "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try { cases.push(JSON.parse(line) as EvalCase); } catch { /* skip */ }
    }
  }

  // 2. Filter by tag if specified
  if (tagFilter) {
    cases = cases.filter((cs) =>
      cs.metadata.pathology === tagFilter ||
      cs.metadata.tags?.includes(tagFilter),
    );
  }

  if (cases.length === 0) {
    console.error(`No golden cases found${tagFilter ? ` matching tag "${tagFilter}"` : ""}`);
    process.exit(1);
  }

  let keys: ApiKeys;
  try {
    keys = loadApiKeys();
  } catch (err: any) {
    console.error(`${c.red}${err.message}${c.reset}`);
    process.exit(1);
  }

  const provider: EvalProvider = providerArg ?? ("openrouter");

  console.log(`${c.bold}Running critique on ${cases.length} golden case(s) [provider: ${provider}]${c.reset}\n`);

  const results: EvalResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    const replayModel = model ?? evalCase.input.model;
    const pathology = evalCase.metadata.pathology ?? "untagged";

    process.stdout.write(
      `  [${i + 1}/${cases.length}] ${pathology} ${evalCase.id.slice(0, 30)}... `,
    );

    const start = Date.now();
    let result: EvalResult;

    try {
      // 3. Replay (inject current system prompt so prompt edits are tested)
      const actual = await replayCase(keys, evalCase, replayModel, currentPrompt, provider);
      const durationMs = Date.now() - start;

      // 4. Score
      const expectedToolCalls = evalCase.expected.toolCalls.map((tc) => ({
        toolName: tc.toolName as string,
        args: tc.args,
      }));

      const toolNameScore = scoreToolNameMatch(expectedToolCalls, actual.toolCalls);
      const toolParamScore = scoreToolParamMatch(expectedToolCalls, actual.toolCalls);
      const sequenceScore = scoreSequenceMatch(expectedToolCalls, actual.toolCalls);
      const composite = toolNameScore * 0.45 + toolParamScore * 0.25 + sequenceScore * 0.3;
      const pass = toolNameScore >= 0.8 && sequenceScore >= 0.7;

      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs,
        status: pass ? "pass" : "fail",
        actual,
        scores: {
          toolNameMatch: toolNameScore,
          toolParamMatch: toolParamScore,
          sequenceMatch: sequenceScore,
          composite,
        },
      };

      // 5. Judge every case (not just failures)
      try {
        result.scores.judge = await judgeCase(keys.openrouter, evalCase, actual);
        if (result.scores.judge.pass && result.status === "fail") {
          result.status = "pass"; // Judge override
        }
      } catch (err: any) {
        console.warn(`judge error: ${err.message}`);
      }

      const statusColor = result.status === "pass" ? c.green : c.red;
      console.log(
        `${statusColor}${result.status}${c.reset} ` +
        `names=${toolNameScore.toFixed(2)} seq=${sequenceScore.toFixed(2)} ` +
        `${durationMs}ms`,
      );
    } catch (err: any) {
      result = {
        caseId: evalCase.id,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
        status: "error",
        actual: { toolCalls: [], text: null },
        scores: { toolNameMatch: 0, toolParamMatch: 0, sequenceMatch: 0 },
        error: err.message,
      };
      console.log(`${c.red}error${c.reset} ${err.message.slice(0, 80)}`);
    }

    results.push(result);
  }

  // 6. Generate report
  const caseById = new Map(cases.map((cs) => [cs.id, cs]));
  const report = buildCritiqueReport({ cases, results, caseById });

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outDir, `critique-${stamp}.md`);
  writeFileSync(mdPath, report, "utf-8");

  // Summary
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\n${c.bold}Results: ${passed} passed, ${failed} failed, ${errors} errors${c.reset}`);
  console.log(`Report: ${mdPath}`);
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

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(0)}%`;
}

// ── Escalation commands ──────────────────────────────────────────────

async function cmdEscalationCritique(args: string[]) {
  const judgeFlag = args.includes("--judge");
  const plannerModelIdx = args.indexOf("--planner-model");
  const plannerModelArg = plannerModelIdx !== -1 ? args[plannerModelIdx + 1] : "deepseek";
  if (plannerModelArg !== "deepseek" && plannerModelArg !== "deepseek-base") {
    console.error(`${c.red}Invalid --planner-model: ${plannerModelArg}. Use "deepseek" or "deepseek-base".${c.reset}`);
    process.exit(1);
  }
  const scenarioIdx = args.indexOf("--scenario");
  const scenarioFilter = scenarioIdx !== -1 ? args[scenarioIdx + 1] : undefined;
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : join("evals", "reports");

  let keys: ApiKeys;
  try {
    keys = loadApiKeys();
  } catch (err: any) {
    console.error(`${c.red}${err.message}${c.reset}`);
    process.exit(1);
  }

  const { readEscalationGoldenCases } = await import("./utils");
  const cases = readEscalationGoldenCases();

  if (cases.length === 0) {
    console.error(`${c.red}No escalation golden cases found in evals/golden/escalation/${c.reset}`);
    process.exit(1);
  }

  const plannerLabel = "deepseek-v3.2";
  console.log(`${c.bold}Escalation Critique: ${cases.length} golden case(s) [planner: ${plannerLabel}]${c.reset}\n`);

  const results = await runEscalationEvals({
    keys,
    plannerModel: plannerModelArg as PlannerModel,
    judge: judgeFlag,
    scenarioFilter,
  });

  if (results.length === 0) return;

  const report = buildEscalationReport({ cases, results });

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outDir, `escalation-critique-${stamp}.md`);
  writeFileSync(mdPath, report, "utf-8");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\n${c.bold}Escalation: ${passed} passed, ${failed} failed, ${errors} errors${c.reset}`);
  console.log(`Report: ${mdPath}`);
}

async function cmdEscalationValidate() {
  const { readEscalationGoldenCases } = await import("./utils");
  const cases = readEscalationGoldenCases();

  if (cases.length === 0) {
    console.log(`${c.yellow}No escalation golden cases found in evals/golden/escalation/${c.reset}`);
    return;
  }

  console.log(`${c.bold}Validating ${cases.length} escalation golden case(s)...${c.reset}\n`);

  let valid = 0;
  let invalid = 0;

  for (const goldenCase of cases) {
    const errors: string[] = [];

    // Required fields
    if (!goldenCase.id) errors.push("missing id");
    if (!goldenCase.scenario) errors.push("missing scenario");
    if (!["easy", "medium", "hard"].includes(goldenCase.difficulty)) errors.push("invalid difficulty");

    // Fast phase
    if (!goldenCase.fastPhase?.snapshot?.url) errors.push("missing fastPhase.snapshot.url");
    if (!Array.isArray(goldenCase.fastPhase?.elements) || goldenCase.fastPhase.elements.length === 0) {
      errors.push("empty or missing fastPhase.elements");
    }
    if (!goldenCase.fastPhase?.objective) errors.push("missing fastPhase.objective");
    if (!Array.isArray(goldenCase.fastPhase?.stagnantHistory) || goldenCase.fastPhase.stagnantHistory.length === 0) {
      errors.push("empty or missing fastPhase.stagnantHistory");
    }

    // Expected fast action
    if (goldenCase.expectedFastAction !== "escalate") {
      errors.push(`expectedFastAction should be "escalate", got "${goldenCase.expectedFastAction}"`);
    }

    // Smart phase
    if (!goldenCase.smartPhase?.snapshot?.url) errors.push("missing smartPhase.snapshot.url");
    if (!Array.isArray(goldenCase.smartPhase?.elements) || goldenCase.smartPhase.elements.length === 0) {
      errors.push("empty or missing smartPhase.elements");
    }
    if (!goldenCase.smartPhase?.escalationReason) errors.push("missing smartPhase.escalationReason");

    // Expected smart action
    if (!goldenCase.expectedSmartAction?.toolName) errors.push("missing expectedSmartAction.toolName");

    // Metadata
    if (!goldenCase.metadata?.curatedAt) errors.push("missing metadata.curatedAt");

    if (errors.length > 0) {
      console.log(`  ${c.red}INVALID${c.reset} ${goldenCase.id}: ${errors.join(", ")}`);
      invalid++;
    } else {
      const altCount = goldenCase.expectedSmartAction?.acceptAlternatives?.length ?? 0;
      console.log(
        `  ${c.green}VALID${c.reset}   ${goldenCase.id} ` +
        `(${goldenCase.scenario}, ${goldenCase.difficulty}, ` +
        `${goldenCase.fastPhase.stagnantHistory.length} stagnant turns, ` +
        `planner: ${goldenCase.expectedSmartAction.toolName}${altCount > 0 ? ` +${altCount} alt` : ""})`,
      );
      valid++;
    }
  }

  console.log(`\n${c.bold}Validation: ${valid} valid, ${invalid} invalid${c.reset}`);
  if (invalid > 0) process.exit(1);
}

// ── Completion-timing commands ────────────────────────────────────────

async function cmdCompletionTimingCritique(args: string[]) {
  const judgeFlag = args.includes("--judge");
  const providerIdx = args.indexOf("--provider");
  const providerArg = providerIdx !== -1 ? args[providerIdx + 1] : undefined;
  if (providerArg && providerArg !== "openrouter") {
    console.error(`${c.red}Invalid --provider: ${providerArg}. Use "openrouter".${c.reset}`);
    process.exit(1);
  }
  const scenarioIdx = args.indexOf("--scenario");
  const scenarioFilter = scenarioIdx !== -1 ? args[scenarioIdx + 1] : undefined;
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : join("evals", "reports");

  let keys: ApiKeys;
  try {
    keys = loadApiKeys();
  } catch (err: any) {
    console.error(`${c.red}${err.message}${c.reset}`);
    process.exit(1);
  }

  const { readCompletionTimingGoldenCases } = await import("./utils");
  const cases = readCompletionTimingGoldenCases();

  if (cases.length === 0) {
    console.error(`${c.red}No completion-timing golden cases found in evals/golden/completion-timing/${c.reset}`);
    process.exit(1);
  }

  const provider: CompletionTimingProvider = (providerArg as CompletionTimingProvider) ?? ("openrouter");
  console.log(`${c.bold}Completion-Timing Critique: ${cases.length} golden case(s) [provider: ${provider}]${c.reset}\n`);

  const results = await runCompletionTimingEvals({
    keys,
    provider,
    judge: judgeFlag,
    scenarioFilter,
  });

  if (results.length === 0) return;

  const report = buildCompletionTimingReport({ cases, results });

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outDir, `completion-timing-critique-${stamp}.md`);
  writeFileSync(mdPath, report, "utf-8");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\n${c.bold}Completion-Timing: ${passed} passed, ${failed} failed, ${errors} errors${c.reset}`);
  console.log(`Report: ${mdPath}`);
}

async function cmdCompletionTimingValidate() {
  const { readCompletionTimingGoldenCases } = await import("./utils");
  const cases = readCompletionTimingGoldenCases();

  if (cases.length === 0) {
    console.log(`${c.yellow}No completion-timing golden cases found in evals/golden/completion-timing/${c.reset}`);
    return;
  }

  console.log(`${c.bold}Validating ${cases.length} completion-timing golden case(s)...${c.reset}\n`);

  let valid = 0;
  let invalid = 0;

  for (const goldenCase of cases) {
    const errors: string[] = [];

    // Required fields
    if (!goldenCase.id) errors.push("missing id");
    if (!goldenCase.scenario) errors.push("missing scenario");
    if (!["easy", "medium", "hard"].includes(goldenCase.difficulty)) errors.push("invalid difficulty");

    // Snapshot
    if (!goldenCase.snapshot?.url) errors.push("missing snapshot.url");
    if (!goldenCase.snapshot?.title) errors.push("missing snapshot.title");

    // Elements
    if (!Array.isArray(goldenCase.elements) || goldenCase.elements.length === 0) {
      errors.push("empty or missing elements");
    }

    // Objective and perception
    if (!goldenCase.objective) errors.push("missing objective");
    if (!goldenCase.perception) errors.push("missing perception");

    // Plan
    if (!Array.isArray(goldenCase.plan) || goldenCase.plan.length === 0) {
      errors.push("empty or missing plan");
    } else {
      for (const step of goldenCase.plan) {
        if (!step.step) errors.push("plan step missing text");
        if (!["completed", "pending"].includes(step.status)) errors.push(`invalid plan status: ${step.status}`);
      }
    }

    // Action history
    if (!Array.isArray(goldenCase.actionHistory) || goldenCase.actionHistory.length === 0) {
      errors.push("empty or missing actionHistory");
    }

    // Expected action
    if (goldenCase.expectedAction !== "done" && goldenCase.expectedAction !== "continue") {
      errors.push(`invalid expectedAction: ${goldenCase.expectedAction}`);
    }

    // Metadata
    if (!goldenCase.metadata?.curatedAt) errors.push("missing metadata.curatedAt");

    if (errors.length > 0) {
      console.log(`  ${c.red}INVALID${c.reset} ${goldenCase.id}: ${errors.join(", ")}`);
      invalid++;
    } else {
      const pendingSteps = goldenCase.plan.filter((p) => p.status === "pending").length;
      const completedSteps = goldenCase.plan.filter((p) => p.status === "completed").length;
      console.log(
        `  ${c.green}VALID${c.reset}   ${goldenCase.id} ` +
        `(${goldenCase.scenario}, ${goldenCase.difficulty}, ` +
        `expected: ${goldenCase.expectedAction}, ` +
        `plan: ${completedSteps} done / ${pendingSteps} pending, ` +
        `${goldenCase.actionHistory.length} actions)`,
      );
      valid++;
    }
  }

  console.log(`\n${c.bold}Validation: ${valid} valid, ${invalid} invalid${c.reset}`);
  if (invalid > 0) process.exit(1);
}

// ── Grounding commands ────────────────────────────────────────────────

async function cmdGroundingCritique(args: string[]) {
  const judgeFlag = args.includes("--judge");
  const providerIdx = args.indexOf("--provider");
  const providerArg = providerIdx !== -1 ? args[providerIdx + 1] : undefined;
  if (providerArg && providerArg !== "openrouter") {
    console.error(`${c.red}Invalid --provider: ${providerArg}. Use "openrouter".${c.reset}`);
    process.exit(1);
  }
  const scenarioIdx = args.indexOf("--scenario");
  const scenarioFilter = scenarioIdx !== -1 ? args[scenarioIdx + 1] : undefined;
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : join("evals", "reports");

  let keys: ApiKeys;
  try {
    keys = loadApiKeys();
  } catch (err: any) {
    console.error(`${c.red}${err.message}${c.reset}`);
    process.exit(1);
  }

  const { readGroundingGoldenCases } = await import("./utils");
  const cases = readGroundingGoldenCases();

  if (cases.length === 0) {
    console.error(`${c.red}No grounding golden cases found in evals/golden/grounding/${c.reset}`);
    process.exit(1);
  }

  const provider: GroundingProvider = (providerArg as GroundingProvider) ?? ("openrouter");
  console.log(`${c.bold}Grounding Critique: ${cases.length} golden case(s) [provider: ${provider}]${c.reset}\n`);

  const results = await runGroundingEvals({
    keys,
    provider,
    judge: judgeFlag,
    scenarioFilter,
  });

  if (results.length === 0) return;

  const report = buildGroundingReport({ cases, results });

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outDir, `grounding-critique-${stamp}.md`);
  writeFileSync(mdPath, report, "utf-8");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\n${c.bold}Grounding: ${passed} passed, ${failed} failed, ${errors} errors${c.reset}`);
  console.log(`Report: ${mdPath}`);
}

async function cmdGroundingValidate() {
  const { readGroundingGoldenCases } = await import("./utils");
  const cases = readGroundingGoldenCases();

  if (cases.length === 0) {
    console.log(`${c.yellow}No grounding golden cases found in evals/golden/grounding/${c.reset}`);
    return;
  }

  console.log(`${c.bold}Validating ${cases.length} grounding golden case(s)...${c.reset}\n`);

  let valid = 0;
  let invalid = 0;

  for (const goldenCase of cases) {
    const errors: string[] = [];

    // Required fields
    if (!goldenCase.id) errors.push("missing id");
    if (!goldenCase.scenario) errors.push("missing scenario");
    if (!["easy", "medium", "hard"].includes(goldenCase.difficulty)) errors.push("invalid difficulty");

    // Snapshot
    if (!goldenCase.snapshot?.url) errors.push("missing snapshot.url");
    if (!goldenCase.snapshot?.title) errors.push("missing snapshot.title");

    // Elements
    if (!Array.isArray(goldenCase.elements) || goldenCase.elements.length === 0) {
      errors.push("empty or missing elements");
    }

    // Page content
    if (!goldenCase.pageContent) errors.push("missing pageContent");

    // Instruction
    if (!goldenCase.instruction) errors.push("missing instruction");

    // Expected
    if (goldenCase.expected == null) {
      errors.push("missing expected");
    } else {
      if (typeof goldenCase.expected.shouldDetectMismatch !== "boolean") {
        errors.push("missing expected.shouldDetectMismatch");
      }
      if (!goldenCase.expected.expectedTool) errors.push("missing expected.expectedTool");
      if (!Array.isArray(goldenCase.expected.trapActions)) errors.push("missing expected.trapActions");
    }

    // Prior history (optional but if present must be array)
    if (goldenCase.priorHistory !== null && !Array.isArray(goldenCase.priorHistory)) {
      errors.push("priorHistory must be null or array");
    }

    // Metadata
    if (!goldenCase.metadata?.curatedAt) errors.push("missing metadata.curatedAt");

    if (errors.length > 0) {
      console.log(`  ${c.red}INVALID${c.reset} ${goldenCase.id}: ${errors.join(", ")}`);
      invalid++;
    } else {
      const altCount = goldenCase.expected?.acceptAlternatives?.length ?? 0;
      const histCount = goldenCase.priorHistory?.length ?? 0;
      console.log(
        `  ${c.green}VALID${c.reset}   ${goldenCase.id} ` +
        `(${goldenCase.scenario}, ${goldenCase.difficulty}, ` +
        `mismatch: ${goldenCase.expected.shouldDetectMismatch}, ` +
        `tool: ${goldenCase.expected.expectedTool}${altCount > 0 ? ` +${altCount} alt` : ""}, ` +
        `${histCount} prior turns)`,
      );
      valid++;
    }
  }

  console.log(`\n${c.bold}Validation: ${valid} valid, ${invalid} invalid${c.reset}`);
  if (invalid > 0) process.exit(1);
}

// ── Tool-confusion commands ───────────────────────────────────────────

async function cmdToolConfusionCritique(args: string[]) {
  const judgeFlag = args.includes("--judge");
  const providerIdx = args.indexOf("--provider");
  const providerArg = providerIdx !== -1 ? args[providerIdx + 1] : undefined;
  if (providerArg && providerArg !== "openrouter") {
    console.error(`${c.red}Invalid --provider: ${providerArg}. Use "openrouter".${c.reset}`);
    process.exit(1);
  }
  const pairIdx = args.indexOf("--pair");
  const pairFilter = pairIdx !== -1 ? args[pairIdx + 1] : undefined;
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : join("evals", "reports");

  let keys: ApiKeys;
  try {
    keys = loadApiKeys();
  } catch (err: any) {
    console.error(`${c.red}${err.message}${c.reset}`);
    process.exit(1);
  }

  const { readToolConfusionGoldenCases } = await import("./utils");
  const cases = readToolConfusionGoldenCases();

  if (cases.length === 0) {
    console.error(`${c.red}No tool-confusion golden cases found in evals/golden/tool-confusion/${c.reset}`);
    process.exit(1);
  }

  const provider: ToolConfusionProvider = (providerArg as ToolConfusionProvider) ?? ("openrouter");
  console.log(`${c.bold}Tool-Confusion Critique: ${cases.length} golden case(s) [provider: ${provider}]${c.reset}\n`);

  const results = await runToolConfusionEvals({
    keys,
    provider,
    judge: judgeFlag,
    pairFilter,
  });

  if (results.length === 0) return;

  const report = buildToolConfusionReport({ cases, results });

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = join(outDir, `tool-confusion-critique-${stamp}.md`);
  writeFileSync(mdPath, report, "utf-8");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  console.log(`\n${c.bold}Tool-Confusion: ${passed} passed, ${failed} failed, ${errors} errors${c.reset}`);
  console.log(`Report: ${mdPath}`);
}

async function cmdToolConfusionValidate() {
  const { readToolConfusionGoldenCases } = await import("./utils");
  const cases = readToolConfusionGoldenCases();

  if (cases.length === 0) {
    console.log(`${c.yellow}No tool-confusion golden cases found in evals/golden/tool-confusion/${c.reset}`);
    return;
  }

  console.log(`${c.bold}Validating ${cases.length} tool-confusion golden case(s)...${c.reset}\n`);

  let valid = 0;
  let invalid = 0;

  for (const goldenCase of cases) {
    const errors: string[] = [];

    // Required fields
    if (!goldenCase.id) errors.push("missing id");
    if (!goldenCase.scenario) errors.push("missing scenario");
    if (!["easy", "medium", "hard"].includes(goldenCase.difficulty)) errors.push("invalid difficulty");

    // Confusion pair
    if (!goldenCase.confusionPair?.toolA) errors.push("missing confusionPair.toolA");
    if (!goldenCase.confusionPair?.toolB) errors.push("missing confusionPair.toolB");
    if (!goldenCase.confusionPair?.label) errors.push("missing confusionPair.label");

    // Snapshot
    if (!goldenCase.snapshot?.url) errors.push("missing snapshot.url");
    if (!goldenCase.snapshot?.title) errors.push("missing snapshot.title");

    // Elements
    if (!Array.isArray(goldenCase.elements) || goldenCase.elements.length === 0) {
      errors.push("empty or missing elements");
    }

    // Page content
    if (!goldenCase.pageContent) errors.push("missing pageContent");

    // Instruction
    if (!goldenCase.instruction) errors.push("missing instruction");

    // Expected
    if (goldenCase.expected == null) {
      errors.push("missing expected");
    } else {
      if (!goldenCase.expected.correctTool) errors.push("missing expected.correctTool");
      if (!Array.isArray(goldenCase.expected.antiPatternTools)) errors.push("missing expected.antiPatternTools");
      if (!goldenCase.expected.rationale) errors.push("missing expected.rationale");
    }

    // Prior history (optional but if present must be array)
    if (goldenCase.priorHistory !== null && !Array.isArray(goldenCase.priorHistory)) {
      errors.push("priorHistory must be null or array");
    }

    // Metadata
    if (!goldenCase.metadata?.curatedAt) errors.push("missing metadata.curatedAt");

    if (errors.length > 0) {
      console.log(`  ${c.red}INVALID${c.reset} ${goldenCase.id}: ${errors.join(", ")}`);
      invalid++;
    } else {
      const altCount = goldenCase.expected?.acceptAlternatives?.length ?? 0;
      const histCount = goldenCase.priorHistory?.length ?? 0;
      console.log(
        `  ${c.green}VALID${c.reset}   ${goldenCase.id} ` +
        `(${goldenCase.confusionPair.label}, ${goldenCase.difficulty}, ` +
        `correct: ${goldenCase.expected.correctTool}${altCount > 0 ? ` +${altCount} alt` : ""}, ` +
        `anti: ${goldenCase.expected.antiPatternTools.join(",")}, ` +
        `${histCount} prior turns)`,
      );
      valid++;
    }
  }

  console.log(`\n${c.bold}Validation: ${valid} valid, ${invalid} invalid${c.reset}`);
  if (invalid > 0) process.exit(1);
}

// ── Context-efficiency commands ──────────────────────────────────────

async function cmdContextEfficiencyCritique(args: string[]) {
  const { loadApiKeys } = await import("./utils");
  const { runContextEfficiencyEvals } = await import("./context-efficiency-runner");

  const keys = loadApiKeys();
  const scenarioIdx = args.indexOf("--scenario");
  const scenarioFilter = scenarioIdx !== -1 ? args[scenarioIdx + 1] : undefined;

  await runContextEfficiencyEvals({
    keys,
    scenarioFilter,
  });
}

async function cmdContextEfficiencyValidate() {
  const { validateContextEfficiencyGoldenCases } = await import("./context-efficiency-runner");
  const { invalid } = validateContextEfficiencyGoldenCases();
  if (invalid > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`${c.red}Error: ${err.message}${c.reset}`);
  process.exit(1);
});
