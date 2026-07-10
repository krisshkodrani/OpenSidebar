#!/usr/bin/env tsx

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  ARENA_TASKS,
  getArenaTask,
  getArenaTasksByTag,
  getArenaTasksByTier,
  type ArenaTask,
  type ArenaTier,
} from "../apps/extension/tests/e2e/arena/tasks";
import {
  getArenaValidator,
  type ArenaValidatorResult,
} from "../apps/extension/tests/e2e/arena/validators";
import { createE2EHarness } from "../apps/extension/tests/e2e/helpers/harness";
import { getFixtureUrl } from "../apps/extension/tests/e2e/helpers/fixture-server";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  resetExtensionState,
  sendUserChat,
  updateUserSettings,
} from "../apps/extension/tests/e2e/helpers/utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");
const REPORTS_DIR = resolve(PROJECT_ROOT, ".artifacts", "e2e");

type ArenaRunRecord = {
  task: ArenaTask;
  attempt: number;
  totalAttempts: number;
  success: boolean;
  reason: string;
  durationMs: number;
  turns: number;
  perceptions: number;
  traces: number;
  validator: string;
  prompt: string;
  details: string[];
  /** LP-11 vision economics, derived from workspace trace files. */
  screenshotTransforms: number;
  imageAttachments: number;
  inspectRegionCalls: number;
};

function parseArgs(): {
  taskIds: string[];
  tiers: ArenaTier[];
  tags: string[];
  repeat: number;
  runAll: boolean;
  build: boolean;
  listOnly: boolean;
  reportLabel: string | undefined;
} {
  const args = process.argv.slice(2);
  const tiers: ArenaTier[] = [];
  const tags: string[] = [];
  const taskIds: string[] = [];
  let repeat = 1;
  let reportLabel: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--tier") {
      const value = args[index + 1] as ArenaTier | undefined;
      if (value === "easy" || value === "medium" || value === "hard") {
        tiers.push(value);
        index++;
      }
      continue;
    }
    if (arg === "--tag") {
      const value = args[index + 1];
      if (value && !value.startsWith("--")) {
        tags.push(value);
        index++;
      }
      continue;
    }
    if (arg === "--repeat") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        repeat = value;
        index++;
      }
      continue;
    }
    if (arg === "--report-label") {
      const value = args[index + 1];
      if (value && !value.startsWith("--")) {
        reportLabel = value.replace(/[^a-z0-9_-]/gi, "-");
        index++;
      }
      continue;
    }
    if (arg.startsWith("--")) continue;
    taskIds.push(arg);
  }

  return {
    taskIds,
    tiers,
    tags,
    repeat,
    runAll: args.includes("--all"),
    build: !args.includes("--no-build"),
    listOnly: args.includes("--list"),
    reportLabel,
  };
}

function resolveTasks(
  taskIds: string[],
  tiers: ArenaTier[],
  tags: string[],
  runAll: boolean,
): ArenaTask[] {
  const selected = new Map<string, ArenaTask>();
  const addTask = (task: ArenaTask) => selected.set(task.id, task);

  if (runAll) {
    for (const task of ARENA_TASKS) addTask(task);
  }
  if (taskIds.length > 0) {
    for (const taskId of taskIds) {
      const task = getArenaTask(taskId);
      if (!task) {
        throw new Error(`Unknown arena task id: ${taskId}`);
      }
      addTask(task);
    }
  }
  if (tiers.length > 0) {
    for (const tier of tiers) {
      for (const task of getArenaTasksByTier(tier)) addTask(task);
    }
  }
  if (tags.length > 0) {
    for (const tag of tags) {
      const taggedTasks = getArenaTasksByTag(tag);
      if (taggedTasks.length === 0) {
        throw new Error(`Unknown arena tag or no tasks for tag: ${tag}`);
      }
      for (const task of taggedTasks) addTask(task);
    }
  }
  return [...selected.values()];
}

function printList(tasks: readonly ArenaTask[] = ARENA_TASKS): void {
  console.log("\n[e2e:arena:run] Available tasks:");
  for (const task of tasks) {
    console.log(
      `[e2e:arena:run]   - ${task.id} (${task.tier}) -> ${task.validator}`,
    );
  }
}

