#!/usr/bin/env tsx

import { execSync, spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  type ListResult,
  PROJECT_ROOT,
  REPORTS_DIR,
  runWorkArenaBridge,
  safeFilePart,
  today,
  writeJsonReport,
} from "./workarena-adapter-lib.js";
import {
  aggregateWorkArenaReports,
  formatPercent,
  generateWorkArenaGradeMarkdown,
  readExecutionReport,
  type WorkArenaGradeInput,
} from "./workarena-grading-lib.js";
import {
  completedKeysFromSuiteReport,
  parseSuiteArgs,
  suiteAttemptReportSuffix,
  selectSuiteTargets,
  suiteReportFileStem,
  suiteRunFromAttempt,
  targetKey,
  type WorkArenaSuiteArgs,
  type WorkArenaSuiteReport,
  type WorkArenaSuiteRunRecord,
  type WorkArenaSuiteTarget,
} from "./workarena-suite-lib.js";

const TSX_CLI = resolve(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

function loadTaskList(args: WorkArenaSuiteArgs): ListResult {
  return runWorkArenaBridge<ListResult>(["list", "--suite", args.suite], {
    timeoutMs: 120_000,
  });
}

function runBuildIfNeeded(args: WorkArenaSuiteArgs): void {
  if (args.noBuild || args.dryRun) return;
  console.log("\n[workarena:suite] Building extension once before suite run...");
  execSync("corepack pnpm run build", {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    windowsHide: true,
  });
}

function readPriorSuiteReport(path: string | null): WorkArenaSuiteReport | null {
  if (!path) return null;
  const absolute = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolute)) return null;
  const parsed = JSON.parse(readFileSync(absolute, "utf-8")) as unknown;
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { benchmark?: unknown }).benchmark === "workarena" &&
    (parsed as { mode?: unknown }).mode === "suite" &&
    Array.isArray((parsed as { runs?: unknown }).runs)
  ) {
    return parsed as WorkArenaSuiteReport;
  }
  return null;
}

function expectedHandoffReportPath(taskId: string, suffix: string): string {
  return resolve(
    REPORTS_DIR,
    `workarena-handoff-${today()}-${safeFilePart(taskId)}-${safeFilePart(suffix)}.json`,
  );
}

function runHandoff(
  target: WorkArenaSuiteTarget,
  attempt: number,
  args: WorkArenaSuiteArgs,
  generatedAt: string,
): { reportPath: string | null; exitCode: number | null } {
  const suffix = suiteAttemptReportSuffix(generatedAt, target.seed, attempt);
  const commandArgs = [
    TSX_CLI,
    "scripts/workarena-handoff.ts",
    "--task",
    target.task.id,
    "--seed",
    String(target.seed),
    "--max-turns",
    String(args.maxTurns),
    "--timeout-ms",
    String(args.timeoutMs),
    "--report-suffix",
    suffix,
    "--no-build",
  ];
  if (args.allowServiceNowReset) commandArgs.push("--allow-servicenow-reset");
  if (args.showBrowser) commandArgs.push("--show-browser");

  console.log(
    `\n[workarena:suite] Running ${target.task.id} seed ${target.seed} attempt ${attempt}/${args.retries + 1}`,
  );
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      ...(args.provider ? { E2E_PROVIDER: args.provider } : {}),
    },
  });
  const reportPath = expectedHandoffReportPath(target.task.id, suffix);
  return {
    reportPath: existsSync(reportPath) ? reportPath : null,
    exitCode: result.status,
  };
}

function failedRunRecord(
  target: WorkArenaSuiteTarget,
  attempt: number,
  message: string,
): WorkArenaSuiteRunRecord {
  return {
    taskId: target.task.id,
    category: target.task.category,
    seed: target.seed,
    attempt,
    status: "error",
    passed: false,
    score: null,
    reportPath: null,
    turns: null,
    traces: 0,
    failureStage: "agent_run",
    validationMessage: message,
    prompt: null,
    warnings: [message],
  };
}

