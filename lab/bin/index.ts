import { existsSync } from "fs";
import { resolve } from "path";
import { LAB_DIR, PROJECT_ROOT, runCommand } from "./common.js";

const TARGETS = [
  "research",
  "reports",
  "e2e-reports",
  "books/notes",
  "knowledge",
  "articles",
  "archive",
  "experiments",
];

console.log("=== Indexing lab content into GBrain ===");

for (const dir of TARGETS) {
  const full = resolve(LAB_DIR, dir);
  if (!existsSync(full)) continue;
  console.log(`\n--- lab/${dir} ---`);
  const status = runCommand("npx", ["tsx", "lab/bin/gbrain.ts", "import", full, "--no-embed"], {
    cwd: PROJECT_ROOT,
  });
  if (status !== 0) process.exit(status);
}

console.log("\n--- docs/ ---");
const docsStatus = runCommand(
  "npx",
  ["tsx", "lab/bin/gbrain.ts", "import", resolve(PROJECT_ROOT, "docs"), "--no-embed"],
  { cwd: PROJECT_ROOT },
);
if (docsStatus !== 0) process.exit(docsStatus);

console.log("\n=== Index complete ===");
process.exit(runCommand("npx", ["tsx", "lab/bin/gbrain.ts", "stats"], { cwd: PROJECT_ROOT }));