function countTraceOccurrences(traceFiles: string[], needle: string): number {
  let count = 0;
  for (const filePath of traceFiles) {
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf-8");
    let index = content.indexOf(needle);
    while (index !== -1) {
      count++;
      index = content.indexOf(needle, index + needle.length);
    }
  }
  return count;
}

function countPerceptionTurns(traceFiles: string[]): number {
  let turns = 0;

  for (const filePath of traceFiles) {
    if (!existsSync(filePath)) continue;
    const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as {
          llmRequest?: { messages?: Array<{ content?: string }> };
        };
        const messages = entry.llmRequest?.messages ?? [];
        if (
          messages.some(
            (message) =>
              typeof message.content === "string" &&
              message.content.includes("Page Interpretation"),
          )
        ) {
          turns++;
        }
      } catch {
        // Ignore malformed trace lines and keep scanning.
      }
    }
  }

  return turns;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 60_000) return `${Math.round(durationMs / 1000)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function compactPrompt(prompt: string, maxLength = 120): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function summarizeByTask(records: readonly ArenaRunRecord[]): Array<{
  task: ArenaTask;
  attempts: number;
  passed: number;
  passRate: number;
  passVariance: number;
  avgTurns: number;
  minTurns: number;
  maxTurns: number;
  avgDurationMs: number;
  reasons: string;
}> {
  const groups = new Map<string, ArenaRunRecord[]>();
  for (const record of records) {
    groups.set(record.task.id, [...(groups.get(record.task.id) ?? []), record]);
  }

  return [...groups.values()].map((group) => {
    const passed = group.filter((record) => record.success).length;
    const passRate = passed / group.length;
    const turns = group.map((record) => record.turns);
    const reasons = [...new Set(group.map((record) => record.reason))].join(", ");
    return {
      task: group[0].task,
      attempts: group.length,
      passed,
      passRate,
      passVariance: passRate * (1 - passRate),
      avgTurns: average(turns),
      minTurns: Math.min(...turns),
      maxTurns: Math.max(...turns),
      avgDurationMs: average(group.map((record) => record.durationMs)),
      reasons,
    };
  });
}

function buildReport(
  records: ArenaRunRecord[],
  runConfig?: { model?: string; plannerModel?: string },
  now = new Date(),
): string {
  const date = now.toISOString().split("T")[0];
  const passed = records.filter((record) => record.success).length;
  const taskCount = new Set(records.map((record) => record.task.id)).size;
  const summaries = summarizeByTask(records);
  const lines: string[] = [];

  lines.push("# OpenSidebar Arena Score");
  lines.push("");
  lines.push(`Date: ${date}`);
  lines.push(
    `Scope: ${taskCount} arena task(s), ${records.length} total attempt(s)`,
  );
  lines.push(`Overall result: ${passed}/${records.length} attempts passed`);
  if (runConfig?.model) lines.push(`Executor model: \`${runConfig.model}\``);
  if (runConfig?.plannerModel) {
    lines.push(`Planner model: \`${runConfig.plannerModel}\``);
  }
  lines.push("");
  lines.push("## Pass-Rate Summary");
  lines.push("");
  lines.push(
    "| Task | Attempts | Pass Rate | Pass Variance | Avg Turns | Turn Range | Avg Duration | Reasons |",
  );
  lines.push(
    "| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |",
  );

  for (const summary of summaries) {
    lines.push(
      `| \`${summary.task.id}\` | ${summary.attempts} | ${summary.passed}/${summary.attempts} (${formatPercent(summary.passRate)}) | ${summary.passVariance.toFixed(2)} | ${formatNumber(summary.avgTurns)} | ${summary.minTurns}-${summary.maxTurns} | ${formatDuration(summary.avgDurationMs)} | ${summary.reasons} |`,
    );
  }

  lines.push("");
  lines.push("## Attempts");
  lines.push("");
  lines.push(
    "| Task | Attempt | Success | Tier | Turns | Perceptions | Images | Zooms | Traces | Duration | Validator | Reason | Prompt |",
  );
  lines.push(
    "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
  );

  for (const record of records) {
    lines.push(
      `| \`${record.task.id}\` | ${record.attempt}/${record.totalAttempts} | ${record.success ? "Yes" : "No"} | ${record.task.tier} | ${record.turns} | ${record.perceptions} | ${record.imageAttachments} | ${record.inspectRegionCalls} | ${record.traces} | ${formatDuration(record.durationMs)} | \`${record.validator}\` | ${record.reason} | ${compactPrompt(record.prompt)} |`,
    );
  }

  lines.push("");
  lines.push("## Notes");
  lines.push("");

  for (const record of records) {
    lines.push(`### ${record.task.id}`);
    lines.push("");
    lines.push(`- Success: ${record.success ? "Yes" : "No"}`);
    lines.push(`- Reason: ${record.reason}`);
    lines.push(`- Validator: \`${record.validator}\``);
    if (record.details.length > 0) {
      for (const detail of record.details) {
        lines.push(`- ${detail}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function writeReport(
  records: ArenaRunRecord[],
  options: {
    reportLabel?: string;
    model?: string;
    plannerModel?: string;
  } = {},
): string {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const today = new Date().toISOString().split("T")[0];
  const suffix = options.reportLabel ? `-${options.reportLabel}` : "";
  const reportPath = resolve(REPORTS_DIR, `arena-score-${today}${suffix}.md`);
  writeFileSync(
    reportPath,
    buildReport(records, {
      model: options.model,
      plannerModel: options.plannerModel,
    }),
    "utf-8",
  );
  // Machine-readable twin for cross-run comparison.
  const jsonPath = resolve(REPORTS_DIR, `arena-score-${today}${suffix}.json`);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        date: today,
        model: options.model ?? null,
        plannerModel: options.plannerModel ?? null,
        records: records.map((record) => ({
          taskId: record.task.id,
          tier: record.task.tier,
          attempt: record.attempt,
          success: record.success,
          reason: record.reason,
          durationMs: record.durationMs,
          turns: record.turns,
          perceptions: record.perceptions,
          imageAttachments: record.imageAttachments,
          inspectRegionCalls: record.inspectRegionCalls,
          screenshotTransforms: record.screenshotTransforms,
        })),
      },
      null,
      2,
    ),
    "utf-8",
  );
  return reportPath;
}

async function runTask(
  task: ArenaTask,
  attempt: number,
  totalAttempts: number,
): Promise<ArenaRunRecord> {
  const harness = createE2EHarness({
    maxTurns: task.maxTurns,
    testLabel: `arena-${task.id}`,
  });
  const start = Date.now();
  let validatorResult: ArenaValidatorResult | null = null;
  let beforeAllComplete = false;

  try {
    await harness.beforeAllHook();
    beforeAllComplete = true;
    await harness.beforeEachHook();

    if (!harness.apiKey) {
      throw new Error(`API key for E2E provider '${harness.providerMode}' is missing`);
    }

    if (task.allowNavigation) {
      await updateUserSettings(harness.ctx, { allowNavigation: true });
    }

    await navigateAndWait(harness.page, getFixtureUrl(task.startRoute));
    await harness.page.bringToFront();
    const tabId = await getActiveTabId(harness.ctx.serviceWorker);
    if (tabId <= 0) {
      throw new Error(`Failed to get an active tab for ${task.id}`);
    }

    const workspaceId = await sendUserChat(harness.ctx, task.prompt, tabId);
    const validator = getArenaValidator(task.validator);
    if (!validator) {
      throw new Error(`Missing arena validator: ${task.validator}`);
    }

    validatorResult = await validator({
      task,
      harness,
      workspaceId,
    });

    if (validatorResult.ok) {
      await assertNoGhostSession(harness.ctx.serviceWorker, 2_000, workspaceId);
    }

    return {
      task,
      attempt,
      totalAttempts,
      success: validatorResult.ok,
      reason: validatorResult.reason,
      durationMs: Date.now() - start,
      turns: validatorResult.traceTurns.length,
      perceptions: countPerceptionTurns(validatorResult.traceFiles),
      traces: validatorResult.traceFiles.length,
      validator: task.validator,
      prompt: task.prompt,
      details: validatorResult.details,
      screenshotTransforms: countTraceOccurrences(
        validatorResult.traceFiles,
        '"type":"screenshot_transform"',
      ),
      imageAttachments: countTraceOccurrences(
        validatorResult.traceFiles,
        "[image]",
      ),
      inspectRegionCalls: countTraceOccurrences(
        validatorResult.traceFiles,
        '"type":"inspect_region"',
      ),
    };
  } catch (error) {
    const reason =
      error instanceof Error ? `runner_error:${error.message}` : "runner_error";
    return {
      task,
      attempt,
      totalAttempts,
      success: false,
      reason,
      durationMs: Date.now() - start,
      turns: validatorResult?.traceTurns.length ?? 0,
      perceptions: validatorResult
        ? countPerceptionTurns(validatorResult.traceFiles)
        : 0,
      traces: validatorResult?.traceFiles.length ?? 0,
      validator: task.validator,
      prompt: task.prompt,
      details: validatorResult?.details ?? [],
      screenshotTransforms: validatorResult
        ? countTraceOccurrences(
            validatorResult.traceFiles,
            '"type":"screenshot_transform"',
          )
        : 0,
      imageAttachments: validatorResult
        ? countTraceOccurrences(validatorResult.traceFiles, "[image]")
        : 0,
      inspectRegionCalls: validatorResult
        ? countTraceOccurrences(
            validatorResult.traceFiles,
            '"type":"inspect_region"',
          )
        : 0,
    };
  } finally {
    if (beforeAllComplete) {
      await resetExtensionState(harness.ctx).catch(() => {});
      await harness.afterAllHook().catch(() => {});
    }
  }
}

async function main(): Promise<void> {
  const { taskIds, tiers, tags, repeat, runAll, build, listOnly, reportLabel } =
    parseArgs();
  const tasks = resolveTasks(taskIds, tiers, tags, runAll);

  if (listOnly) {
    printList(tasks.length > 0 ? tasks : ARENA_TASKS);
    return;
  }

  if (tasks.length === 0) {
    printList();
    console.log(
      "\n[e2e:arena:run] Pass one or more task ids, `--tier <tier>`, `--tag <tag>`, or `--all`.",
    );
    return;
  }

  if (build) {
    console.log("\n[e2e:arena:run] Building e2e extension before arena run...");
    execSync("corepack pnpm run build:e2e", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    console.log("\n[e2e:arena:run] Building E2E fixtures before arena run...");
    execSync("corepack pnpm run fixtures:build", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
  }

  // Heartbeat guard: arena must drive the dev-surface build too.
  execSync("node scripts/check-dist-dev.js", {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    windowsHide: true,
  });

  const records: ArenaRunRecord[] = [];
  for (let attempt = 1; attempt <= repeat; attempt++) {
    for (const task of tasks) {
      console.log(
        `\n[e2e:arena:run] Running ${task.id} (${attempt}/${repeat})...`,
      );
      let record = await runTask(task, attempt, repeat);
      if (
        !record.success &&
        record.reason.startsWith("runner_error") &&
        record.traces === 0
      ) {
        // Infra failure before the agent produced any trace — the attempt says
        // nothing about the agent, so it gets one replacement run.
        console.log(
          `[e2e:arena:run] ${task.id} (${attempt}/${repeat}): infra failure with no agent traces — retrying once. Discarded reason: ${record.reason}`,
        );
        record = await runTask(task, attempt, repeat);
      }
      records.push(record);
      console.log(
        `[e2e:arena:run] ${task.id} (${attempt}/${repeat}): ${record.success ? "PASS" : "FAIL"} (${record.reason})`,
      );
    }
  }

  const reportPath = writeReport(records, {
    reportLabel,
    model: process.env.E2E_MODEL,
    plannerModel: process.env.E2E_PLANNER_MODEL,
  });
  const passed = records.filter((record) => record.success).length;
  console.log(
    `\n[e2e:arena:run] Complete: ${passed}/${records.length} passed. Report: ${reportPath}`,
  );

  if (passed !== records.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[e2e:arena:run] Fatal error:", error);
  process.exit(1);
});
