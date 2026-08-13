#!/usr/bin/env tsx

import {
  checkModelBenchCatalog,
  checkRoleProbes,
  MODEL_BENCH_ACCEPTANCE_CASES,
  MODEL_BENCH_CASES,
  runOracle,
} from "@opensidebar/scenario-engine";
import type { BenchmarkSuite } from "@opensidebar/scenario-contracts";
import {
  buildLegacyMigrationMatrix,
  checkLegacyMigrationMatrix,
} from "./modelbench-migration-matrix.js";

const SUITES = new Set<BenchmarkSuite>([
  "smoke-10",
  "core-20",
  "standard-50",
  "full-100",
]);

function option(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function selectedCases() {
  const rawSuite = option("--suite") ?? "full-100";
  if (!SUITES.has(rawSuite as BenchmarkSuite)) {
    throw new Error(`Unknown ModelBench suite: ${rawSuite}`);
  }
  const suite = rawSuite as BenchmarkSuite;
  const requestedCase = option("--case");
  const runnableCases = requestedCase
    ? [...MODEL_BENCH_CASES, ...MODEL_BENCH_ACCEPTANCE_CASES]
    : MODEL_BENCH_CASES;
  return runnableCases.filter(
    (definition) =>
      requestedCase
        ? definition.contract.id === requestedCase
        : definition.contract.suites.includes(suite),
  );
}

function list(): void {
  for (const definition of selectedCases()) {
    const value = definition.contract;
    console.log(
      `${value.id}\t${value.difficulty}\t${value.primaryRole}\t${value.scenarioId}\t${value.title}`,
    );
  }
}

function check(): void {
  const errors = checkModelBenchCatalog(MODEL_BENCH_CASES);
  errors.push(...checkRoleProbes());
  if (MODEL_BENCH_ACCEPTANCE_CASES.length !== 1) {
    errors.push(`expected one post-headline acceptance case, received ${MODEL_BENCH_ACCEPTANCE_CASES.length}`);
  }
  for (const definition of MODEL_BENCH_ACCEPTANCE_CASES) {
    if (definition.contract.suites.length !== 0) {
      errors.push(`${definition.contract.id}: acceptance case must not alter headline suites`);
    }
    if (runOracle(definition).verdict !== "pass") {
      errors.push(`${definition.contract.id}: acceptance oracle did not pass`);
    }
    for (const miss of definition.nearMisses) {
      if (runOracle(definition, miss.outcome).verdict !== "fail") {
        errors.push(`${definition.contract.id}: near miss ${miss.id} did not fail`);
      }
    }
  }
  const migration = buildLegacyMigrationMatrix();
  errors.push(...checkLegacyMigrationMatrix(migration));
  if (errors.length) {
    for (const error of errors) console.error(`[modelbench:check] ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[modelbench:check] ${MODEL_BENCH_CASES.length} headline cases, MB-101, 50 role probes, and ${migration.length} legacy migration entries satisfy benchmark invariants.`);
}

function oracle(): void {
  const cases = selectedCases();
  let assertions = 0;
  for (const definition of cases) {
    const gold = runOracle(definition);
    if (gold.verdict !== "pass") {
      throw new Error(`${definition.contract.id}: gold oracle returned ${gold.verdict}`);
    }
    assertions += gold.assertions.length;
    for (const miss of definition.nearMisses) {
      const result = runOracle(definition, miss.outcome);
      if (result.verdict !== "fail") {
        throw new Error(`${definition.contract.id}: near miss ${miss.id} returned ${result.verdict}`);
      }
      assertions += result.assertions.length;
    }
  }
  console.log(
    `[modelbench:oracle] ${cases.length} gold paths passed; ${cases.length * 3} near misses rejected; ${assertions} assertions evaluated.`,
  );
}

const command = process.argv[2] ?? "check";
if (command === "list") list();
else if (command === "check") check();
else if (command === "oracle") oracle();
else throw new Error(`Unknown ModelBench command: ${command}`);
