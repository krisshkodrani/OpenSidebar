#!/usr/bin/env tsx
/**
 * Public benchmark runner CLI (RFC LP-1, Stage 1).
 *
 * Orchestrates a sweep end-to-end and prints a score:
 *   1. build the extension (unless --no-build),
 *   2. drive each task on headed Chrome via the bench vitest config
 *      (online-mind2web.bench.test.ts), which writes per-task evidence,
 *   3. judge each task with WebJudge (separate judge model),
 *   4. aggregate into a headline score + Markdown report + machine summary.
 *
 * The model config under test is whatever E2E_PROVIDER / E2E_MODEL select, so a
 * sweep is reproducible and you can publish 2–3 configs by re-running with
 * different pairings. Judge and score passes can run standalone (--judge-only)
 * to re-score an existing run without paying for browser runs again.
 *
 * Usage:
 *   pnpm run bench [options]
 *     --tasks <file>     task file (default: online-mind2web.json if present, else sample.json)
 *     --size <n>         stratified subset size (default: all)
 *     --levels <list>    comma list: easy,medium,hard (default: all)
 *     --task-ids <list>  comma list of exact task IDs (default: all selected)
 *     --seed <n>         subset seed (default: 0)
 *     --max-turns <n>    per-task max turns (default: 25)
 *     --config-label <s> label for the report (default: provider/model)
 *     --run-dir <dir>    output dir (default: .artifacts/bench/<timestamp>)
 *     --no-build         skip the extension build
 *     --no-judge         run tasks only; skip judging/scoring
 *     --judge-only       skip running; judge+score an existing --run-dir
 *     --allow-writes     do NOT skip write-mutating tasks (sandboxes only)
 */

import { execSync, spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  loadApiKey,
  loadOpenAiApiKey,
} from "../apps/extension/tests/e2e/helpers/e2e-provider-config";
import { judgeTask, type JudgeClientConfig } from "./bench/webjudge";
import { aggregateResults, formatBenchReport } from "./bench/aggregate";
import type {
  BenchRunEvidence,
  BenchTaskResult,
} from "./bench/types";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const APP_DIR = resolve(PROJECT_ROOT, "apps/extension");
const BENCH_CONFIG = resolve(APP_DIR, "tests/bench/vitest.bench.config.ts");
const VITEST_CLI = resolve(PROJECT_ROOT, "node_modules/vitest/vitest.mjs");

interface CliOptions {
  tasksFile: string;
  size?: number;
  levels?: string;
  taskIds?: string;
  seed: number;
  maxTurns: number;
  configLabel: string;
  runDir: string;
  build: boolean;
  judge: boolean;
  judgeOnly: boolean;
  allowWrites: boolean;
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function defaultTasksFile(): string {
  const official = resolve(PROJECT_ROOT, "scripts/bench/tasks/online-mind2web.json");
  const sample = resolve(PROJECT_ROOT, "scripts/bench/tasks/sample.json");
  return existsSync(official) ? official : sample;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const provider = process.env.E2E_PROVIDER ?? "fireworks";
  const model = process.env.E2E_MODEL ?? "(default)";
  const plannerModel = process.env.E2E_PLANNER_MODEL ?? "(default)";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tasksArg = flagValue(args, "--tasks");
  return {
    tasksFile: tasksArg ? resolve(process.cwd(), tasksArg) : defaultTasksFile(),
    size: flagValue(args, "--size") ? Number(flagValue(args, "--size")) : undefined,
    levels: flagValue(args, "--levels"),
    taskIds: flagValue(args, "--task-ids"),
    seed: Number(flagValue(args, "--seed") ?? "0"),
    maxTurns: Number(flagValue(args, "--max-turns") ?? "25"),
    configLabel:
      flagValue(args, "--config-label") ??
      `${provider} / executor=${model} / planner=${plannerModel}`,
    runDir:
      flagValue(args, "--run-dir") ??
      resolve(PROJECT_ROOT, ".artifacts/bench", stamp),
    build: !args.includes("--no-build"),
    judge: !args.includes("--no-judge"),
    judgeOnly: args.includes("--judge-only"),
    allowWrites: args.includes("--allow-writes"),
  };
}

function runVitestBench(options: CliOptions): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn(process.execPath, [VITEST_CLI, "run", "--config", BENCH_CONFIG], {
      cwd: APP_DIR,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        BENCH_TASKS_FILE: options.tasksFile,
        BENCH_RUN_DIR: options.runDir,
        BENCH_SEED: String(options.seed),
        BENCH_MAX_TURNS: String(options.maxTurns),
        ...(options.size != null ? { BENCH_SIZE: String(options.size) } : {}),
        ...(options.levels ? { BENCH_LEVELS: options.levels } : {}),
        ...(options.taskIds ? { BENCH_TASK_IDS: options.taskIds } : {}),
        ...(options.allowWrites ? { BENCH_ALLOW_WRITES: "1" } : {}),
      },
    });
    child.on("close", (code) => resolveExit(code ?? 1));
    child.on("error", () => resolveExit(1));
  });
}

