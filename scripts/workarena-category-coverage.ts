#!/usr/bin/env tsx

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { ARENA_TASKS } from "../apps/extension/tests/e2e/arena/tasks";
import {
  type ListResult,
  PROJECT_ROOT,
  REPORTS_DIR,
  runWorkArenaBridge,
  today,
} from "./workarena-adapter-lib.js";

type CategoryCoverage = {
  category: string;
  workArenaTaskCount: number;
  localTaskIds: string[];
  covered: boolean;
};

function parseArgs(): {
  json: boolean;
  noReport: boolean;
} {
  const args = process.argv.slice(2);
  return {
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
  };
}

function listWorkArenaCategories(): Array<{ category: string; count: number }> {
  const result = runWorkArenaBridge<ListResult>(["list", "--suite", "all"], {
    timeoutMs: 120_000,
  });
  return result.categories;
}

function localCoverageMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const task of ARENA_TASKS) {
    for (const tag of task.tags) {
      const prefix = "workarena-category:";
      if (!tag.startsWith(prefix)) continue;
      const category = tag.slice(prefix.length);
      map.set(category, [...(map.get(category) ?? []), task.id]);
    }
  }
  return map;
}

function buildCoverage(): CategoryCoverage[] {
  const local = localCoverageMap();
  return listWorkArenaCategories().map((category) => {
    const localTaskIds = local.get(category.category) ?? [];
    return {
      category: category.category,
      workArenaTaskCount: category.count,
      localTaskIds,
      covered: localTaskIds.length > 0,
    };
  });
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function buildMarkdown(coverage: readonly CategoryCoverage[]): string {
  const covered = coverage.filter((item) => item.covered).length;
  const lines: string[] = [];
  lines.push("# WorkArena Category Coverage");
  lines.push("");
  lines.push(`Date: ${today()}`);
  lines.push(`Overall result: ${covered}/${coverage.length} categories covered`);
  lines.push("");
  lines.push("| Category | WorkArena Tasks | Covered | Local Tasks |");
  lines.push("| --- | ---: | --- | --- |");
  for (const item of coverage) {
    lines.push(
      `| \`${markdownEscape(item.category)}\` | ${item.workArenaTaskCount} | ${item.covered ? "Yes" : "No"} | ${item.localTaskIds.map((id) => `\`${markdownEscape(id)}\``).join(", ") || "-"} |`,
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This is metadata-only. It does not reset ServiceNow, launch OpenSidebar, or call an LLM provider.");
  lines.push("- Coverage means at least one local arena task is tagged as an analog for the WorkArena category.");
  return `${lines.join("\n").trimEnd()}\n`;
}

function writeReport(coverage: readonly CategoryCoverage[]): string {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = resolve(REPORTS_DIR, `workarena-category-coverage-${today()}.md`);
  writeFileSync(reportPath, buildMarkdown(coverage), "utf-8");
  return reportPath;
}

function printHuman(coverage: readonly CategoryCoverage[], reportPath: string | null): void {
  const covered = coverage.filter((item) => item.covered).length;
  console.log("\n[workarena:coverage] WorkArena category coverage");
  console.log(`[workarena:coverage] Covered: ${covered}/${coverage.length}`);
  if (reportPath) console.log(`[workarena:coverage] Report: ${reportPath}`);
  console.log("");
  for (const item of coverage) {
    const local = item.localTaskIds.length > 0 ? item.localTaskIds.join(", ") : "-";
    console.log(
      `[workarena:coverage] ${item.covered ? "OK" : "MISS"} ${item.category} (${item.workArenaTaskCount}) -> ${local}`,
    );
  }
}

function main(): void {
  const args = parseArgs();
  const coverage = buildCoverage();
  const reportPath = args.noReport ? null : writeReport(coverage);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          benchmark: "workarena",
          mode: "category-coverage",
          root: PROJECT_ROOT,
          covered: coverage.filter((item) => item.covered).length,
          total: coverage.length,
          categories: coverage,
          reportPath,
        },
        null,
        2,
      ),
    );
  } else {
    printHuman(coverage, reportPath);
  }

  if (coverage.some((item) => !item.covered)) {
    process.exitCode = 1;
  }
}

main();