function skippedRunRecord(target: WorkArenaSuiteTarget): WorkArenaSuiteRunRecord {
  return {
    taskId: target.task.id,
    category: target.task.category,
    seed: target.seed,
    attempt: 0,
    status: "skipped",
    passed: false,
    score: null,
    reportPath: null,
    turns: null,
    traces: 0,
    failureStage: null,
    validationMessage: "Skipped by --resume-from-report.",
    prompt: null,
    warnings: [],
  };
}

function generateSuiteMarkdown(report: WorkArenaSuiteReport): string {
  const lines: string[] = [];
  lines.push("# WorkArena Suite Report");
  lines.push("");
  lines.push(`Date: ${report.generatedAt.split("T")[0]}`);
  lines.push(`Suite: ${report.suite}`);
  lines.push(`Categories: ${report.categories.join(", ")}`);
  lines.push(`Seeds: ${report.seeds.join(", ")}`);
  lines.push(`Overall status: ${report.status}`);
  lines.push(
    `Result: ${report.grade.totals.passedAt1}/${report.grade.targetCount} pass@1 (${formatPercent(report.grade.passAt1)}); category-balanced pass@1 ${formatPercent(report.grade.categoryBalancedPassAt1)}.`,
  );
  lines.push("");
  lines.push("## Runs");
  lines.push("");
  lines.push("| Task | Seed | Attempt | Status | Score | Turns | Traces | Message |");
  lines.push("| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |");
  for (const run of report.runs) {
    lines.push(
      `| ${run.taskId.replace(/\|/g, "\\|")} | ${run.seed} | ${run.attempt} | ${run.status} | ${run.score ?? "n/a"} | ${run.turns ?? "n/a"} | ${run.traces} | ${(run.validationMessage ?? "").replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  lines.push("## Grade");
  lines.push("");
  lines.push(generateWorkArenaGradeMarkdown(report.grade).trim());
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeSuiteReports(report: WorkArenaSuiteReport): WorkArenaSuiteReport {
  const baseStem = suiteReportFileStem(report);
  let stem = baseStem;
  let collision = 1;
  while (
    existsSync(resolve(REPORTS_DIR, `${stem}.json`)) ||
    existsSync(resolve(REPORTS_DIR, `${stem}.md`))
  ) {
    stem = `${baseStem}-${collision}`;
    collision += 1;
  }
  const jsonPath = writeJsonReport(report, `${stem}.json`);
  const markdownPath = resolve(REPORTS_DIR, `${stem}.md`);
  const withReports: WorkArenaSuiteReport = {
    ...report,
    reports: {
      jsonReportPath: jsonPath,
      markdownReportPath: markdownPath,
    },
  };
  writeFileSync(jsonPath, `${JSON.stringify(withReports, null, 2)}\n`, "utf-8");
  writeFileSync(markdownPath, generateSuiteMarkdown(withReports), "utf-8");
  return withReports;
}

function suiteStatus(
  args: WorkArenaSuiteArgs,
  planned: number,
  runs: WorkArenaSuiteRunRecord[],
  gradeTargetCount: number,
): WorkArenaSuiteReport["status"] {
  if (args.dryRun) return "planned";
  const skipped = runs.filter((run) => run.status === "skipped").length;
  const attemptedTargets = new Set(
    runs
      .filter((run) => run.status !== "skipped")
      .map((run) => targetKey(run.taskId, run.seed)),
  ).size;
  if (runs.some((run) => run.status === "error" && !run.reportPath)) return "error";
  if (attemptedTargets + skipped < planned) return "partial";
  return gradeTargetCount > 0 && gradeTargetCount === planned - skipped
    ? gradeTargetCount ===
        new Set(
          runs
            .filter((run) => run.passed)
            .map((run) => targetKey(run.taskId, run.seed)),
        ).size
      ? "passed"
      : "failed"
    : "partial";
}

async function main(): Promise<void> {
  const args = parseSuiteArgs();
  const generatedAt = new Date().toISOString();
  const list = loadTaskList(args);
  const targets = selectSuiteTargets(list, args);
  const prior = readPriorSuiteReport(args.resumeFromReport);
  const completed = completedKeysFromSuiteReport(prior);
  const runs: WorkArenaSuiteRunRecord[] = prior?.runs ? [...prior.runs] : [];
  const gradeInputs: WorkArenaGradeInput[] = [];

  console.log("\n[workarena:suite] WorkArena suite");
  console.log(`[workarena:suite] Suite: ${args.suite}`);
  console.log(`[workarena:suite] Categories: ${args.categories.join(", ")}`);
  console.log(`[workarena:suite] Seeds: ${args.seeds.join(", ")}`);
  console.log(`[workarena:suite] Planned targets: ${targets.length}`);
  if (args.dryRun) {
    for (const target of targets) {
      console.log(`[workarena:suite] PLAN ${target.task.id} seed ${target.seed}`);
    }
  } else {
    runBuildIfNeeded(args);
  }

  for (const target of targets) {
    const key = targetKey(target.task.id, target.seed);
    if (completed.has(key)) {
      runs.push(skippedRunRecord(target));
      continue;
    }
    if (args.dryRun) continue;

    let passed = false;
    for (let attempt = 1; attempt <= args.retries + 1; attempt += 1) {
      const handoff = runHandoff(target, attempt, args, generatedAt);
      const input = handoff.reportPath ? readExecutionReport(handoff.reportPath) : null;
      if (!input) {
        runs.push(
          failedRunRecord(
            target,
            attempt,
            `Handoff exited ${handoff.exitCode ?? "unknown"} without an execution report.`,
          ),
        );
        if (args.stopOnFirstFailure) break;
        continue;
      }
      input.attempt = attempt;
      gradeInputs.push(input);
      const graded = aggregateWorkArenaReports([input]).attempts[0];
      runs.push(suiteRunFromAttempt(graded));
      passed = graded.passed;
      if (passed) break;
    }
    if (!passed && args.stopOnFirstFailure) break;
  }

  for (const run of runs) {
    if (!run.reportPath || run.status === "skipped") continue;
    const input = readExecutionReport(run.reportPath);
    if (input) {
      input.attempt = run.attempt;
      if (
        !gradeInputs.some(
          (existing) =>
            existing.reportPath === input.reportPath && existing.attempt === input.attempt,
        )
      ) {
        gradeInputs.push(input);
      }
    }
  }

  const grade = aggregateWorkArenaReports(gradeInputs);
  const report: WorkArenaSuiteReport = {
    benchmark: "workarena",
    mode: "suite",
    generatedAt,
    suite: args.suite,
    categories: args.categories,
    seeds: args.seeds,
    maxTurns: args.maxTurns,
    timeoutMs: args.timeoutMs,
    retries: args.retries,
    provider: args.provider,
    allowServiceNowReset: args.allowServiceNowReset,
    status: suiteStatus(args, targets.length, runs, grade.targetCount),
    planned: targets.length,
    completed: new Set(
      runs
        .filter((run) => run.status !== "skipped" && run.status !== "pending")
        .map((run) => targetKey(run.taskId, run.seed)),
    ).size,
    skipped: runs.filter((run) => run.status === "skipped").length,
    runs,
    grade,
    reports: {},
  };
  const finalReport = args.noReport || args.dryRun ? report : writeSuiteReports(report);

  if (args.json) {
    console.log(JSON.stringify(finalReport, null, 2));
  } else if (!args.dryRun) {
    console.log(`[workarena:suite] Status: ${finalReport.status}`);
    console.log(
      `[workarena:suite] Pass@1: ${finalReport.grade.totals.passedAt1}/${finalReport.grade.targetCount} (${formatPercent(finalReport.grade.passAt1)})`,
    );
    if (finalReport.reports.jsonReportPath) {
      console.log(`[workarena:suite] JSON: ${finalReport.reports.jsonReportPath}`);
    }
    if (finalReport.reports.markdownReportPath) {
      console.log(`[workarena:suite] Markdown: ${finalReport.reports.markdownReportPath}`);
    }
  }
}

main().catch((error) => {
  console.error("[workarena:suite] Fatal error:", error);
  process.exit(1);
});
