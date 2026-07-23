/**
 * Preflight for the LP-21 prompt-cache observation window (RFC LP-21 step 2).
 *
 *   pnpm run cache:preflight
 *
 * A live agent run costs real API budget and a slot of the owner's attention.
 * Two failure modes silently produce a run that LOOKS fine and cannot answer
 * anything, and both have bitten this project before:
 *
 *   1. `dist-dev` predates the §9 telemetry (#104), so every turn is recorded
 *      without prefix metrics. `cache-report.mjs` then correctly refuses a
 *      verdict — after the API spend, not before it.
 *   2. A log server started from ANOTHER checkout already holds port 7589, so
 *      traces are written into that repo while the harness reads this one.
 *      A baseline run reproduces the symptom, which makes it look like a
 *      pre-existing failure on main. This cost hours once already.
 *
 * This checks both before anything is launched. Exits non-zero on a hard fail.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createConnection } from "node:net";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DEV = join(PROJECT_ROOT, "dist-dev");
const TRACE_DIR = join(PROJECT_ROOT, "traces");
const LOG_SERVER_PORT = 7589;

/**
 * Property names present only in the #104 telemetry. Object literal keys survive
 * the production build unmangled (verified against `droppedMessageCount`), so
 * grepping the bundle is a sound staleness check.
 */
const TELEMETRY_MARKERS = ["firstDivergenceRegion", "volatile_tail"];

const results = [];
function check(name, status, detail, fix) {
  results.push({ name, status, detail, fix });
}

function bundlePath() {
  const assets = join(DIST_DEV, "assets");
  const file = readdirSync(assets).find(
    (n) => n.startsWith("background.ts-") && n.endsWith(".js"),
  );
  return file ? join(assets, file) : null;
}

function checkDistDev() {
  let bundle;
  try {
    bundle = bundlePath();
  } catch {
    check(
      "dist-dev build",
      "fail",
      "No dist-dev/assets — the e2e build has never run in this checkout.",
      "nx run extension:build-e2e --skip-nx-cache",
    );
    return;
  }
  if (!bundle) {
    check(
      "dist-dev build",
      "fail",
      "dist-dev/assets has no background bundle.",
      "nx run extension:build-e2e --skip-nx-cache",
    );
    return;
  }

  const source = readFileSync(bundle, "utf8");
  const missing = TELEMETRY_MARKERS.filter((m) => !source.includes(m));
  const builtAt = statSync(bundle).mtime;

  if (missing.length > 0) {
    check(
      "dist-dev carries §9 telemetry",
      "fail",
      `Bundle built ${builtAt.toISOString()} is missing: ${missing.join(", ")}. ` +
        "Every turn would record without prefix metrics and the run could not answer #103.",
      "nx run extension:build-e2e --skip-nx-cache   (nx caches this — the flag is not optional)",
    );
  } else {
    check(
      "dist-dev carries §9 telemetry",
      "pass",
      `Bundle built ${builtAt.toISOString()} contains the prefix-telemetry markers.`,
    );
  }
}

function checkGitState() {
  try {
    const head = execSync("git rev-parse --short HEAD", {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    }).trim();
    const dirty = execSync("git status --porcelain", {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    }).trim();
    const hasTelemetrySource = readFileSync(
      join(
        PROJECT_ROOT,
        "apps/extension/src/background/agent/prompt-prefix-telemetry.ts",
      ),
      "utf8",
    ).includes("comparePromptPrefix");

    if (!hasTelemetrySource) {
      check(
        "working tree has #104",
        "fail",
        "prompt-prefix-telemetry.ts is missing comparePromptPrefix.",
        "git merge origin/main",
      );
      return;
    }
    check(
      "working tree has #104",
      "pass",
      `HEAD ${head}${dirty ? " (tree dirty — the build must come from THIS tree)" : " (clean)"}`,
    );
  } catch {
    check("working tree has #104", "warn", "Could not read git state.");
  }
}

