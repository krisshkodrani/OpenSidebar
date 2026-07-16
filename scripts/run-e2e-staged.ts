#!/usr/bin/env tsx

import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  E2E_CANONICAL_SUITE_ORDER,
  E2E_SUITES,
  E2E_FOCUS_SUITE_ORDER,
  E2E_SUITE_ORDER,
  type E2ESuiteName,
} from "../apps/extension/tests/e2e/suites";
import { isE2ESuiteFlagEnabled } from "../apps/extension/tests/e2e/helpers/e2e-config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const E2E_DIR = path.resolve(PROJECT_ROOT, "apps/extension/tests/e2e");
const CONFIG = path.resolve(E2E_DIR, "vitest.e2e.config.ts");
const VITEST_CLI = path.resolve(PROJECT_ROOT, "node_modules/vitest/vitest.mjs");

const OPTIONAL_E2E_GATES = [] as const;

const STAGED_RESULTS_DIR = path.resolve(
  PROJECT_ROOT,
  ".artifacts",
  "e2e",
  "staged-results",
);

/** Reporters for spawned vitest runs. CLI reporters override the config's,
 * so the flaky-retry reporter must be re-listed here alongside json. */
function reporterArgs(jsonOutputPath: string): string[] {
  // CLI --reporter flags REPLACE the config's reporters list, so every
  // config reporter must be repeated here or it silently never runs under
  // staged runs (the otel-reporter was missing at first — per-test spans
  // vanished while the runner's suite spans arrived).
  return [
    "--reporter=default",
    "--reporter=./tests/e2e/helpers/flaky-reporter.ts",
    "--reporter=./tests/e2e/helpers/otel-reporter.ts",
    "--reporter=json",
    `--outputFile.json=${jsonOutputPath}`,
  ];
}

/** Parse the vitest JSON report and return failed test files (relative to
 * apps/extension), or [] if the report is missing/unreadable. */
function readFailedTestFiles(jsonOutputPath: string): string[] {
  try {
    const report = JSON.parse(fs.readFileSync(jsonOutputPath, "utf8")) as {
      testResults?: Array<{ name?: string; status?: string }>;
    };
    const appRoot = path.resolve(PROJECT_ROOT, "apps/extension");
    return (report.testResults ?? [])
      .filter((result) => result.status !== "passed")
      .map((result) => path.relative(appRoot, String(result.name ?? "")))
      .filter((file) => file.length > 0);
  } catch {
    return [];
  }
}

function listTestFiles(): string[] {
  return fs
    .readdirSync(E2E_DIR)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
}

function validateSuites(): void {
  const allFiles = new Set(listTestFiles());
  const assigned = new Map<string, E2ESuiteName>();

  for (const suiteName of E2E_CANONICAL_SUITE_ORDER) {
    for (const file of E2E_SUITES[suiteName]) {
      if (!allFiles.has(file)) {
        throw new Error(
          `Suite "${suiteName}" references missing test file: ${file}`,
        );
      }
      const existing = assigned.get(file);
      if (existing) {
        throw new Error(
          `Test file ${file} is assigned to multiple suites: ${existing}, ${suiteName}`,
        );
      }
      assigned.set(file, suiteName);
    }
  }

  for (const suiteName of E2E_FOCUS_SUITE_ORDER) {
    for (const file of E2E_SUITES[suiteName]) {
      if (!allFiles.has(file)) {
        throw new Error(
          `Suite "${suiteName}" references missing test file: ${file}`,
        );
      }
    }
  }

  const unassigned = [...allFiles].filter((file) => !assigned.has(file));
  if (unassigned.length > 0) {
    throw new Error(
      `Unassigned E2E test files detected: ${unassigned.join(", ")}`,
    );
  }
}

function parseArgs(): {
  suites: E2ESuiteName[];
  listOnly: boolean;
  build: boolean;
} {
  const args = process.argv.slice(2);
  const suiteNames = [
    ...E2E_SUITE_ORDER,
    ...E2E_FOCUS_SUITE_ORDER,
  ] as readonly string[];
  const suiteArg = args.find((arg) => suiteNames.includes(arg)) as
    | E2ESuiteName
    | undefined;
  return {
    suites: suiteArg ? [suiteArg] : [...E2E_SUITE_ORDER],
    listOnly: args.includes("--list"),
    build: !args.includes("--no-build"),
  };
}

