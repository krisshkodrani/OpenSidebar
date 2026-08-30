#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BenchmarkAttemptV1,
  PerceptionBenchmarkResultV1,
} from "@opensidebar/scenario-contracts";
import {
  MODEL_BENCH_CASES,
  MODEL_BENCH_PERCEPTION_CASES,
  buildPerceptionBenchmarkReport,
} from "@opensidebar/scenario-engine";
import {
  runModelBenchSuite,
  type ModelBenchDriver,
  type ModelBenchRunConfiguration,
} from "./modelbench-runner-lib.js";
import {
  perceptionProviderApiKey,
  runDirectPerceptionProbe,
} from "./modelbench-perception-client.js";
import {
  buildPerceptionResult,
  captureIntegrityForAttempt,
} from "./modelbench-perception-lib.js";

interface MatrixFileV1 {
  schemaVersion: 1;
  configurations: ModelBenchRunConfiguration[];
}

function option(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadDriver(path: string): Promise<ModelBenchDriver> {
  const module = (await import(pathToFileURL(resolve(path)).href)) as {
    default?: ModelBenchDriver;
    createModelBenchDriver?: () => ModelBenchDriver | Promise<ModelBenchDriver>;
  };
  const driver = module.createModelBenchDriver
    ? await module.createModelBenchDriver()
    : module.default;
  if (!driver || typeof driver.execute !== "function") {
    throw new Error(
      "Driver module must export default { execute() } or createModelBenchDriver().",
    );
  }
  return driver;
}

function readAttempts(path: string): BenchmarkAttemptV1[] {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as {
    attempts?: unknown;
  };
  if (!Array.isArray(parsed.attempts)) {
    throw new Error("Attempts input must contain attempts[].");
  }
  return parsed.attempts as BenchmarkAttemptV1[];
}

function terminalAttempts(attempts: readonly BenchmarkAttemptV1[]) {
  const retriedAttemptIds = new Set(
    attempts
      .map((attempt) => attempt.retryOfAttemptId)
      .filter((value): value is string => Boolean(value)),
  );
  return attempts.filter(
    (attempt) => !retriedAttemptIds.has(attempt.attemptId),
  );
}

const attemptsInput = option("--attempts");
const matrixPath = option("--matrix");
const skipDirect = flag("--skip-direct");
if (!attemptsInput && !matrixPath) {
  throw new Error(
    "Usage: pnpm modelbench:perception --matrix <matrix.json> [--driver scripts/modelbench-extension-driver.ts] [--case <id>] [--repeat 1] [--output .artifacts/modelbench/perception] or --attempts <attempts.json>",
  );
}

const outputDirectory = resolve(
  option("--output") ??
    `.artifacts/modelbench/perception-${new Date().toISOString().replaceAll(":", "-")}`,
);
mkdirSync(outputDirectory, { recursive: true });
const attemptsPath = resolve(outputDirectory, "integrated-attempts.json");
let attempts: BenchmarkAttemptV1[];

if (attemptsInput) {
  attempts = readAttempts(attemptsInput);
} else {
  const matrix = JSON.parse(
    readFileSync(resolve(matrixPath!), "utf8"),
  ) as MatrixFileV1;
  if (matrix.schemaVersion !== 1 || !Array.isArray(matrix.configurations)) {
    throw new Error(
      "ModelBench matrix must have schemaVersion 1 and configurations[].",
    );
  }
  const selectedCaseId = option("--case");
  const definitions = MODEL_BENCH_CASES.filter(
    (definition) =>
      definition.contract.primaryRole === "perception" &&
      (!selectedCaseId || definition.contract.id === selectedCaseId),
  );
  if (!definitions.length) {
    throw new Error(
      selectedCaseId
        ? `Unknown perception case: ${selectedCaseId}`
        : "ModelBench contains no perception cases.",
    );
  }
  attempts = [];
  const driver = await loadDriver(
    option("--driver") ?? "scripts/modelbench-extension-driver.ts",
  );
  try {
    await runModelBenchSuite({
      definitions,
      configurations: matrix.configurations,
      driver,
      buildRevision: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      repeat: positiveInteger(option("--repeat"), 1),
      onAttempt(attempt) {
        attempts.push(attempt);
        writeFileSync(
          attemptsPath,
          `${JSON.stringify({ attempts }, null, 2)}\n`,
        );
        console.log(
          `[modelbench:perception] integrated ${attempt.caseId}: ${attempt.classification}`,
        );
      },
    });
  } finally {
    await driver.close?.();
  }
}

const specs = new Map(
  MODEL_BENCH_PERCEPTION_CASES.map((definition) => [
    definition.caseId,
    definition,
  ]),
);
const results: PerceptionBenchmarkResultV1[] = [];
for (const attempt of terminalAttempts(attempts)) {
  const definition = specs.get(attempt.caseId);
  if (!definition) continue;
  const capture = captureIntegrityForAttempt(attempt);
  const requested = attempt.requestedSeats.executor;
  let direct: PerceptionBenchmarkResultV1["direct"] = null;
  if (!skipDirect && capture.image && requested) {
    if (!["openrouter", "fireworks"].includes(requested.provider)) {
      throw new Error(
        `Direct perception lane does not support provider '${requested.provider}'.`,
      );
    }
    const apiKey = perceptionProviderApiKey(requested.provider);
    if (!apiKey) {
      throw new Error(
        `${requested.provider === "openrouter" ? "OPENROUTER_API_KEY" : "FIREWORKS_API_KEY"} is required for the direct-model lane. Use --skip-direct for capture/integrated diagnostics only.`,
      );
    }
    direct = await runDirectPerceptionProbe({
      case: definition,
      image: capture.image,
      requested,
      apiKey,
    });
    console.log(
      `[modelbench:perception] direct ${attempt.caseId}: ${direct.passed ? "pass" : "fail"}`,
    );
  }
  results.push(
    buildPerceptionResult({
      case: definition,
      attempt,
      capture,
      direct,
    }),
  );
}

if (!results.length) {
  throw new Error("No perception attempts were found in the selected input.");
}
const report = buildPerceptionBenchmarkReport(results);
const reportPath = resolve(outputDirectory, "perception-report.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `[modelbench:perception] ${report.attempts} result(s) across ${report.cases} case(s); capture=${report.capture.accuracy ?? "n/a"}, direct=${report.direct.accuracy ?? "n/a"}, integrated=${report.integrated.accuracy ?? "n/a"}`,
);
console.log(`[modelbench:perception] Wrote ${reportPath}`);
