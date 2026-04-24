#!/usr/bin/env tsx

import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

type WorkArenaSuite = "all" | "atomic" | "l1" | "l2" | "l3";

type TaskInfo = {
  id: string;
  category: string | null;
  kind: "atomic" | "compositional";
  level: string | null;
  seed: number | null;
  className: string;
};

type ListResult = {
  benchmark: "workarena";
  suite: WorkArenaSuite;
  count: number;
  categories: Array<{ category: string; count: number }>;
  tasks: TaskInfo[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const BRIDGE_PATH = resolve(__dirname, "workarena-bridge.py");
const DEFAULT_VENV_PYTHON = resolve(
  PROJECT_ROOT,
  ".artifacts",
  "workarena",
  ".venv",
  "Scripts",
  "python.exe",
);

function parseArgs(): {
  suite: WorkArenaSuite;
  category: string | null;
  json: boolean;
  limit: number;
} {
  const args = process.argv.slice(2);
  const suiteArg = args[args.indexOf("--suite") + 1] as WorkArenaSuite | undefined;
  const categoryArg = args[args.indexOf("--category") + 1];
  const limitArg = Number.parseInt(args[args.indexOf("--limit") + 1] ?? "", 10);
  const suite: WorkArenaSuite =
    suiteArg && ["all", "atomic", "l1", "l2", "l3"].includes(suiteArg)
      ? suiteArg
      : "all";

  return {
    suite,
    category:
      categoryArg && !categoryArg.startsWith("--") ? categoryArg : null,
    json: args.includes("--json"),
    limit: Number.isFinite(limitArg) && limitArg >= 0 ? limitArg : 30,
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

function runList(): ListResult {
  const args = parseArgs();
  const bridgeArgs = [BRIDGE_PATH, "list", "--suite", args.suite];
  if (args.category) bridgeArgs.push("--category", args.category);

  const result = spawnSync(resolvePythonExecutable(), bridgeArgs, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...loadDotEnv(),
    },
    encoding: "utf-8",
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

  return JSON.parse(result.stdout) as ListResult;
}

function printHuman(result: ListResult, limit: number): void {
  console.log("\n[workarena:list] WorkArena tasks");
  console.log(`[workarena:list] Suite: ${result.suite}`);
  console.log(`[workarena:list] Count: ${result.count}`);
  console.log("");

  if (result.categories.length > 0) {
    console.log("[workarena:list] Categories:");
    for (const category of result.categories) {
      console.log(`[workarena:list]   - ${category.category}: ${category.count}`);
    }
    console.log("");
  }

  const shown = result.tasks.slice(0, limit);
  console.log(`[workarena:list] Tasks${limit === 0 ? "" : ` (first ${shown.length})`}:`);
  for (const task of shown) {
    const category = task.category ?? "uncategorized";
    const seed = task.seed === null ? "" : ` seed=${task.seed}`;
    console.log(
      `[workarena:list]   - ${task.id} | ${task.kind} | ${category}${seed}`,
    );
  }

  if (result.tasks.length > shown.length) {
    console.log(
      `[workarena:list]   ... ${result.tasks.length - shown.length} more; use --json for full metadata or --limit N for more rows.`,
    );
  }
}

function main(): void {
  const args = parseArgs();
  const result = runList();
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printHuman(result, args.limit);
}

main();
