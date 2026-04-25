#!/usr/bin/env tsx

import {
  type DoctorResult,
  type DryResult,
  type ReadinessStatus,
  type WorkArenaAdapterPhase,
  type WorkArenaAdapterPhaseStatus,
  type WorkArenaAdapterPlan,
  classifyReadiness,
  readinessLabel,
  runWorkArenaDry,
  runWorkArenaDoctor,
  safeFilePart,
  today,
  withReadiness,
  writeJsonReport,
} from "./workarena-adapter-lib.js";

function parseArgs(): {
  taskId: string | null;
  seed: number;
  json: boolean;
  noReport: boolean;
  skipDoctor: boolean;
} {
  const args = process.argv.slice(2);
  const taskArg = args[args.indexOf("--task") + 1];
  const seedArg = Number.parseInt(args[args.indexOf("--seed") + 1] ?? "", 10);
  return {
    taskId: taskArg && !taskArg.startsWith("--") ? taskArg : null,
    seed: Number.isFinite(seedArg) ? seedArg : 42,
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
    skipDoctor: args.includes("--skip-doctor"),
  };
}

function phase(
  name: string,
  status: WorkArenaAdapterPhaseStatus,
  detail: string,
): WorkArenaAdapterPhase {
  return { name, status, detail };
}

function readinessFromDoctor(doctor: DoctorResult, skipDoctor: boolean): ReadinessStatus {
  if (skipDoctor) return "local_ready_hf_pending";
  return doctor.readiness ?? classifyReadiness(doctor);
}

function buildPhases(
  dry: DryResult,
  readiness: ReadinessStatus,
  skipDoctor: boolean,
): WorkArenaAdapterPhase[] {
  const accessStatus = readiness === "ready" ? "ready" : "pending";
  return [
    phase(
      "doctor",
      skipDoctor ? "pending" : readiness === "blocked" ? "blocked" : "ready",
      skipDoctor
        ? "Skipped by --skip-doctor."
        : readinessLabel(readiness),
    ),
    phase(
      "metadata_discovery",
      "ready",
      `Resolved ${dry.className} as ${dry.kind} task ${dry.taskId}.`,
    ),
    phase(
      "no_reset_contract",
      "ready",
      "Verified adapter metadata without env.reset(), ServiceNow mutation, or LLM calls.",
    ),
    phase(
      "workarena_reset",
      accessStatus,
      readiness === "ready"
        ? "Allowed when running the real adapter command."
        : "Blocked until gated ServiceNow dataset access is approved.",
    ),
    phase(
      "extension_execution",
      "pending",
      "Next implementation step: launch OpenSidebar in a separate extension browser with transferred WorkArena session state.",
    ),
    phase(
      "workarena_validation",
      "pending",
      "Next implementation step: call WorkArena validation after the agent stops.",
    ),
  ];
}

function buildPlan(
  dry: DryResult,
  doctor: DoctorResult,
  skipDoctor: boolean,
): WorkArenaAdapterPlan {
  const readiness = readinessFromDoctor(doctor, skipDoctor);
  return {
    benchmark: "workarena",
    mode: "adapter-plan",
    ready: readiness !== "blocked" && !dry.error,
    readiness,
    task: {
      taskId: dry.taskId,
      envId: dry.envId,
      seed: dry.seed,
      category: dry.category,
      kind: dry.kind,
      level: dry.level,
      className: dry.className,
    },
    prompt: {
      available: false,
      source: "workarena_goal_after_reset",
      value: null,
      note:
        "The real prompt is supplied by WorkArena obs.goal after env.reset(); metadata mode intentionally does not reset.",
    },
    browser: {
      source: "browsergym",
      resetRequired: true,
      attachStrategy: "separate-extension-browser-with-transferred-session",
      startUrl: dry.startUrl,
      activeUrl: dry.activeUrl,
    },
    runner: {
      phases: buildPhases(dry, readiness, skipDoctor),
    },
    safety: [
      "Adapter metadata mode never calls an LLM provider.",
      "Adapter metadata mode always passes --no-reset to the WorkArena bridge.",
      "Real ServiceNow reset remains gated behind explicit runner work after dataset access is approved.",
      "Reports are local artifacts under .artifacts/e2e and are not tracked product docs.",
    ],
    reports: {},
  };
}

function runNoResetDry(taskId: string, seed: number): DryResult {
  return runWorkArenaDry({ taskId, seed, noReset: true });
}

function printHuman(plan: WorkArenaAdapterPlan): void {
  console.log("\n[workarena:adapter] WorkArena adapter plan");
  console.log(`[workarena:adapter] Ready: ${plan.ready ? "yes" : "no"}`);
  console.log(`[workarena:adapter] Status: ${readinessLabel(plan.readiness)}`);
  console.log(`[workarena:adapter] Task: ${plan.task.taskId}`);
  console.log(`[workarena:adapter] Env: ${plan.task.envId}`);
  console.log(`[workarena:adapter] Seed: ${plan.task.seed}`);
  console.log(`[workarena:adapter] Category: ${plan.task.category ?? "uncategorized"}`);
  console.log(`[workarena:adapter] Class: ${plan.task.className}`);
  if (plan.reports.adapterPlanPath) {
    console.log(`[workarena:adapter] Report: ${plan.reports.adapterPlanPath}`);
  }
  console.log("");
  console.log(`[workarena:adapter] Prompt: ${plan.prompt.note}`);
  console.log(`[workarena:adapter] Browser attach: ${plan.browser.attachStrategy}`);
  console.log("");
  console.log("[workarena:adapter] Phases:");
  for (const item of plan.runner.phases) {
    console.log(`[workarena:adapter]   - ${item.status.padEnd(7, " ")} ${item.name}: ${item.detail}`);
  }
}

function main(): void {
  const args = parseArgs();
  if (!args.taskId) {
    throw new Error("--task is required");
  }

  const doctor = args.skipDoctor
    ? withReadiness({
        benchmark: "workarena",
        ready: true,
        dataset: "ServiceNow/WorkArena-Instances",
        pythonExecutable: "(skipped)",
        platform: process.platform,
        checks: [],
      })
    : withReadiness(runWorkArenaDoctor(true));
  const dry = runNoResetDry(args.taskId, args.seed);
  const plan = buildPlan(dry, doctor, args.skipDoctor);

  if (!args.noReport) {
    plan.reports.adapterPlanPath = writeJsonReport(
      plan,
      `workarena-adapter-${today()}-${safeFilePart(plan.task.taskId)}.json`,
    );
  }

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    printHuman(plan);
  }

  if (!plan.ready) {
    process.exitCode = 1;
  }
}

main();
