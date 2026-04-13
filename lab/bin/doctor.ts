import { existsSync } from "fs";
import {
  applyLabEnvironment,
  captureCommand,
  commandExists,
  ENV_FILE,
  GBRAIN_DB_PATH,
  GBRAIN_REPO,
  HERMES_REPO,
  printCheck,
  PROJECT_ROOT,
} from "./common.js";

applyLabEnvironment();

let hasFailure = false;

printCheck(existsSync(ENV_FILE) ? "OK" : "WARN", ".env", existsSync(ENV_FILE) ? "project .env present" : "project .env missing");
printCheck(existsSync(GBRAIN_REPO) ? "OK" : "FAIL", "GBrain submodule", existsSync(GBRAIN_REPO) ? "present" : "missing");
printCheck(existsSync(HERMES_REPO) ? "OK" : "FAIL", "Hermes submodule", existsSync(HERMES_REPO) ? "present" : "missing");

for (const [label, command] of [
  ["bun", "bun"],
  ["git", "git"],
  ["python", "python"],
]) {
  const ok = commandExists(command);
  printCheck(ok ? "OK" : "FAIL", label, ok ? "available" : "not found in PATH");
  if (!ok) hasFailure = true;
}

const hermesProbe = captureCommand("python", ["-m", "hermes_cli.main", "--help"], {
  cwd: PROJECT_ROOT,
});
const hermesCli = hermesProbe.status === 0;
printCheck(hermesCli ? "OK" : "WARN", "Hermes CLI", hermesCli ? "available via python -m hermes_cli.main" : "not installed yet");

const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
const hasFireworks = Boolean(process.env.FIREWORKS_API_KEY);
printCheck(hasOpenAi ? "OK" : "WARN", "OPENAI_API_KEY", hasOpenAi ? "present for GBrain embeddings/search" : "missing; GBrain falls back to keyword-only search");
printCheck(hasFireworks ? "OK" : "WARN", "FIREWORKS_API_KEY", hasFireworks ? "present for Hermes default model" : "missing; Hermes Fireworks flow will not work");

if (existsSync(GBRAIN_REPO) && commandExists("bun")) {
  const version = captureCommand("bun", ["run", "src/cli.ts", "version"], { cwd: GBRAIN_REPO });
  const ok = version.status === 0;
  printCheck(ok ? "OK" : "FAIL", "GBrain CLI", ok ? version.stdout.trim() || "reachable" : version.stderr.trim() || "failed to boot");
  if (!ok) hasFailure = true;
}

const configProbe = captureCommand("npx", ["tsx", "lab/bin/gbrain.ts", "stats"], {
  cwd: PROJECT_ROOT,
});
if (configProbe.status === 0) {
  printCheck("OK", "Lab brain", `initialized at ${GBRAIN_DB_PATH}`);
} else {
  printCheck("WARN", "Lab brain", "not initialized yet; run: npm run lab:setup");
}

process.exit(hasFailure ? 1 : 0);
