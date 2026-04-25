#!/usr/bin/env tsx

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

type CheckStatus = "ok" | "missing" | "blocked" | "pending";

type DoctorCheck = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type ReadinessStatus = "ready" | "local_ready_hf_pending" | "blocked";

type DoctorResult = {
  benchmark: "workarena";
  ready: boolean;
  readiness?: ReadinessStatus;
  dataset: string;
  pythonExecutable: string;
  platform: string;
  checks: DoctorCheck[];
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
  json: boolean;
  noReport: boolean;
  allowPendingHf: boolean;
} {
  const args = process.argv.slice(2);
  return {
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
    allowPendingHf: args.includes("--allow-pending-hf"),
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

function writeReport(result: DoctorResult): string {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = resolve(REPORTS_DIR, `workarena-doctor-${today()}.json`);
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  return reportPath;
}

function formatStatus(status: CheckStatus): string {
  return status.toUpperCase().padEnd(7, " ");
}

function classifyReadiness(result: DoctorResult): ReadinessStatus {
  const hf = result.checks.find((check) => check.name === "huggingface_access");
  const hardBlock = result.checks.some(
    (check) =>
      check.status === "missing" ||
      check.status === "blocked" ||
      (check.status === "pending" && check.name !== "huggingface_access"),
  );

  if (!hardBlock && hf?.status === "pending") return "local_ready_hf_pending";
  if (result.ready) return "ready";
  return "blocked";
}

function readinessLabel(status: ReadinessStatus): string {
  if (status === "ready") return "ready";
  if (status === "local_ready_hf_pending") return "local setup ready; gated access pending";
  return "blocked";
}

function withReadiness(result: DoctorResult): DoctorResult {
  return {
    ...result,
    readiness: classifyReadiness(result),
  };
}

function printHuman(result: DoctorResult): void {
  const readiness = result.readiness ?? classifyReadiness(result);
  console.log("\n[workarena:doctor] WorkArena setup status");
  console.log(`[workarena:doctor] Ready: ${result.ready ? "yes" : "no"}`);
  console.log(`[workarena:doctor] Status: ${readinessLabel(readiness)}`);
  console.log(`[workarena:doctor] Python: ${result.pythonExecutable}`);
  console.log(`[workarena:doctor] Dataset: ${result.dataset}`);
  if (result.reportPath) {
    console.log(`[workarena:doctor] Report: ${result.reportPath}`);
  }
  console.log("");

  for (const check of result.checks) {
    console.log(
      `[workarena:doctor] ${formatStatus(check.status)} ${check.name}: ${check.detail}`,
    );
  }

  const hf = result.checks.find((check) => check.name === "huggingface_access");
  if (hf?.status === "pending") {
    console.log(
      "\n[workarena:doctor] Hugging Face token is present; gated WorkArena access still appears pending.",
    );
    console.log(
      "[workarena:doctor] Continue local setup with `--allow-pending-hf`; real ServiceNow resets remain blocked until access is granted.",
    );
  }
}

function missingPythonResult(pythonExecutable: string, message: string): DoctorResult {
  return {
    benchmark: "workarena",
    ready: false,
    dataset: "ServiceNow/WorkArena-Instances",
    pythonExecutable,
    platform: process.platform,
    checks: [
      {
        name: "python",
        status: "missing",
        detail: message,
      },
    ],
  };
}

function runDoctor(): DoctorResult {
  const args = parseArgs();
  const dotEnv = loadDotEnv();
  const pythonExecutable = resolvePythonExecutable();
  const childEnv = {
    ...process.env,
    ...dotEnv,
  };

  const bridgeArgs = [BRIDGE_PATH];
  if (args.allowPendingHf) bridgeArgs.push("--allow-pending-hf");

  const result = spawnSync(pythonExecutable, bridgeArgs, {
    cwd: PROJECT_ROOT,
    env: childEnv,
    encoding: "utf-8",
    windowsHide: true,
  });

  if (result.error) {
    return missingPythonResult(pythonExecutable, result.error.message);
  }

  if (result.status !== 0) {
    return missingPythonResult(
      pythonExecutable,
      (result.stderr || result.stdout || `python exited with ${result.status}`).trim(),
    );
  }

  try {
    return JSON.parse(result.stdout) as DoctorResult;
  } catch {
    return missingPythonResult(
      pythonExecutable,
      `bridge returned invalid JSON: ${(result.stdout || result.stderr).slice(0, 500)}`,
    );
  }
}

function main(): void {
  const args = parseArgs();
  const result = runDoctor();
  const classified = withReadiness(result);
  if (!args.noReport) {
    classified.reportPath = writeReport(classified);
  }

  if (args.json) {
    console.log(JSON.stringify(classified, null, 2));
  } else {
    printHuman(classified);
  }

  if (!classified.ready) {
    process.exitCode = 1;
  }
}

main();
