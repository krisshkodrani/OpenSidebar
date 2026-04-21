import { existsSync } from "fs";
import { resolve } from "path";
import { PROJECT_ROOT, runCommand } from "./common.js";

const args = process.argv.slice(2);
const writeOnly = args.includes("--write-only");

const exitCode = runCommand("npx", ["tsx", "lab/trace-importer.ts", ...args], {
  cwd: PROJECT_ROOT,
});

if (exitCode !== 0) {
  process.exit(exitCode);
}

if (writeOnly) {
  process.exit(0);
}

const outputDir = resolve(PROJECT_ROOT, "data", "trace-projections");
if (!existsSync(outputDir)) {
  console.log("Trace import completed, but no projection directory was found.");
  process.exit(0);
}

console.log("\n--- Importing projected traces into GBrain ---");
const importExitCode = runCommand("npx", ["tsx", "lab/bin/gbrain.ts", "import", outputDir, "--no-embed"], {
  cwd: PROJECT_ROOT,
});
if (importExitCode !== 0) {
  process.exit(importExitCode);
}

const manifestPath = resolve(outputDir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.log("Projected traces imported, but no manifest.json was found for raw-data enrichment.");
  process.exit(0);
}

console.log("\n--- Enriching imported trace pages with raw_data ---");
const enrichExitCode = runCommand("npx", ["tsx", "lab/bin/enrich-trace-raw-data.ts", manifestPath], {
  cwd: PROJECT_ROOT,
});
if (enrichExitCode !== 0) {
  process.exit(enrichExitCode);
}
process.exit(0);