function readEvidence(runDir: string): BenchRunEvidence[] {
  const tasksDir = join(runDir, "tasks");
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return JSON.parse(readFileSync(join(tasksDir, name), "utf-8")) as BenchRunEvidence;
      } catch {
        return null;
      }
    })
    .filter((evidence): evidence is BenchRunEvidence => evidence != null);
}

function resolveJudgeConfig(): JudgeClientConfig | null {
  const explicitKey = process.env.BENCH_JUDGE_API_KEY;
  const openRouterKey = loadApiKey() ?? process.env.OPENROUTER_API_KEY;
  const openAiKey = loadOpenAiApiKey();
  const apiKey = explicitKey ?? openRouterKey ?? openAiKey;
  if (!apiKey) return null;
  // Without an explicit judge key or an OpenRouter key, judge via OpenAI
  // direct (different base URL and un-prefixed model id).
  const viaOpenAi = !explicitKey && !openRouterKey;
  return {
    baseUrl:
      process.env.BENCH_JUDGE_BASE_URL ??
      (viaOpenAi ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1"),
    apiKey,
    model:
      process.env.BENCH_JUDGE_MODEL ??
      (viaOpenAi ? "gpt-5.4-mini" : "openai/gpt-5.4-mini"),
    headers: {
      "HTTP-Referer": "https://github.com/krisshkodrani/OpenSidebar",
      "X-Title": "OpenSidebar Bench WebJudge",
    },
  };
}

function readManifest(runDir: string): { source: string; revision: string } {
  const manifestPath = join(runDir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      return {
        source: String(manifest.source ?? "unknown"),
        revision: String(manifest.revision ?? "unknown"),
      };
    } catch {
      // fall through
    }
  }
  return { source: "unknown", revision: "unknown" };
}

async function judgeAndScore(options: CliOptions): Promise<void> {
  const evidence = readEvidence(options.runDir);
  if (evidence.length === 0) {
    console.error(
      `[bench] No task evidence found in ${options.runDir}/tasks. Did the run produce results?`,
    );
    process.exitCode = 1;
    return;
  }

  const judgeConfig = options.judge ? resolveJudgeConfig() : null;
  if (options.judge && !judgeConfig) {
    console.warn(
      "[bench] No judge key (BENCH_JUDGE_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY). Recording evidence without verdicts.",
    );
  }

  const results: BenchTaskResult[] = [];
  for (const item of evidence) {
    if (item.completionStatus === "skipped" || !judgeConfig) {
      results.push({ evidence: item, verdict: null });
      continue;
    }
    const verdict = await judgeTask(item.task, item, judgeConfig);
    results.push({ evidence: item, verdict });
    console.log(
      `[bench] judge ${item.task.task_id}: ${verdict.outcome}` +
        (verdict.confidence != null ? ` (${verdict.confidence})` : ""),
    );
  }

  const aggregate = aggregateResults(results);
  const manifest = readManifest(options.runDir);
  const report = formatBenchReport(aggregate, {
    source: manifest.source,
    revision: manifest.revision,
    modelConfigLabel: options.configLabel,
    judgeModel: judgeConfig?.model ?? "(none — unscored)",
    date: new Date().toISOString().split("T")[0],
    manualDisagreementRate: null,
  });

  writeFileSync(
    join(options.runDir, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
    "utf-8",
  );
  writeFileSync(
    join(options.runDir, "summary.json"),
    `${JSON.stringify(aggregate, null, 2)}\n`,
    "utf-8",
  );
  writeFileSync(join(options.runDir, "report.md"), report, "utf-8");

  console.log(`\n${report}`);
  console.log(`[bench] Artifacts written to ${options.runDir}`);
}

async function main(): Promise<void> {
  const options = parseArgs();
  const executorModel = process.env.E2E_MODEL ?? "(default)";
  const plannerModel = process.env.E2E_PLANNER_MODEL ?? "(default)";
  mkdirSync(options.runDir, { recursive: true });
  console.log(`[bench] Run dir: ${options.runDir}`);
  console.log(`[bench] Tasks:   ${options.tasksFile}`);
  console.log(`[bench] Config:  ${options.configLabel}`);
  console.log(`[bench] Executor: ${executorModel}`);
  console.log(`[bench] Planner:  ${plannerModel}`);

  let runnerFailed = false;
  if (!options.judgeOnly) {
    if (options.build) {
      console.log("[bench] Building extension…");
      execSync("corepack pnpm run build", {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
        windowsHide: true,
      });
    }
    const exitCode = await runVitestBench(options);
    if (exitCode !== 0) {
      runnerFailed = true;
      console.warn(
        `[bench] Runner exited ${exitCode}; scoring whatever evidence was produced.`,
      );
    }
  }

  await judgeAndScore(options);
  if (runnerFailed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[bench] Fatal:", error);
  process.exit(1);
});
