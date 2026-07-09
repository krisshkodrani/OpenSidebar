/**
 * Decomposition ratchet (RFC LP-15 Phase 11; generalized in RFC LP-16 Phase 0).
 *
 * Enforces that the repo's oversized "landmine" files only shrink. It measures a
 * few robust size metrics per guarded file and fails if any exceeds its
 * checked-in budget, so a PR can never grow a file back — decomposition proceeds
 * incrementally and is protected against regression between passes.
 *
 * The SET of guarded files and the metrics each one tracks live in code
 * (`RATCHET_FILES`); the numeric limits live in `scripts/loop-ratchet-budget.json`
 * and may ONLY go down. Run `node scripts/loop-ratchet.mjs --report` to print the
 * current metrics for every guarded file (used to tighten a budget after an
 * extraction). Mirrors the rfc-decision baseline pattern already wired into lint.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const budgetPath = join(repoRoot, "scripts", "loop-ratchet-budget.json");

const LOOP_PATH = "apps/extension/src/background/agent/loop.ts";

/**
 * The guarded files and which metrics apply to each. `fileLines` is universal;
 * the two structural metrics (`methodCount`, `loopMethodLines`) are specific to
 * the AgentLoop monolith and only measured for loop.ts.
 */
const RATCHET_FILES = [
  { path: LOOP_PATH, metrics: ["fileLines", "methodCount", "loopMethodLines"] },
  {
    path: "apps/extension/src/background/agent/completion-kernel.ts",
    metrics: ["fileLines"],
  },
  {
    path: "apps/extension/src/background/tools/index.ts",
    metrics: ["fileLines"],
  },
  {
    path: "apps/extension/src/background/orchestrator/index.ts",
    metrics: ["fileLines"],
  },
  {
    path: "apps/extension/src/background/orchestrator/skills.ts",
    metrics: ["fileLines"],
  },
];

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

/** Measure the requested metrics for a single guarded file. */
function measureFile(repo, relPath, metrics) {
  const src = readFileSync(join(repo, relPath), "utf8");
  const lines = src.split(/\r?\n/);
  const out = {};
  for (const metric of metrics) {
    if (metric === "fileLines") {
      out.fileLines = lines.length;
    } else if (metric === "methodCount") {
      out.methodCount = lines.filter((line) => METHOD_RE.test(line)).length;
    } else if (metric === "loopMethodLines") {
      out.loopMethodLines =
        methodLineSpan(lines, /^ {2}private async loop\(/) ?? 0;
    }
  }
  return out;
}

/** Back-compat: loop.ts metrics only. Retained for any external caller. */
export function measureLoopMetrics(repo = repoRoot) {
  return measureFile(repo, LOOP_PATH, [
    "fileLines",
    "methodCount",
    "loopMethodLines",
  ]);
}

/** Measure every guarded file. Keyed by repo-relative path. */
export function measureAll(repo = repoRoot) {
  const out = {};
  for (const { path, metrics } of RATCHET_FILES) {
    out[path] = measureFile(repo, path, metrics);
  }
  return out;
}

const METRIC_LABELS = {
  fileLines: "total lines",
  methodCount: "method-decl count",
  loopMethodLines: "loop() method length (lines)",
};

function main() {
  const report = process.argv.includes("--report");

  if (report) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(measureAll(), null, 2));
    return;
  }

  const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
  const budgets = budget.budgets ?? {};
  const failures = [];
  const slack = [];

  for (const { path, metrics } of RATCHET_FILES) {
    const measured = measureFile(repoRoot, path, metrics);
    const fileBudget = budgets[path];
    if (typeof fileBudget !== "object" || fileBudget === null) {
      failures.push(`budget is missing an entry for "${path}"`);
      continue;
    }
    for (const key of metrics) {
      const limit = fileBudget[key];
      const actual = measured[key];
      const label = METRIC_LABELS[key] ?? key;
      if (typeof limit !== "number") {
        failures.push(`${path}: budget is missing a numeric "${key}"`);
        continue;
      }
      if (actual > limit) {
        failures.push(
          `${path} ${label} grew: ${actual} > budget ${limit}. ` +
            `Extract code out; do not raise the budget.`,
        );
      } else if (actual < limit) {
        slack.push(`${path} ${label}: ${actual} (budget ${limit} — tighten it)`);
      }
    }
  }

  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.error("Decomposition ratchet FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  if (slack.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "Decomposition ratchet slack (budgets can be tightened):\n- " +
        slack.join("\n- "),
    );
  }
  // eslint-disable-next-line no-console
  console.log("Decomposition ratchet passed.");
}

main();
