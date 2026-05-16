#!/usr/bin/env tsx

import {
  type DoctorResult,
  type DryResult,
  type ReadinessStatus,
  type WorkArenaResetRun,
  type WorkArenaResetRunStatus,
  compactGoal,
  readinessLabel,
  runWorkArenaDoctor,
  runWorkArenaDry,
  safeFilePart,
  today,
  withReadiness,
  writeJsonReport,
} from "./workarena-adapter-lib.js";
import {
  WORKARENA_ENV_RESET_SAFETY_NOTE,
  WORKARENA_RESET_APPROVAL_MESSAGE,
} from "./workarena-safety.js";

function parseArgs(): {
  taskId: string | null;
  seed: number;
  json: boolean;
  noReport: boolean;
  showBrowser: boolean;
  allowServiceNowReset: boolean;
} {
  const args = process.argv.slice(2);
  const taskArg = args[args.indexOf("--task") + 1];
  const seedArg = Number.parseInt(args[args.indexOf("--seed") + 1] ?? "", 10);
  return {
    taskId: taskArg && !taskArg.startsWith("--") ? taskArg : null,
    seed: Number.isFinite(seedArg) ? seedArg : 42,
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
    showBrowser: args.includes("--show-browser"),
    allowServiceNowReset:
      args.includes("--allow-servicenow-reset") || args.includes("--reset"),
  };
}

function statusFor(
  allowServiceNowReset: boolean,
  doctor: DoctorResult,
  reset: DryResult | null,
): WorkArenaResetRunStatus {
  if (!allowServiceNowReset) return "blocked_requires_reset_flag";
  if (!doctor.ready) return "blocked_setup";
  if (reset?.resetSucceeded) return "reset_succeeded";
  return "reset_failed";
}

function buildResult(args: ReturnType<typeof parseArgs>): WorkArenaResetRun {
  if (!args.taskId) {
    throw new Error("--task is required");
  }

  const doctor = withReadiness(runWorkArenaDoctor(false));
  const readiness = doctor.readiness ?? "blocked";
  const reset =
    args.allowServiceNowReset && doctor.ready
      ? runWorkArenaDry({
          taskId: args.taskId,
          seed: args.seed,
          showBrowser: args.showBrowser,
        })
      : null;
  const status = statusFor(args.allowServiceNowReset, doctor, reset);
  const ready = status === "reset_succeeded";
  const canExecuteAgent = ready && Boolean(reset?.goal);

  return {
    benchmark: "workarena",
    mode: "guarded-reset",
    ready,
    status,
    readiness,
    task: {
      taskId: args.taskId,
      seed: args.seed,
    },
    doctor: {
      ready: doctor.ready,
      readiness,
      pythonExecutable: doctor.pythonExecutable,
      dataset: doctor.dataset,
      checks: doctor.checks,
    },
    reset,
    next: {
      canExecuteAgent,
      reason: canExecuteAgent
        ? "Goal and initial browser state are available for the future agent runner."
        : nextBlockedReason(status, readiness),
    },
    safety: [
      "This command never starts OpenSidebar or calls an LLM provider.",
      WORKARENA_ENV_RESET_SAFETY_NOTE,
      "The reset path requires doctor.ready=true, including approved gated dataset access.",
      "The WorkArena bridge closes the environment after collecting reset diagnostics.",
    ],
  };
}

function nextBlockedReason(
  status: WorkArenaResetRunStatus,
  readiness: ReadinessStatus,
): string {
  if (status === "blocked_requires_reset_flag") {
    return WORKARENA_RESET_APPROVAL_MESSAGE;
  }
  if (status === "blocked_setup") {
    return `Setup is not fully ready: ${readinessLabel(readiness)}.`;
  }
  return "Reset did not succeed; inspect reset.error in the JSON report.";
}

function writeReport(result: WorkArenaResetRun): string {
  return writeJsonReport(
    result,
    `workarena-run-${today()}-${safeFilePart(result.task.taskId)}.json`,
  );
}

function printHuman(result: WorkArenaResetRun): void {
  console.log("\n[workarena:run] WorkArena guarded reset");
  console.log(`[workarena:run] Ready: ${result.ready ? "yes" : "no"}`);
  console.log(`[workarena:run] Status: ${result.status}`);
  console.log(`[workarena:run] Setup: ${readinessLabel(result.readiness)}`);
  console.log(`[workarena:run] Task: ${result.task.taskId}`);
  console.log(`[workarena:run] Seed: ${result.task.seed}`);
  console.log(`[workarena:run] Python: ${result.doctor.pythonExecutable}`);
  if (result.reportPath) {
    console.log(`[workarena:run] Report: ${result.reportPath}`);
  }
  console.log("");

  if (result.reset) {
    console.log(`[workarena:run] Env: ${result.reset.envId}`);
    console.log(`[workarena:run] Category: ${result.reset.category ?? "uncategorized"}`);
    console.log(`[workarena:run] Class: ${result.reset.className}`);
    console.log(`[workarena:run] Reset: ${result.reset.resetSucceeded ? "ok" : "not ok"}`);
    console.log(
      `[workarena:run] Teardown: ${
        result.reset.teardownSucceeded === null
          ? "not attempted"
          : result.reset.teardownSucceeded
            ? "ok"
            : "not ok"
      }`,
    );
    console.log(`[workarena:run] Start URL: ${result.reset.startUrl ?? "(none)"}`);
    console.log(`[workarena:run] Active URL: ${result.reset.activeUrl ?? "(none)"}`);
    console.log(`[workarena:run] Goal: ${compactGoal(result.reset.goal)}`);
    if (result.reset.error) {
      console.log(`[workarena:run] Error: ${result.reset.error}`);
    }
  } else {
    console.log(`[workarena:run] Reset: not attempted`);
  }
  console.log(`[workarena:run] Next: ${result.next.reason}`);
}

function main(): void {
  const args = parseArgs();
  const result = buildResult(args);
  if (!args.noReport) {
    result.reportPath = writeReport(result);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  if (!result.ready) {
    process.exitCode = 1;
  }
}

main();
