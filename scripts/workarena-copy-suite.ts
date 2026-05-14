#!/usr/bin/env tsx

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  getArenaTasksByTag,
  type ArenaTask,
} from "../apps/extension/tests/e2e/arena/tasks";
import {
  PROJECT_ROOT,
  REPORTS_DIR,
  today,
} from "./workarena-adapter-lib.js";

type StepStatus = "passed" | "failed" | "skipped";

type CopySuiteStep = {
  name: string;
  command: string;
  status: StepStatus;
  durationMs: number;
  notes: string;
};

function parseArgs(): {
  list: boolean;
  agent: boolean;
  noBuild: boolean;
  tag: string;
} {
  const args = process.argv.slice(2);
  const tagArg = args[args.indexOf("--tag") + 1];
  return {
    list: args.includes("--list"),
    agent: args.includes("--agent"),
    noBuild: args.includes("--no-build"),
    tag: tagArg && !tagArg.startsWith("--") ? tagArg : "workarena-gap",
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function runStep(
  name: string,
  command: string,
  cwd: string = PROJECT_ROOT,
): CopySuiteStep {
  const start = Date.now();
  console.log(`\n[workarena:copy] ${name}`);
  console.log(`[workarena:copy] ${command}`);
  const result = spawnSync(command, {
    cwd,
    shell: true,
    stdio: "inherit",
    windowsHide: true,
  });
  const durationMs = Date.now() - start;
  const status = result.status === 0 ? "passed" : "failed";
  return {
    name,
    command,
    status,
    durationMs,
    notes:
      status === "passed"
        ? "completed"
        : `exit ${result.status ?? "unknown"}`,
  };
}

function skippedStep(name: string, command: string, notes: string): CopySuiteStep {
  return {
    name,
    command,
    status: "skipped",
    durationMs: 0,
    notes,
  };
}

function printTasks(tasks: readonly ArenaTask[], tag: string): void {
  console.log("\n[workarena:copy] Local copy-suite tasks");
  console.log(`[workarena:copy] Tag: ${tag}`);
  console.log(`[workarena:copy] Count: ${tasks.length}`);
  for (const task of tasks) {
    console.log(
      `[workarena:copy]   - ${task.id} | ${task.tier} | ${task.validator}`,
    );
  }
}

function buildReport(steps: readonly CopySuiteStep[], tasks: readonly ArenaTask[]): string {
  const passed = steps.filter((step) => step.status === "passed").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const skipped = steps.filter((step) => step.status === "skipped").length;
  const lines: string[] = [];
  lines.push("# WorkArena Copy Suite Report");
  lines.push("");
  lines.push(`Date: ${today()}`);
  lines.push(`Scope: ${tasks.length} local WorkArena-style task(s)`);
  lines.push(
    `Overall result: ${failed === 0 ? "passed" : "failed"} (${passed} passed, ${failed} failed, ${skipped} skipped)`,
  );
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  lines.push("| Step | Status | Duration | Command | Notes |");
  lines.push("| --- | --- | ---: | --- | --- |");
  for (const step of steps) {
    lines.push(
      `| ${markdownEscape(step.name)} | ${step.status} | ${formatDuration(step.durationMs)} | \`${markdownEscape(step.command)}\` | ${markdownEscape(step.notes)} |`,
    );
  }
  lines.push("");
  lines.push("## Tasks");
  lines.push("");
  lines.push("| Task | Tier | Source | Validator | Prompt |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const task of tasks) {
    lines.push(
      `| \`${task.id}\` | ${task.tier} | \`${task.sourceFile}\` | \`${task.validator}\` | ${markdownEscape(task.prompt)} |`,
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Contract steps do not start OpenSidebar, ServiceNow, or an LLM provider.");
  lines.push("- The session import step launches the extension browser but does not call an LLM provider.");
  lines.push("- The optional agent step runs the local WorkArena-gap E2E suite with OpenSidebar.");
  lines.push("- Real WorkArena remains gated behind Hugging Face and explicit reset flags.");
  return `${lines.join("\n").trimEnd()}\n`;
}

function writeReport(steps: readonly CopySuiteStep[], tasks: readonly ArenaTask[]): string {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = resolve(REPORTS_DIR, `workarena-copy-suite-${today()}.md`);
  writeFileSync(reportPath, buildReport(steps, tasks), "utf-8");
  return reportPath;
}

function main(): void {
  const args = parseArgs();
  const tasks = getArenaTasksByTag(args.tag);
  if (tasks.length === 0) {
    throw new Error(`No arena tasks found for tag: ${args.tag}`);
  }

  printTasks(tasks, args.tag);
  if (args.list) {
    console.log("\n[workarena:copy] List only; exiting without running steps.");
    return;
  }

  const steps: CopySuiteStep[] = [];
  if (args.noBuild) {
    steps.push(
      skippedStep(
        "extension build",
        "corepack pnpm run build",
        "--no-build supplied",
      ),
    );
    steps.push(
      skippedStep(
        "fixture build",
        "corepack pnpm run fixtures:build",
        "--no-build supplied",
      ),
    );
  } else {
    steps.push(runStep("extension build", "corepack pnpm run build"));
    steps.push(runStep("fixture build", "corepack pnpm run fixtures:build"));
  }

  steps.push(runStep("arena registry validation", "corepack pnpm exec tsx scripts/e2e-arena.ts"));
  steps.push(
    runStep(
      "WorkArena category coverage",
      "corepack pnpm exec tsx scripts/workarena-category-coverage.ts",
    ),
  );

  for (const task of tasks) {
    steps.push(
      runStep(
        `local execution contract: ${task.id}`,
        `corepack pnpm exec tsx scripts/workarena-local-execution.ts --task ${task.id}`,
      ),
    );
  }

  steps.push(
    runStep(
      "browser attach strategy",
      "corepack pnpm exec tsx scripts/workarena-browser-strategy.ts",
    ),
  );
  steps.push(
    runStep(
      "held-session protocol",
      "corepack pnpm exec tsx scripts/workarena-held-session.ts --task workarena.servicenow.all-menu",
    ),
  );
  steps.push(
    runStep(
      "session state import E2E",
      "corepack pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/session-state-import.test.ts",
      resolve(PROJECT_ROOT, "apps/extension"),
    ),
  );
  steps.push(
    runStep(
      "workarena report validation",
      "corepack pnpm exec tsx scripts/workarena-validate-reports.ts",
    ),
  );

  if (args.agent) {
    const buildArg = args.noBuild ? " --no-build" : "";
    steps.push(
      runStep(
        "local WorkArena-gap agent E2E",
        `corepack pnpm exec tsx scripts/run-e2e-arena.ts --tag ${args.tag}${buildArg}`,
      ),
    );
  } else {
    steps.push(
      skippedStep(
        "local WorkArena-gap agent E2E",
        `corepack pnpm exec tsx scripts/run-e2e-arena.ts --tag ${args.tag}`,
        "pass --agent to run token-spending local agent E2E",
      ),
    );
  }

  const reportPath = writeReport(steps, tasks);
  const failed = steps.filter((step) => step.status === "failed");
  console.log(`\n[workarena:copy] Report: ${reportPath}`);
  console.log(
    `[workarena:copy] Complete: ${steps.length - failed.length}/${steps.length} non-failing steps.`,
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
