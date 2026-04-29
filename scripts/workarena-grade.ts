#!/usr/bin/env tsx

import {
  aggregateWorkArenaReports,
  discoverExecutionReports,
  generateWorkArenaGradeMarkdown,
  readExecutionReport,
  writeGradeReports,
  type WorkArenaGradeInput,
} from "./workarena-grading-lib.js";

function parseArgs(): {
  files: string[];
  all: boolean;
  json: boolean;
  noReport: boolean;
} {
  const args = process.argv.slice(2);
  const files: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--file") {
      const value = args[index + 1];
      if (value && !value.startsWith("--")) {
        files.push(value);
        index += 1;
      }
    } else if (!arg.startsWith("--")) {
      files.push(arg);
    }
  }
  return {
    files,
    all: args.includes("--all"),
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
  };
}

function reportDate(file: string): string | null {
  return /workarena-[a-z-]+-(\d{4}-\d{2}-\d{2})/.exec(file)?.[1] ?? null;
}

function latestDatedReports(files: string[]): string[] {
  const dated = files
    .map((file) => ({ file, date: reportDate(file) }))
    .filter((item): item is { file: string; date: string } => item.date !== null);
  if (dated.length === 0) return files;
  const latest = dated.map((item) => item.date).sort().at(-1);
  return latest ? dated.filter((item) => item.date === latest).map((item) => item.file) : files;
}

function printHuman(summary: ReturnType<typeof aggregateWorkArenaReports>): void {
  console.log("\n[workarena:grade] WorkArena grade");
  console.log(`[workarena:grade] Targets: ${summary.targetCount}`);
  console.log(`[workarena:grade] Runs: ${summary.runCount}`);
  console.log(
    `[workarena:grade] Pass@1: ${summary.totals.passedAt1}/${summary.targetCount} (${(summary.passAt1 * 100).toFixed(1)}%)`,
  );
  console.log(
    `[workarena:grade] Category-balanced pass@1: ${(summary.categoryBalancedPassAt1 * 100).toFixed(1)}%`,
  );
  console.log(`[workarena:grade] Mean score: ${summary.meanScore.toFixed(3)}`);
  console.log(`[workarena:grade] Median turns: ${summary.turns.medianAll ?? "n/a"}`);
  if (summary.reports.jsonReportPath) {
    console.log(`[workarena:grade] JSON: ${summary.reports.jsonReportPath}`);
  }
  if (summary.reports.markdownReportPath) {
    console.log(`[workarena:grade] Markdown: ${summary.reports.markdownReportPath}`);
  }
}

function main(): void {
  const args = parseArgs();
  const discovered = args.files.length > 0 ? args.files : discoverExecutionReports();
  const files = args.files.length > 0 || args.all ? discovered : latestDatedReports(discovered);
  const inputs = files
    .map((file) => readExecutionReport(file))
    .filter((input): input is WorkArenaGradeInput => input !== null);
  const summary = aggregateWorkArenaReports(inputs);
  const finalSummary = args.noReport ? summary : writeGradeReports(summary);

  if (args.json) {
    console.log(JSON.stringify(finalSummary, null, 2));
  } else {
    printHuman(finalSummary);
    if (args.noReport) {
      console.log(generateWorkArenaGradeMarkdown(finalSummary));
    }
  }
}

main();
