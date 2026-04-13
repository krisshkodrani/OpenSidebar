import { existsSync } from "fs";
import { applyLabEnvironment, HERMES_REPO, PROJECT_ROOT, runCommand } from "./common.js";

applyLabEnvironment();

if (!existsSync(HERMES_REPO)) {
  console.error("Hermes submodule is missing. Run: git submodule update --init --recursive lab/agents/hermes/repo");
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY && process.env.FIREWORKS_API_KEY) {
  process.env.OPENAI_API_KEY = process.env.FIREWORKS_API_KEY;
}

const exitCode = runCommand("python", ["-m", "hermes_cli.main", ...process.argv.slice(2)], {
  cwd: PROJECT_ROOT,
  env: process.env,
});

process.exit(exitCode);
