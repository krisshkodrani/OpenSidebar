import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const LOCAL_SERVER_PORT = Number(process.env.LOG_SERVER_PORT) || 7589;
const LOCAL_SERVER_HEALTH_URL = `http://127.0.0.1:${LOCAL_SERVER_PORT}/health`;

type CheckLevel = "ok" | "warn";

interface Check {
  level: CheckLevel;
  label: string;
  detail: string;
}

function runVersion(command: string, args: string[]): string {
  const executable =
    command === "npm" && process.env.npm_execpath
      ? process.execPath
      : process.platform === "win32" && command === "npm"
        ? "npm.cmd"
        : command;
  const resolvedArgs =
    command === "npm" && process.env.npm_execpath
      ? [process.env.npm_execpath, ...args]
      : args;
  try {
    return execFileSync(executable, resolvedArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "not available";
  }
}

function fileExists(relativePath: string): boolean {
  return existsSync(path.join(ROOT, relativePath));
}

function fileSize(relativePath: string): string | null {
  const target = path.join(ROOT, relativePath);
  if (!existsSync(target)) return null;
  const size = statSync(target).size;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function checkLocalServer(): Promise<Check> {
  try {
    const response = await fetch(LOCAL_SERVER_HEALTH_URL, {
      signal: AbortSignal.timeout(800),
    });
    if (response.ok) {
      return {
        level: "ok",
        label: "local server",
        detail: `running at http://127.0.0.1:${LOCAL_SERVER_PORT}`,
      };
    }
    return {
      level: "warn",
      label: "local server",
      detail: `responded with HTTP ${response.status}`,
    };
  } catch {
    return {
      level: "warn",
      label: "local server",
      detail: `not running; start it with npm run dev`,
    };
  }
}

function printCheck(check: Check): void {
  const prefix = check.level === "ok" ? "[ok]" : "[warn]";
  console.log(`${prefix} ${check.label}: ${check.detail}`);
}

async function main(): Promise<void> {
  const nodeVersion = runVersion("node", ["--version"]);
  const npmVersion = runVersion("npm", ["--version"]);
  const checks: Check[] = [
    {
      level: nodeVersion === "not available" ? "warn" : "ok",
      label: "node",
      detail: nodeVersion,
    },
    {
      level: npmVersion === "not available" ? "warn" : "ok",
      label: "npm",
      detail: npmVersion,
    },
    {
      level: fileExists("node_modules") ? "ok" : "warn",
      label: "dependencies",
      detail: fileExists("node_modules")
        ? "node_modules exists"
        : "missing; run npm install",
    },
    {
      level: fileExists("dist/manifest.json") ? "ok" : "warn",
      label: "dist",
      detail: fileExists("dist/manifest.json")
        ? "production extension build exists"
        : "missing; run npm run dist",
    },
    {
      level: fileExists("dist-dev/manifest.json") ? "ok" : "warn",
      label: "dist-dev",
      detail: fileExists("dist-dev/manifest.json")
        ? "dev extension build exists"
        : "missing until npm run dev has built once",
    },
    {
      level: fileExists(".artifacts/trace-index.sqlite") ? "ok" : "warn",
      label: "trace sqlite",
      detail: fileExists(".artifacts/trace-index.sqlite")
        ? `.artifacts/trace-index.sqlite (${fileSize(".artifacts/trace-index.sqlite")})`
        : "missing; run npm run traces:index after traces exist",
    },
    await checkLocalServer(),
  ];

  console.log("OpenSidebar doctor");
  console.log("");
  checks.forEach(printCheck);
  console.log("");
  console.log("Main commands:");
  console.log("  npm run dev      start local dev stack and load dist-dev/");
  console.log("  npm run dist     build standalone extension into dist/");
  console.log("  npm test         run fast tests");
  console.log("  npm run verify   run the full local confidence gate");
  console.log("  npm run doctor   diagnose this local setup");
}

main().catch((error) => {
  console.error("[doctor] Unexpected failure", error);
  process.exit(1);
});
