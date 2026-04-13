import { mkdirSync } from "fs";
import {
  applyLabEnvironment,
  commandExists,
  DATA_DIR,
  GBRAIN_DB_PATH,
  GBRAIN_REPO,
  HERMES_REPO,
  printCheck,
  PROJECT_ROOT,
  runCommand,
} from "./common.js";

applyLabEnvironment();

console.log("=== OpenSidebar Lab Setup ===");
console.log(`Project: ${PROJECT_ROOT}`);
console.log("");

runCommand("git", ["submodule", "update", "--init", "--recursive", "lab/agents/hermes/repo", "lab/agents/gbrain/repo"], {
  cwd: PROJECT_ROOT,
});

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(GBRAIN_DB_PATH.replace(/brain\.pglite$/i, ""), { recursive: true });

if (!commandExists("bun")) {
  printCheck("FAIL", "bun", "required for GBrain wrapper and MCP server");
  process.exit(1);
}

console.log("\n--- GBrain ---");
runCommand("bun", ["install"], { cwd: GBRAIN_REPO });
const initStatus = runCommand("npx", ["tsx", "lab/bin/gbrain.ts", "init", "--pglite"], {
  cwd: PROJECT_ROOT,
});
if (initStatus !== 0) process.exit(initStatus);

console.log("\n--- Hermes ---");
if (!commandExists("hermes")) {
  printCheck("WARN", "Hermes CLI", "not installed; install manually in lab/agents/hermes/repo");
} else {
  printCheck("OK", "Hermes CLI", "available");
}

console.log("\n--- Initial Index ---");
runCommand("npx", ["tsx", "lab/bin/index.ts"], { cwd: PROJECT_ROOT });

console.log("\n=== Lab setup complete ===");
console.log("Next steps:");
console.log("  1. Run `npm run lab:doctor`");
console.log("  2. Start GBrain MCP via `.mcp.json` or `bun run lab/bin/gbrain-mcp.ts`");
console.log("  3. Use `npx tsx lab/bin/hermes.ts ...` once the Hermes CLI is installed");

