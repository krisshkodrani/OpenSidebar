#!/usr/bin/env tsx

import {
  checkModelBenchCatalog,
  checkRoleProbes,
  MODEL_BENCH_CASES,
  runOracle,
} from "@opensidebar/scenario-engine";
import type { BenchmarkSuite } from "@opensidebar/scenario-contracts";

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
  return MODEL_BENCH_CASES.filter(
    (definition) =>
      definition.contract.suites.includes(suite) &&
      (!requestedCase || definition.contract.id === requestedCase),
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
  if (errors.length) {
    for (const error of errors) console.error(`[modelbench:check] ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[modelbench:check] ${MODEL_BENCH_CASES.length} cases and 50 role probes satisfy catalog invariants.`);
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
