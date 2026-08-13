#!/usr/bin/env tsx

import { MemoryScenarioStore } from "@opensidebar/scenario-engine";
import type { BenchmarkSuite } from "@opensidebar/scenario-contracts";
import { PostgresModelBenchRepository } from "../apps/cloud-service/src/postgres-modelbench-repository.js";
import { compareScenarioStores, definitionsForSuite } from "./modelbench-store-parity.js";

const connectionString = process.env.MODEL_BENCH_DATABASE_URL;
if (!connectionString) {
  throw new Error("MODEL_BENCH_DATABASE_URL is required for local/cloud parity.");
}
const suite = (process.argv.find((value) => value.startsWith("--suite="))?.split("=")[1] ??
  "full-100") as BenchmarkSuite;
const remote = PostgresModelBenchRepository.fromConnectionString(connectionString);
try {
  await remote.migrate();
  const mismatches = await compareScenarioStores({
    local: new MemoryScenarioStore(),
    remote,
    definitions: definitionsForSuite(suite),
  });
  if (mismatches.length) {
    for (const mismatch of mismatches) {
      console.error(
        `[modelbench:cloud-parity] ${mismatch.caseId} ${mismatch.stage}: local=${mismatch.local} remote=${mismatch.remote}`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log(
      `[modelbench:cloud-parity] ${definitionsForSuite(suite).length} case(s) have identical initial state, oracle final state, and verdict.`,
    );
  }
} finally {
  await remote.pool.end();
}
