#!/usr/bin/env tsx

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  ARENA_TASKS,
  getArenaTask,
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
  success: boolean;
  reason: string;
  durationMs: number;
  turns: number;
  perceptions: number;
  traces: number;
  validator: string;
  prompt: string;
  details: string[];
};

function parseArgs(): {
  taskIds: string[];
  tiers: ArenaTier[];
  runAll: boolean;
  build: boolean;
  listOnly: boolean;
} {
  const args = process.argv.slice(2);
  const tiers: ArenaTier[] = [];
  const taskIds: string[] = [];

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
    if (arg.startsWith("--")) continue;
    taskIds.push(arg);
  }

  return {
    taskIds,
    tiers,
    runAll: args.includes("--all"),
    build: !args.includes("--no-build"),
    listOnly: args.includes("--list"),
  };
}

function resolveTasks(
  taskIds: string[],
  tiers: ArenaTier[],
  runAll: boolean,
): ArenaTask[] {
  if (runAll) return [...ARENA_TASKS];
  if (taskIds.length > 0) {
    return taskIds.map((taskId) => {
      const task = getArenaTask(taskId);
      if (!task) {
        throw new Error(`Unknown arena task id: ${taskId}`);
      }
      return task;
    });
  }
  if (tiers.length > 0) {
    return tiers.flatMap((tier) => getArenaTasksByTier(tier));
  }
  return [];
}

function printList(): void {
  console.log("\n[e2e:arena:run] Available tasks:");
  for (const task of ARENA_TASKS) {
    console.log(
      `[e2e:arena:run]   - ${task.id} (${task.tier}) -> ${task.validator}`,
    );
  }
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

function buildReport(records: ArenaRunRecord[], now = new Date()): string {
  const date = now.toISOString().split("T")[0];
  const passed = records.filter((record) => record.success).length;
  const lines: string[] = [];

  lines.push("# OpenSidebar Arena Score");
  lines.push("");
  lines.push(`Date: ${date}`);
  lines.push(`Scope: ${records.length} arena task(s)`);
  lines.push(`Overall result: ${passed}/${records.length} passed`);
  lines.push("");
  lines.push(
    "| Task | Success | Tier | Turns | Perceptions | Traces | Duration | Validator | Reason | Prompt |",
  );
  lines.push(
    "| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |",
  );

  for (const record of records) {
    lines.push(
      `| \`${record.task.id}\` | ${record.success ? "Yes" : "No"} | ${record.task.tier} | ${record.turns} | ${record.perceptions} | ${record.traces} | ${formatDuration(record.durationMs)} | \`${record.validator}\` | ${record.reason} | ${compactPrompt(record.prompt)} |`,
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

function writeReport(records: ArenaRunRecord[]): string {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const today = new Date().toISOString().split("T")[0];
  const reportPath = resolve(REPORTS_DIR, `arena-score-${today}.md`);
  writeFileSync(reportPath, buildReport(records), "utf-8");
  return reportPath;
}

async function runTask(task: ArenaTask): Promise<ArenaRunRecord> {
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
      throw new Error("OPENROUTER_API_KEY is missing");
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
      success: validatorResult.ok,
      reason: validatorResult.reason,
      durationMs: Date.now() - start,
      turns: validatorResult.traceTurns.length,
      perceptions: countPerceptionTurns(validatorResult.traceFiles),
      traces: validatorResult.traceFiles.length,
      validator: task.validator,
      prompt: task.prompt,
      details: validatorResult.details,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? `runner_error:${error.message}` : "runner_error";
    return {
      task,
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
    };
  } finally {
    if (beforeAllComplete) {
      await resetExtensionState(harness.ctx).catch(() => {});
      await harness.afterAllHook().catch(() => {});
    }
  }
}

async function main(): Promise<void> {
  const { taskIds, tiers, runAll, build, listOnly } = parseArgs();

  if (listOnly) {
    printList();
    return;
  }

  const tasks = resolveTasks(taskIds, tiers, runAll);
  if (tasks.length === 0) {
    printList();
    console.log(
      "\n[e2e:arena:run] Pass one or more task ids, `--tier <tier>`, or `--all`.",
    );
    return;
  }

  if (build) {
    console.log("\n[e2e:arena:run] Building extension before arena run...");
    execSync("cmd /c npm run build", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
  }

  const records: ArenaRunRecord[] = [];
  for (const task of tasks) {
    console.log(`\n[e2e:arena:run] Running ${task.id}...`);
    const record = await runTask(task);
    records.push(record);
    console.log(
      `[e2e:arena:run] ${task.id}: ${record.success ? "PASS" : "FAIL"} (${record.reason})`,
    );
  }

  const reportPath = writeReport(records);
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