function runWithStreaming(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...extraEnv },
    });

    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

/** Flush Bluebox telemetry (no-op when not configured) before exiting. */
async function exitWithFlush(code: number): Promise<never> {
  const { shutdownOtel } = await import("./otel/sdk.js");
  await shutdownOtel();
  process.exit(code);
}

function printPlan(suites: E2ESuiteName[]): void {
  console.log("\n[e2e:staged] Planned suite order:");
  for (const suite of suites) {
    console.log(
      `\n[e2e:staged] ${suite.toUpperCase()} (${E2E_SUITES[suite].length} files)`,
    );
    for (const file of E2E_SUITES[suite]) {
      console.log(`[e2e:staged]   - ${file}`);
    }
  }
}

function printOptionalGateStatus(suites: E2ESuiteName[]): void {
  const plannedFiles = new Set(suites.flatMap((suite) => E2E_SUITES[suite]));

  for (const gate of OPTIONAL_E2E_GATES) {
    const gatedFiles = gate.files.filter((file) => plannedFiles.has(file));
    if (gatedFiles.length === 0) continue;

    const enabled = isE2ESuiteFlagEnabled(gate.flag);
    const state = enabled ? "enabled" : "disabled";
    console.log(
      `\n[e2e:staged] Optional gate ${gate.flag}=${enabled ? "true" : "false"} -> ${gate.description} ${state}.`,
    );

    if (!enabled) {
      for (const file of gatedFiles) {
        console.log(`[e2e:staged]   - ${file} will skip`);
      }
    }
  }
}

