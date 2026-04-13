import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const LAB_DIR = resolve(__dirname, "..");
export const PROJECT_ROOT = resolve(LAB_DIR, "..");
export const DATA_DIR = resolve(PROJECT_ROOT, "data");
export const LAB_HOME = resolve(DATA_DIR, "lab-home");
export const HERMES_HOME = resolve(LAB_HOME, ".hermes");
export const GBRAIN_REPO = resolve(LAB_DIR, "agents", "gbrain", "repo");
export const HERMES_REPO = resolve(LAB_DIR, "agents", "hermes", "repo");
export const GBRAIN_DB_PATH = resolve(DATA_DIR, "gbrain", "brain.pglite");
export const ENV_FILE = resolve(PROJECT_ROOT, ".env");

export type CheckStatus = "OK" | "WARN" | "FAIL";

export function loadProjectEnv(): void {
  if (!existsSync(ENV_FILE)) return;
  const raw = readFileSync(ENV_FILE, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function applyLabEnvironment(): void {
  loadProjectEnv();
  mkdirSync(resolve(DATA_DIR, "gbrain"), { recursive: true });
  mkdirSync(LAB_HOME, { recursive: true });
  mkdirSync(HERMES_HOME, { recursive: true });
  process.env.HOME = LAB_HOME;
  process.env.USERPROFILE = LAB_HOME;
}

export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
  } = {},
): number {
  const invocation = normalizeCommand(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
    encoding: "utf-8",
  });
  return result.status ?? 1;
}

export function captureCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string; stderr: string } {
  const invocation = normalizeCommand(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    env: options.env ?? process.env,
    stdio: "pipe",
    encoding: "utf-8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function commandExists(command: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return (result.status ?? 1) === 0;
}

function normalizeCommand(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== "win32") {
    return { command, args };
  }

  if (command === "bun" || command === "npm" || command === "npx") {
    return { command: "cmd", args: ["/c", command, ...args] };
  }

  return { command, args };
}

export function printCheck(status: CheckStatus, label: string, detail: string): void {
  console.log(`[${status}] ${label}: ${detail}`);
}
