#!/usr/bin/env tsx

import {
  type DryResult,
  compactGoal,
  runWorkArenaDry,
  safeFilePart,
  today,
  writeJsonReport,
} from "./workarena-adapter-lib.js";

function parseArgs(): {
  taskId: string | null;
  seed: number;
  json: boolean;
  noReport: boolean;
  noReset: boolean;
  showBrowser: boolean;
} {
  const args = process.argv.slice(2);
  const taskArg = args[args.indexOf("--task") + 1];
  const seedArg = Number.parseInt(args[args.indexOf("--seed") + 1] ?? "", 10);
  return {
    taskId: taskArg && !taskArg.startsWith("--") ? taskArg : null,
    seed: Number.isFinite(seedArg) ? seedArg : 42,
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
    noReset: args.includes("--no-reset"),
    showBrowser: args.includes("--show-browser"),
  };
}

function writeReport(result: DryResult): string {
  return writeJsonReport(
    result,
    `workarena-dry-${today()}-${safeFilePart(result.taskId)}.json`,
  );
}

function runDry(): DryResult {
  const args = parseArgs();
  if (!args.taskId) {
    throw new Error("--task is required");
  }

  return runWorkArenaDry({
    taskId: args.taskId,
    seed: args.seed,
    noReset: args.noReset,
    showBrowser: args.showBrowser,
  });
}

function printHuman(result: DryResult): void {
  console.log("\n[workarena:dry] WorkArena dry run");
  console.log(`[workarena:dry] Task: ${result.taskId}`);
  console.log(`[workarena:dry] Env: ${result.envId}`);
  console.log(`[workarena:dry] Seed: ${result.seed}`);
  console.log(`[workarena:dry] Category: ${result.category ?? "uncategorized"}`);
  console.log(`[workarena:dry] Kind: ${result.kind}`);
  console.log(
    `[workarena:dry] Reset: ${
      result.resetAttempted ? (result.resetSucceeded ? "ok" : "not ok") : "skipped"
    }`,
  );
  console.log(
    `[workarena:dry] Teardown: ${
      result.teardownSucceeded === null
        ? "not attempted"
        : result.teardownSucceeded
          ? "ok"
          : "not ok"
    }`,
  );
  console.log(`[workarena:dry] Duration: ${Math.round(result.durationMs / 1000)}s`);
  if (result.reportPath) {
    console.log(`[workarena:dry] Report: ${result.reportPath}`);
  }
  console.log("");
  console.log(`[workarena:dry] Start URL: ${result.startUrl ?? "(none)"}`);
  console.log(`[workarena:dry] Active URL: ${result.activeUrl ?? "(none)"}`);
  console.log(`[workarena:dry] Goal: ${compactGoal(result.goal)}`);
  if (result.error) {
    console.log(`[workarena:dry] Error: ${result.error}`);
  }
}

function main(): void {
  const args = parseArgs();
  const result = runDry();
  if (!args.noReport) {
    result.reportPath = writeReport(result);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  if (!result.resetSucceeded && !args.noReset) {
    process.exitCode = 1;
  }
}

main();