async function main(): Promise<void> {
  validateSuites();
  const { suites, listOnly, build } = parseArgs();
  printPlan(suites);
  printOptionalGateStatus(suites);

  if (listOnly) {
    console.log("\n[e2e:staged] List only; exiting without running tests.");
    return;
  }

  if (build) {
    console.log("\n[e2e:staged] Building e2e extension before staged run...");
    execSync("corepack pnpm run build:e2e", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    console.log("\n[e2e:staged] Building E2E fixtures before staged run...");
    execSync("corepack pnpm run fixtures:build", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
  }

  // Heartbeat guard: e2e must drive the dev-surface build (overlay entry
  // + trace drain). A prod-shaped dist-dev silently voids every
  // trace-based assertion — fail loudly here instead.
  execSync(`node scripts/check-dist-dev.js`, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    windowsHide: true,
  });

  fs.mkdirSync(STAGED_RESULTS_DIR, { recursive: true });
  const flakyRescues: string[] = [];

  // Bluebox telemetry (default-off; no-op without OTEL_EXPORTER_OTLP_ENDPOINT
  // / .env.otel): one span per staged run, one child span per suite, handed
  // into the vitest children as TRACEPARENT so the per-test spans emitted by
  // tests/e2e/helpers/otel-reporter.ts join the same trace.
  const { startOtel, shutdownOtel, traceparentFor } = await import(
    "./otel/sdk.js"
  );
  const otelOn = await startOtel("opensidebar-e2e-harness");
  const {
    trace: otelTrace,
    metrics: otelMetrics,
    context: otelContext,
  } = await import("@opentelemetry/api");
  const tracer = otelTrace.getTracer("opensidebar-e2e-harness");
  const suiteCounter = otelMetrics
    .getMeter("opensidebar-e2e-harness")
    .createCounter("opensidebar.e2e.suites", {
      description: "Staged e2e suite outcomes (passed/flaky-passed/failed)",
    });
  const runSpan = tracer.startSpan("e2e_staged_run", {
    attributes: { "opensidebar.e2e.suites_planned": suites.join(",") },
  });

  for (const suite of suites) {
    const testFiles = E2E_SUITES[suite].map((file) =>
      path.join("tests/e2e", file),
    );
    const appRoot = path.resolve(PROJECT_ROOT, "apps/extension");
    const jsonOutputPath = path.resolve(STAGED_RESULTS_DIR, `${suite}.json`);

    const suiteSpan = tracer.startSpan(
      `e2e_suite ${suite}`,
      { attributes: { "opensidebar.e2e.suite": suite } },
      otelTrace.setSpan(otelContext.active(), runSpan),
    );
    const childEnv = otelOn ? { TRACEPARENT: traceparentFor(suiteSpan) } : {};

    console.log(`\n[e2e:staged] Running ${suite.toUpperCase()} suite...`);
    const exitCode = await runWithStreaming(
      process.execPath,
      [
        VITEST_CLI,
        "run",
        "--config",
        CONFIG,
        ...reporterArgs(jsonOutputPath),
        ...testFiles,
      ],
      appRoot,
      childEnv,
    );
    if (exitCode === 0) {
      console.log(`\n[e2e:staged] ${suite.toUpperCase()} suite passed.`);
      suiteSpan.setAttribute("opensidebar.e2e.outcome", "passed");
      suiteSpan.end();
      suiteCounter.add(1, { suite, outcome: "passed" });
      continue;
    }

    // Fresh-process retest: an in-place `retry: 1` has already failed twice
    // in the same browser process by now. A fresh vitest/Chrome process is a
    // stronger flake discriminator — if the failures pass clean here, record
    // them as flaky and keep going instead of failing the stage.
    const failedFiles = readFailedTestFiles(jsonOutputPath);
    if (failedFiles.length === 0) {
      console.error(
        `\n[e2e:staged] ${suite.toUpperCase()} suite failed before producing per-file results (collection/build error). Stopping.`,
      );
      suiteSpan.setAttribute("opensidebar.e2e.outcome", "collection-error");
      suiteSpan.end();
      suiteCounter.add(1, { suite, outcome: "collection-error" });
      runSpan.end();
      await exitWithFlush(exitCode);
    }

    console.warn(
      `\n[e2e:staged] ${suite.toUpperCase()} failed in: ${failedFiles.join(", ")}`,
    );
    console.warn(
      `[e2e:staged] Retesting the failed file(s) once in a fresh process to classify flaky vs real...`,
    );
    const retestJsonPath = path.resolve(
      STAGED_RESULTS_DIR,
      `${suite}-retest.json`,
    );
    const retestExitCode = await runWithStreaming(
      process.execPath,
      [
        VITEST_CLI,
        "run",
        "--config",
        CONFIG,
        ...reporterArgs(retestJsonPath),
        ...failedFiles,
      ],
      appRoot,
      childEnv,
    );
    if (retestExitCode !== 0) {
      console.error(
        `\n[e2e:staged] ${suite.toUpperCase()} suite failed and the fresh-process retest failed again — treating as a real failure. Stopping before later suites.`,
      );
      suiteSpan.setAttribute("opensidebar.e2e.outcome", "failed");
      suiteSpan.end();
      suiteCounter.add(1, { suite, outcome: "failed" });
      runSpan.end();
      await exitWithFlush(retestExitCode);
    }

    flakyRescues.push(...failedFiles.map((file) => `${suite}: ${file}`));
    console.warn(
      `\n[e2e:staged] ${suite.toUpperCase()} suite FLAKY-PASSED (failures passed on a fresh-process retest). Continuing.`,
    );
    suiteSpan.setAttribute("opensidebar.e2e.outcome", "flaky-passed");
    suiteSpan.end();
    suiteCounter.add(1, { suite, outcome: "flaky-passed" });
  }

  runSpan.end();
  await shutdownOtel();

  if (flakyRescues.length > 0) {
    console.warn("\n[e2e:staged] ================ FLAKY SUMMARY ================");
    for (const rescue of flakyRescues) {
      console.warn(`[e2e:staged] FLAKY (passed on fresh-process retest): ${rescue}`);
    }
    console.warn(
      "[e2e:staged] These are passes, but each one cost a full retest run — see .artifacts/e2e/flaky-log.jsonl for the per-test retry log.",
    );
    console.warn("[e2e:staged] ===============================================");
  }

  console.log("\n[e2e:staged] All requested suites passed.");
}

main().catch((error) => {
  console.error("[e2e:staged] Fatal error:", error);
  process.exit(1);
});
