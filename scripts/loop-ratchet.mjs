/**
 * Loop decomposition ratchet (RFC LP-15, Phase 11).
 *
 * Enforces that the agent-loop monolith only shrinks. It measures a few robust
 * size metrics for `loop.ts` and fails if any exceeds its checked-in budget, so
 * a PR can never grow the file back — the Phase 11 decomposition proceeds
 * incrementally and is protected against regression between passes.
 *
 * Budgets live in `scripts/loop-ratchet-budget.json` and may ONLY go down. Run
 * `node scripts/loop-ratchet.mjs --report` to print the current metrics (used to
 * tighten the budget after an extraction). Mirrors the rfc-decision baseline
 * pattern already wired into the lint step.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const LOOP_PATH = "apps/extension/src/background/agent/loop.ts";
const budgetPath = join(repoRoot, "scripts", "loop-ratchet-budget.json");

/** Count lines spanned by a method, brace-matching from its signature line. */
function methodLineSpan(lines, signatureRe) {
  const startIdx = lines.findIndex((line) => signatureRe.test(line));
  if (startIdx < 0) return null;
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        started = true;
      } else if (ch === "}") {
        depth--;
      }
    }
    if (started && depth === 0) return i - startIdx + 1;
  }
  return null;
}

/**
 * A stable proxy for the AgentLoop method count: 2-space-indent declarations
 * that look like a method (name followed by an optional generic and a paren).
 * Absolute correctness is not required — only that it moves monotonically with
 * real method additions/removals, since the budget is whatever it reports now.
 */
const METHOD_RE =
  /^ {2}(?:public |private |protected |static |async |override |get |set |\* )*[A-Za-z_$][\w$]*\s*(?:<[^={}]*>)?\s*\(/;

export function measureLoopMetrics(repo = repoRoot) {
  const src = readFileSync(join(repo, LOOP_PATH), "utf8");
  const lines = src.split(/\r?\n/);
  const methodCount = lines.filter((line) => METHOD_RE.test(line)).length;
  const loopMethodLines = methodLineSpan(lines, /^ {2}private async loop\(/);
  return {
    fileLines: lines.length,
    methodCount,
    loopMethodLines: loopMethodLines ?? 0,
  };
}

const METRIC_LABELS = {
  fileLines: "loop.ts total lines",
  methodCount: "AgentLoop method-decl count",
  loopMethodLines: "loop() method length (lines)",
};

function main() {
  const metrics = measureLoopMetrics();
  const report = process.argv.includes("--report");

  if (report) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
  const failures = [];
  const slack = [];
  for (const key of Object.keys(METRIC_LABELS)) {
    const limit = budget[key];
    const actual = metrics[key];
    if (typeof limit !== "number") {
      failures.push(`budget is missing a numeric "${key}"`);
      continue;
    }
    if (actual > limit) {
      failures.push(
        `${METRIC_LABELS[key]} grew: ${actual} > budget ${limit}. ` +
          `Extract code out of loop.ts; do not raise the budget.`,
      );
    } else if (actual < limit) {
      slack.push(`${METRIC_LABELS[key]}: ${actual} (budget ${limit} — tighten it)`);
    }
  }

  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.error("Loop ratchet FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  if (slack.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "Loop ratchet slack (budget can be tightened):\n- " + slack.join("\n- "),
    );
  }
  // eslint-disable-next-line no-console
  console.log("Loop ratchet passed.");
}

main();
