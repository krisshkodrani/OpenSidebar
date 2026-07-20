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
 *
 * In addition to the per-landmine metrics, every source file under
 * `SWEEP_ROOTS` is held to `FILE_LINES_CAP` total lines. Files that already
 * exceeded the cap when the sweep was introduced are grandfathered in the
 * budget JSON's `oversized` map with a shrink-only line budget of their own.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const budgetPath = join(repoRoot, "scripts", "loop-ratchet-budget.json");

const LOOP_PATH = "apps/extension/src/background/agent/loop.ts";

/**
 * Repo-wide oversize sweep: no source file may exceed this many lines unless
 * it is one of the metric-tracked landmines above or is grandfathered (with a
 * shrink-only budget) in `oversized` in the budget JSON. This closes the
 * ratchet's blind spot — without it, extracting code out of a guarded file
 * into a fresh 3,000-line "helper" module passes the ratchet while the repo
 * gets no smaller.
 */
const FILE_LINES_CAP = 1500;

/** Directories swept by the oversize check (repo-relative). */
const SWEEP_ROOTS = ["apps/extension/src", "packages"];

/** Repo-relative paths excluded from the sweep (generated output). */
const SWEEP_EXCLUDE = new Set(["apps/extension/src/prompts/generated.ts"]);

/** Recursively list .ts/.tsx files under a repo-relative root. */
function listSourceFiles(root) {
  const out = [];
  const entries = readdirSync(join(repoRoot, root), {
    withFileTypes: true,
    recursive: true,
  });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith(".d.ts")) {
      continue;
    }
    const rel = join(entry.parentPath, entry.name)
      .slice(repoRoot.length + 1)
      .replaceAll("\\", "/");
    if (rel.includes("/node_modules/") || SWEEP_EXCLUDE.has(rel)) continue;
    out.push(rel);
  }
  return out;
}

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

/**
 * Line count of every swept file that is not metric-tracked, keyed by
 * repo-relative path. The single measurement both `--report` and the check
 * consume, so the numbers `--report` prints are always the numbers lint
 * enforces.
 */
export function measureSweep(repo = repoRoot) {
  const metricTracked = new Set(RATCHET_FILES.map(({ path }) => path));
  const out = new Map();
  for (const root of SWEEP_ROOTS) {
    for (const rel of listSourceFiles(root)) {
      if (metricTracked.has(rel)) continue;
      out.set(rel, readFileSync(join(repo, rel), "utf8").split(/\r?\n/).length);
    }
  }
  return out;
}

function main() {
  const report = process.argv.includes("--report");

  if (report) {
    const overCap = {};
    for (const [rel, lines] of measureSweep()) {
      if (lines > FILE_LINES_CAP) overCap[rel] = lines;
    }
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({ landmines: measureAll(), overCap }, null, 2),
    );
    return;
  }

  const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
  const budgets = budget.budgets ?? {};
  const oversized = budget.oversized ?? {};
  const failures = [];
  const slack = [];

  for (const [rel, lines] of measureSweep()) {
    const grandfathered = oversized[rel];
    if (typeof grandfathered === "number") {
      if (lines > grandfathered) {
        failures.push(
          `${rel} total lines grew: ${lines} > budget ${grandfathered}. ` +
            `Extract code out; do not raise the budget.`,
        );
      } else if (lines < grandfathered) {
        slack.push(
          lines <= FILE_LINES_CAP
            ? `${rel}: ${lines} — now under the ${FILE_LINES_CAP}-line cap; drop its "oversized" entry`
            : `${rel} total lines: ${lines} (budget ${grandfathered} — tighten it)`,
        );
      }
    } else if (lines > FILE_LINES_CAP) {
      failures.push(
        `${rel} has ${lines} lines (> ${FILE_LINES_CAP}-line cap for new files). ` +
          `Split it into cohesive modules instead of creating a new giant.`,
      );
    }
  }

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
