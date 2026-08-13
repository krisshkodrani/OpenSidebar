#!/usr/bin/env tsx

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BenchmarkAttemptV1,
  BenchmarkSuite,
} from "@opensidebar/scenario-contracts";
import { MODEL_BENCH_CASES } from "@opensidebar/scenario-engine";
import {
  runModelBenchSuite,
  type ModelBenchDriver,
  type ModelBenchRunConfiguration,
} from "./modelbench-runner-lib.js";

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

const matrixPath = option("--matrix");
const driverPath = option("--driver") ?? process.env.MODEL_BENCH_DRIVER;
if (!matrixPath || !driverPath) {
  throw new Error(
    "Usage: pnpm modelbench:run --matrix <matrix.json> --driver <driver.ts> [--suite core-20] [--repeat 1] [--output .artifacts/modelbench/run]",
  );
}
const matrix = JSON.parse(readFileSync(resolve(matrixPath), "utf8")) as MatrixFileV1;
if (matrix.schemaVersion !== 1 || !Array.isArray(matrix.configurations)) {
  throw new Error("ModelBench matrix must have schemaVersion 1 and configurations[].");
}
const suite = (option("--suite") ?? "core-20") as BenchmarkSuite;
const definitions = MODEL_BENCH_CASES.filter((definition) =>
  definition.contract.suites.includes(suite),
);
if (!definitions.length) throw new Error(`Unknown or empty ModelBench suite: ${suite}`);
const outputDirectory = resolve(
  option("--output") ?? `.artifacts/modelbench/${new Date().toISOString().replaceAll(":", "-")}`,
);
mkdirSync(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, "attempts.json");
const attempts: BenchmarkAttemptV1[] = [];
const driver = await loadDriver(driverPath);
const buildRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
await runModelBenchSuite({
  definitions,
  configurations: matrix.configurations,
  driver,
  buildRevision,
  repeat: positiveInteger(option("--repeat"), 1),
  onAttempt(attempt) {
    attempts.push(attempt);
    writeFileSync(outputPath, `${JSON.stringify({ attempts }, null, 2)}\n`);
    console.log(
      `[modelbench:run] ${attempt.caseId}: ${attempt.classification} (${attempt.durationMs} ms)`,
    );
  },
});
console.log(`[modelbench:run] Wrote ${attempts.length} attempt record(s) to ${outputPath}`);
