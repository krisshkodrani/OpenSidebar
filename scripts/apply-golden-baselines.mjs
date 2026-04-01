/**
 * Apply accepted golden baselines back to the eval case files.
 *
 * Usage:
 *   node scripts/apply-golden-baselines.mjs
 *
 * Reads baselines from evals/golden/baselines/*.json.
 * For each baseline with reviewStatus: "accepted", updates the corresponding
 * golden case's expected field with the model's actual output.
 *
 * The review.md file must be edited first — change [PENDING] to [ACCEPT] or
 * [REJECT] for each case. This script reads the baseline JSON files (not the
 * markdown), so update the reviewStatus field in each baseline JSON.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const GOLDEN_DIR = "evals/golden";
const BASELINE_DIR = "evals/golden/baselines";

function main() {
  if (!existsSync(BASELINE_DIR)) {
    console.error("No baselines directory. Run generate-golden-baselines.mjs first.");
    process.exit(1);
  }

  const baselineFiles = readdirSync(BASELINE_DIR).filter(
    (f) => f.endsWith(".json") && f !== "review.md",
  );

  let accepted = 0;
  let rejected = 0;
  let pending = 0;

  for (const f of baselineFiles) {
    const baseline = JSON.parse(readFileSync(join(BASELINE_DIR, f), "utf8"));
    const caseId = baseline.caseId;

    if (baseline.reviewStatus === "accepted") {
      // Find and update the golden case
      const casePath = join(GOLDEN_DIR, `${caseId}.json`);
      if (!existsSync(casePath)) {
        console.warn(`  SKIP ${caseId}: golden case file not found`);
        continue;
      }

      const goldenCase = JSON.parse(readFileSync(casePath, "utf8"));

      // Preserve the old expected as metadata for reference
      goldenCase.metadata = goldenCase.metadata || {};
      goldenCase.metadata.previousExpected = goldenCase.expected;
      goldenCase.metadata.baselineModel = baseline.model;
      goldenCase.metadata.baselineDate = new Date().toISOString().split("T")[0];

      // Replace expected with model output
      goldenCase.expected = baseline.modelOutput;

      writeFileSync(casePath, JSON.stringify(goldenCase, null, 2));
      console.log(`  ✅ ${caseId}: expected updated from ${baseline.model}`);
      accepted++;
    } else if (baseline.reviewStatus === "rejected") {
      console.log(`  ❌ ${caseId}: rejected — keeping hand-written expected`);
      rejected++;
    } else {
      console.log(`  ⏳ ${caseId}: still pending review`);
      pending++;
    }
  }

  console.log(`\n════════════════════════════════════`);
  console.log(`Accepted: ${accepted} (golden cases updated)`);
  console.log(`Rejected: ${rejected} (hand-written expectations kept)`);
  console.log(`Pending:  ${pending} (not yet reviewed)`);

  if (pending > 0) {
    console.log(`\nEdit baseline JSON files to set reviewStatus: "accepted" or "rejected"`);
  }
}

main();