/** Is anything listening on the log-server port? */
function probePort(port) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const done = (open) => {
      socket.destroy();
      resolveProbe(open);
    };
    socket.setTimeout(1500);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

async function checkLogServer() {
  const open = await probePort(LOG_SERVER_PORT);
  if (!open) {
    check(
      `log server (port ${LOG_SERVER_PORT})`,
      "pass",
      "Port is free — the run will start its own server writing into this checkout.",
    );
    return;
  }

  // Something is listening. The danger is only when it belongs to a DIFFERENT
  // checkout, because then traces land there and this repo looks empty.
  let servedRoot = null;
  try {
    const response = await fetch(
      `http://127.0.0.1:${LOG_SERVER_PORT}/api/traces/days`,
      { signal: AbortSignal.timeout(2000) },
    );
    servedRoot = response.ok ? "responding" : `HTTP ${response.status}`;
  } catch {
    servedRoot = "not responding to /api/traces/days";
  }

  check(
    `log server (port ${LOG_SERVER_PORT})`,
    "warn",
    `Port is ALREADY HELD (${servedRoot}). If that server was started from another ` +
      "checkout or worktree, this run's traces will be written THERE and traces/ here " +
      "will stay empty — the classic LP-21 worktree trap.",
    "Confirm the holder belongs to this checkout, or stop it. Check the process before " +
      "killing it — a Docker backend was once killed by mistake.",
  );
}

function checkTraceDir() {
  try {
    const files = readdirSync(TRACE_DIR).filter(
      (n) => n.endsWith(".jsonl") && n !== "index.jsonl",
    );
    const newest = files
      .map((f) => statSync(join(TRACE_DIR, f)).mtime.getTime())
      .sort((a, b) => b - a)[0];
    check(
      "traces/ directory",
      "pass",
      `${files.length} existing session file(s); newest ${newest ? new Date(newest).toISOString() : "n/a"}. ` +
        "Use --since when reporting so this backlog is excluded.",
    );
  } catch {
    check(
      "traces/ directory",
      "warn",
      "No traces/ directory yet — it is created on the first run.",
    );
  }
}

function checkPromptVersionStamp() {
  // The template IS the cached prefix, so populations built from different
  // prompts are not comparable. Stamping it per turn lets the report enforce
  // that instead of relying on the operator to remember.
  let bundle;
  try {
    bundle = bundlePath();
  } catch {
    return; // dist-dev check already failed and reported.
  }
  if (!bundle) return;

  const hasStamp = readFileSync(bundle, "utf8").includes("promptTemplate");
  if (hasStamp) {
    check(
      "prompt template stamped in traces",
      "pass",
      "Turns record the prompt id/version/hash, so the report splits populations by it " +
        "and refuses to A/B across a template change.",
    );
  } else {
    check(
      "prompt template stamped in traces",
      "warn",
      "This build does not stamp the prompt template per turn.",
      "Rebuild from a tree containing the stamp, or keep the template FROZEN across " +
        "the baseline and the step-3 A/B by hand — otherwise the A/B measures the edit.",
    );
  }
}

async function main() {
  checkGitState();
  checkDistDev();
  await checkLogServer();
  checkTraceDir();
  checkPromptVersionStamp();

  const icon = { pass: "✔", warn: "!", fail: "✘" };
  console.log("\nLP-21 observation-window preflight\n");
  for (const r of results) {
    console.log(`${icon[r.status]} ${r.name}`);
    console.log(`    ${r.detail}`);
    if (r.fix) console.log(`    → ${r.fix}`);
  }

  const failed = results.filter((r) => r.status === "fail");
  const warned = results.filter((r) => r.status === "warn");
  console.log("");
  if (failed.length > 0) {
    console.log(
      `NOT READY — ${failed.length} blocking issue(s). Fix them before spending API budget.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Ready to run${warned.length ? ` — ${warned.length} thing(s) to confirm by hand first.` : "."}`,
  );
}

main();
