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
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });

    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
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

  for (const suite of suites) {
    const testFiles = E2E_SUITES[suite].map((file) =>
      path.join("tests/e2e", file),
    );
    console.log(`\n[e2e:staged] Running ${suite.toUpperCase()} suite...`);
    const exitCode = await runWithStreaming(
      process.execPath,
      [VITEST_CLI, "run", "--config", CONFIG, ...testFiles],
      path.resolve(PROJECT_ROOT, "apps/extension"),
    );
    if (exitCode !== 0) {
      console.error(
        `\n[e2e:staged] ${suite.toUpperCase()} suite failed. Stopping before later suites.`,
      );
      process.exit(exitCode);
    }
    console.log(`\n[e2e:staged] ${suite.toUpperCase()} suite passed.`);
  }

  console.log("\n[e2e:staged] All requested suites passed.");
}

main().catch((error) => {
  console.error("[e2e:staged] Fatal error:", error);
  process.exit(1);
});
