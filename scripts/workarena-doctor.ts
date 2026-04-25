#!/usr/bin/env tsx

import {
  type DoctorResult,
  classifyReadiness,
  formatStatus,
  readinessLabel,
  runWorkArenaDoctor,
  today,
  withReadiness,
  writeJsonReport,
} from "./workarena-adapter-lib.js";

function parseArgs(): {
  json: boolean;
  noReport: boolean;
  allowPendingHf: boolean;
} {
  const args = process.argv.slice(2);
  return {
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
    allowPendingHf: args.includes("--allow-pending-hf"),
  };
}

function writeReport(result: DoctorResult): string {
  return writeJsonReport(result, `workarena-doctor-${today()}.json`);
}

function printHuman(result: DoctorResult): void {
  const readiness = result.readiness ?? classifyReadiness(result);
  console.log("\n[workarena:doctor] WorkArena setup status");
  console.log(`[workarena:doctor] Ready: ${result.ready ? "yes" : "no"}`);
  console.log(`[workarena:doctor] Status: ${readinessLabel(readiness)}`);
  console.log(`[workarena:doctor] Python: ${result.pythonExecutable}`);
  console.log(`[workarena:doctor] Dataset: ${result.dataset}`);
  if (result.reportPath) {
    console.log(`[workarena:doctor] Report: ${result.reportPath}`);
  }
  console.log("");

  for (const check of result.checks) {
    console.log(
      `[workarena:doctor] ${formatStatus(check.status)} ${check.name}: ${check.detail}`,
    );
  }

  const hf = result.checks.find((check) => check.name === "huggingface_access");
  if (hf?.status === "pending") {
    console.log(
      "\n[workarena:doctor] Hugging Face token is present; gated WorkArena access still appears pending.",
    );
    console.log(
      "[workarena:doctor] Continue local setup with `--allow-pending-hf`; real ServiceNow resets remain blocked until access is granted.",
    );
  }
}

function main(): void {
  const args = parseArgs();
  const classified = withReadiness(runWorkArenaDoctor(args.allowPendingHf));
  if (!args.noReport) {
    classified.reportPath = writeReport(classified);
  }

  if (args.json) {
    console.log(JSON.stringify(classified, null, 2));
  } else {
    printHuman(classified);
  }

  if (!classified.ready) {
    process.exitCode = 1;
  }
}

main();
