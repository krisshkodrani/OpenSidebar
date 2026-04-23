#!/usr/bin/env tsx

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  ARENA_TASKS,
  getArenaTags,
  type ArenaTask,
  type ArenaTier,
} from "../apps/extension/tests/e2e/arena/tasks";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const REPORTS_DIR = resolve(PROJECT_ROOT, ".artifacts", "e2e");
const E2E_DIR = resolve(PROJECT_ROOT, "apps", "extension", "tests", "e2e");

const TIER_ORDER: readonly ArenaTier[] = ["easy", "medium", "hard"];
const INTERNAL_TOOL_PATTERNS: readonly RegExp[] = [
  /\bclick_element\b/i,
  /\bread_page\b/i,
  /\btype_text\b/i,
  /\bcreate_tab\b/i,
  /\bswitch_tab\b/i,
  /\bclose_tab\b/i,
  /\bgo_back\b/i,
  /\bdone\(\)/i,
];

function compact(value: string, maxLength = 88): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  return values.reduce(
    (acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    },
    {} as Record<T, number>,
  );
}

function tasksForTier(tier: ArenaTier): ArenaTask[] {
  return ARENA_TASKS.filter((task) => task.tier === tier);
}

function validateTasks(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const task of ARENA_TASKS) {
    if (ids.has(task.id)) {
      errors.push(`Duplicate task id: ${task.id}`);
    }
    ids.add(task.id);

    const sourcePath = resolve(E2E_DIR, task.sourceFile);
    if (!existsSync(sourcePath)) {
      errors.push(`Missing source file for ${task.id}: ${task.sourceFile}`);
    }

    for (const pattern of INTERNAL_TOOL_PATTERNS) {
      if (pattern.test(task.prompt)) {
        errors.push(
          `Prompt for ${task.id} mentions internal tool pattern ${pattern}`,
        );
      }
    }
  }

  return errors;
}

function printList(): void {
  console.log("\n[e2e:arena] Task registry:");
  for (const tier of TIER_ORDER) {
    const tasks = tasksForTier(tier);
    console.log(`\n[e2e:arena] ${tier.toUpperCase()} (${tasks.length} tasks)`);
    for (const task of tasks) {
      console.log(`[e2e:arena]   - ${task.id}`);
      console.log(`[e2e:arena]     ${compact(task.prompt)}`);
    }
  }

  const tierCounts = countBy(ARENA_TASKS.map((task) => task.tier));
  console.log("");
  console.log(
    `[e2e:arena] Total: ${ARENA_TASKS.length} tasks; easy=${tierCounts.easy ?? 0}; medium=${tierCounts.medium ?? 0}; hard=${tierCounts.hard ?? 0}`,
  );
  console.log(`[e2e:arena] Tags: ${getArenaTags().join(", ")}`);
}

function markdownTable(tasks: readonly ArenaTask[]): string[] {
  const lines = [
    "| Task | Tier | Source | Tags | Validator | Prompt |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const task of tasks) {
    lines.push(
      `| \`${task.id}\` | ${task.tier} | \`${task.sourceFile}\` | ${task.tags.join(", ")} | \`${task.validator}\` | ${task.prompt} |`,
    );
  }

  return lines;
}

function buildReport(now = new Date()): string {
  const date = now.toISOString().split("T")[0];
  const tierCounts = countBy(ARENA_TASKS.map((task) => task.tier));
  const validatorKinds = countBy(ARENA_TASKS.map((task) => task.validatorKind));

  const lines: string[] = [];
  lines.push("# OpenSidebar Arena Task Registry");
  lines.push("");
  lines.push(`Date: ${date}`);
  lines.push(
    `Scope: ${ARENA_TASKS.length} benchmark-candidate E2E tasks with goal-oriented prompts.`,
  );
  lines.push(
    `Tier mix: easy ${tierCounts.easy ?? 0}, medium ${tierCounts.medium ?? 0}, hard ${tierCounts.hard ?? 0}.`,
  );
  lines.push("");
  lines.push("## Evaluation Policy");
  lines.push("");
  lines.push(
    "- Task success means the user objective is met through visible state, fixture state, or final answer correctness.",
  );
  lines.push(
    "- Trace data is diagnostic unless the task explicitly measures planner/runtime behavior.",
  );
  lines.push(
    "- Prompts should stay natural and should not name internal tools or prescribe a tool path.",
  );
  lines.push(
    "- Product behavior belongs in runtime policy, controllers, bridge code, or skills, not in this registry.",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | ---: |");
  lines.push(`| Tasks | ${ARENA_TASKS.length} |`);
  lines.push(`| Easy | ${tierCounts.easy ?? 0} |`);
  lines.push(`| Medium | ${tierCounts.medium ?? 0} |`);
  lines.push(`| Hard | ${tierCounts.hard ?? 0} |`);
  lines.push(`| Fixture-state validators | ${validatorKinds["fixture-state"] ?? 0} |`);
  lines.push(`| Final-answer validators | ${validatorKinds["final-answer"] ?? 0} |`);
  lines.push(`| DOM-state validators | ${validatorKinds["dom-state"] ?? 0} |`);
  lines.push(
    `| Trace-diagnostic validators | ${validatorKinds["trace-diagnostic"] ?? 0} |`,
  );
  lines.push("");
  lines.push("## Tasks");
  lines.push("");
  lines.push(...markdownTable(ARENA_TASKS));
  lines.push("");
  lines.push("## Task Details");
  lines.push("");

  for (const task of ARENA_TASKS) {
    lines.push(`### ${task.id}`);
    lines.push("");
    lines.push(`Title: ${task.title}`);
    lines.push(`Tier: ${task.tier}`);
    lines.push(`Source: \`${task.sourceFile}\` / ${task.sourceCase}`);
    lines.push(`Start route: \`${task.startRoute}\``);
    lines.push(`Max turns: ${task.maxTurns}`);
    lines.push(`Tags: ${task.tags.join(", ")}`);
    lines.push(`Validator: \`${task.validator}\` (${task.validatorKind})`);
    lines.push("");
    lines.push(`Prompt: ${task.prompt}`);
    lines.push("");
    lines.push(task.description);
    if (task.notes) {
      lines.push("");
      lines.push(`Notes: ${task.notes}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function writeReport(): string {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const today = new Date().toISOString().split("T")[0];
  const reportPath = resolve(REPORTS_DIR, `arena-task-registry-${today}.md`);
  writeFileSync(reportPath, buildReport(), "utf-8");
  return reportPath;
}

function main(): void {
  const args = process.argv.slice(2);
  const shouldReport = args.includes("--report");
  const validationErrors = validateTasks();

  printList();

  if (validationErrors.length > 0) {
    console.error("\n[e2e:arena] Registry validation failed:");
    for (const error of validationErrors) {
      console.error(`[e2e:arena]   - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\n[e2e:arena] Registry validation passed.");

  if (shouldReport) {
    const reportPath = writeReport();
    console.log(`\n[e2e:arena] Written to ${reportPath}`);
  }
}

main();
