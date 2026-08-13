#!/usr/bin/env tsx

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MODEL_BENCH_CASES } from "@opensidebar/scenario-engine";
import { auditModelBenchTargets } from "./modelbench-target-quality.js";

function option(name: string): string | undefined {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const result = auditModelBenchTargets(MODEL_BENCH_CASES);
console.log(`[modelbench:quality] ${result.passing}/${result.reviewed} cases pass the target-quality audit.`);
for (const [criterion, count] of Object.entries(result.byCriterion)) {
  console.log(`[modelbench:quality] ${criterion}: ${count} finding(s)`);
}
for (const finding of result.findings) {
  console.log(`[modelbench:quality] ${finding.caseId}\t${finding.criterion}\t${finding.detail}`);
}

const output = option("--output");
if (output) {
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[modelbench:quality] Wrote ${path}`);
}
if (process.argv.includes("--gate") && result.findings.length) process.exitCode = 1;
