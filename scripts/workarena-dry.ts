#!/usr/bin/env tsx

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

type DryResult = {
  benchmark: "workarena";
  mode: "dry";
  taskId: string;
  envId: string;
  seed: number;
  category: string | null;
  kind: "atomic" | "compositional";
  level: string | null;
  className: string;
  resetAttempted: boolean;
  resetSucceeded: boolean;
  teardownSucceeded: boolean | null;
  durationMs: number;
  goal: string | null;
  goalObject: Array<Record<string, unknown>>;
  startUrl: string | null;
  activeUrl: string | null;
  openPages: string[];
  openPageTitles: string[];
  taskInfo: Record<string, unknown>;
  error: string | null;
  notes: string[];
  reportPath?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const BRIDGE_PATH = resolve(__dirname, "workarena-bridge.py");
const REPORTS_DIR = resolve(PROJECT_ROOT, ".artifacts", "e2e");
const DEFAULT_VENV_PYTHON = resolve(
  PROJECT_ROOT,
  ".artifacts",
  "workarena",
  ".venv",
  "Scripts",
  "python.exe",
);

function parseArgs(): {
  taskId: string | null;
  seed: number;
  json: boolean;
  noReport: boolean;
  noReset: boolean;
  showBrowser: boolean;
} {
  const args = process.argv.slice(2);
  const taskArg = args[args.indexOf("--task") + 1];
  const seedArg = Number.parseInt(args[args.indexOf("--seed") + 1] ?? "", 10);
  return {
    taskId: taskArg && !taskArg.startsWith("--") ? taskArg : null,
    seed: Number.isFinite(seedArg) ? seedArg : 42,
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
    noReset: args.includes("--no-reset"),
    showBrowser: args.includes("--show-browser"),
  };
}

function loadDotEnv(): Record<string, string> {
  const envPath = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) return {};

  const env: Record<string, string> = {};
  const content = readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function resolvePythonExecutable(): string {
  if (process.env.WORKARENA_PYTHON) return process.env.WORKARENA_PYTHON;
  if (existsSync(DEFAULT_VENV_PYTHON)) return DEFAULT_VENV_PYTHON;
  return "python";
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function writeReport(result: DryResult): string {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const safeTask = result.taskId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const reportPath = resolve(REPORTS_DIR, `workarena-dry-${today()}-${safeTask}.json`);
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  return reportPath;
}

function runDry(): DryResult {
  const args = parseArgs();
  if (!args.taskId) {
    throw new Error("--task is required");
  }

  const bridgeArgs = [
    BRIDGE_PATH,
    "dry",
    "--task",
    args.taskId,
    "--seed",
    String(args.seed),
  ];
  if (args.noReset) bridgeArgs.push("--no-reset");
  if (args.showBrowser) bridgeArgs.push("--show-browser");

  const result = spawnSync(resolvePythonExecutable(), bridgeArgs, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...loadDotEnv(),
    },
    encoding: "utf-8",
    timeout: 300_000,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `python exited with ${result.status}`).trim(),
    );
  }

  return JSON.parse(result.stdout) as DryResult;
}

function compactGoal(goal: string | null): string {
  if (!goal) return "(none)";
  const compact = goal.replace(/\s+/g, " ").trim();
  if (compact.length <= 240) return compact;
  return `${compact.slice(0, 237)}...`;
}

function printHuman(result: DryResult): void {
  console.log("\n[workarena:dry] WorkArena dry run");
  console.log(`[workarena:dry] Task: ${result.taskId}`);
  console.log(`[workarena:dry] Env: ${result.envId}`);
  console.log(`[workarena:dry] Seed: ${result.seed}`);
  console.log(`[workarena:dry] Category: ${result.category ?? "uncategorized"}`);
  console.log(`[workarena:dry] Kind: ${result.kind}`);
  console.log(
    `[workarena:dry] Reset: ${
      result.resetAttempted ? (result.resetSucceeded ? "ok" : "not ok") : "skipped"
    }`,
  );
  console.log(
    `[workarena:dry] Teardown: ${
      result.teardownSucceeded === null
        ? "not attempted"
        : result.teardownSucceeded
          ? "ok"
          : "not ok"
    }`,
  );
  console.log(`[workarena:dry] Duration: ${Math.round(result.durationMs / 1000)}s`);
  if (result.reportPath) {
    console.log(`[workarena:dry] Report: ${result.reportPath}`);
  }
  console.log("");
  console.log(`[workarena:dry] Start URL: ${result.startUrl ?? "(none)"}`);
  console.log(`[workarena:dry] Active URL: ${result.activeUrl ?? "(none)"}`);
  console.log(`[workarena:dry] Goal: ${compactGoal(result.goal)}`);
  if (result.error) {
    console.log(`[workarena:dry] Error: ${result.error}`);
  }
}

function main(): void {
  const args = parseArgs();
  const result = runDry();
  if (!args.noReport) {
    result.reportPath = writeReport(result);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  if (!result.resetSucceeded && !args.noReset) {
    process.exitCode = 1;
  }
}

main();
