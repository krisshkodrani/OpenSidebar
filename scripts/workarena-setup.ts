#!/usr/bin/env tsx

import { spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const WORKARENA_DIR = resolve(PROJECT_ROOT, ".artifacts", "workarena");
const VENV_DIR = resolve(WORKARENA_DIR, ".venv");
const VENV_PYTHON = resolve(VENV_DIR, "Scripts", "python.exe");

function run(command: string, args: string[], cwd = PROJECT_ROOT): void {
  console.log(`[workarena:setup] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`);
  }
}

function resolveBootstrapPython(): string {
  if (process.env.WORKARENA_BOOTSTRAP_PYTHON) {
    return process.env.WORKARENA_BOOTSTRAP_PYTHON;
  }
  return "python";
}

function main(): void {
  if (!existsSync(WORKARENA_DIR)) mkdirSync(WORKARENA_DIR, { recursive: true });

  if (!existsSync(VENV_PYTHON)) {
    run(resolveBootstrapPython(), ["-m", "venv", VENV_DIR]);
  } else {
    console.log(`[workarena:setup] Reusing existing venv: ${VENV_DIR}`);
  }

  run(VENV_PYTHON, ["-m", "pip", "install", "--upgrade", "pip"]);
  run(VENV_PYTHON, [
    "-m",
    "pip",
    "install",
    "browsergym-workarena",
    "huggingface_hub",
  ]);
  run(VENV_PYTHON, ["-m", "playwright", "install", "chromium"]);

  console.log("\n[workarena:setup] Complete. Run:");
  console.log("[workarena:setup]   npm run benchmark:workarena:doctor");
}

main();
