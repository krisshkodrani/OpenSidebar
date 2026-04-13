import { existsSync } from "fs";
import { resolve } from "path";
import { PROJECT_ROOT, runCommand } from "./common.js";

const args = process.argv.slice(2);
const exitCode = runCommand("npx", ["tsx", "lab/trace-sampler.ts", ...args], {
  cwd: PROJECT_ROOT,
});

if (exitCode !== 0) {
  process.exit(exitCode);
}

const reportPath = resolve(
  PROJECT_ROOT,
  "lab",
  "knowledge",
  `trace-analysis-${new Date().toISOString().split("T")[0]}.md`,
);
const knowledgeDir = resolve(PROJECT_ROOT, "lab", "knowledge");

if (existsSync(reportPath)) {
  console.log("\n--- Re-indexing generated trace analysis ---");
  process.exit(
    runCommand("npx", ["tsx", "lab/bin/gbrain.ts", "import", knowledgeDir, "--no-embed"], {
      cwd: PROJECT_ROOT,
    }),
  );
}

console.log("Trace analysis completed, but no dated report was found to re-index.");
process.exit(0);
