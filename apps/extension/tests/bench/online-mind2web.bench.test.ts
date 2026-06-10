/**
 * Headed benchmark runner (RFC LP-1, Stage 1).
 *
 * Drives each Online-Mind2Web task through the real extension on the existing
 * E2E headed-Chrome harness, records run evidence (final answer, trajectory,
 * trace receipts), and writes one evidence JSON per task. Scoring (WebJudge)
 * and aggregation happen in a separate pass (scripts/run-bench.ts) so expensive
 * browser runs and judging are decoupled — you can re-judge without re-running.
 *
 * This file is harness-only: no product logic, no per-task branching. It is
 * excluded from `pnpm test` (it needs headed Chrome + a provider key + live
 * web) and runs only via `pnpm run bench` / vitest.bench.config.ts.
 *
 * Configuration (env, set by scripts/run-bench.ts):
 *   BENCH_TASKS_FILE   absolute path to a BenchTaskFile JSON (default: sample)
 *   BENCH_RUN_DIR      output dir for per-task evidence (default: .artifacts/bench/adhoc)
 *   BENCH_SIZE         stratified subset size (default: all)
 *   BENCH_LEVELS       comma list of easy,medium,hard (default: all)
 *   BENCH_SEED         subset seed (default: 0)
 *   BENCH_MAX_TURNS    per-task max turns (default: 25)
 *   BENCH_TASK_TIMEOUT_MS  per-task wall-clock budget (default: 300000)
 *   BENCH_ALLOW_WRITES if "1", do not skip write-mutating tasks (sandboxes only)
 */

import { describe, it, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";
import { fileURLToPath } from "url";
import { createE2EHarness } from "../e2e/helpers/harness";
import {
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  updateUserSettings,
  waitForTaskCompletion,
} from "../e2e/helpers/utils";
import { extractDoneSummary, readTrace } from "../e2e/helpers/diagnostics";
import { loadTaskFile, selectStratifiedSubset } from "../../../../scripts/bench/loader";
import { buildSafetyProfile } from "../../../../scripts/bench/safety-profile";
import type {
  BenchDifficulty,
  BenchRunEvidence,
  BenchTask,
} from "../../../../scripts/bench/types";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../../..");

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

const TASKS_FILE =
  process.env.BENCH_TASKS_FILE ??
  resolve(PROJECT_ROOT, "scripts/bench/tasks/sample.json");
const RUN_DIR =
  process.env.BENCH_RUN_DIR ?? resolve(PROJECT_ROOT, ".artifacts/bench/adhoc");
const TASKS_OUT_DIR = join(RUN_DIR, "tasks");
const MAX_TURNS = envInt("BENCH_MAX_TURNS", 25);
const TASK_TIMEOUT_MS = envInt("BENCH_TASK_TIMEOUT_MS", 300_000);
const ALLOW_WRITES = process.env.BENCH_ALLOW_WRITES === "1";

function resolveSubset(): BenchTask[] {
  const file = loadTaskFile(TASKS_FILE);
  const levels = (process.env.BENCH_LEVELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is BenchDifficulty =>
      ["easy", "medium", "hard"].includes(s),
    );
  return selectStratifiedSubset(file.tasks, {
    size: process.env.BENCH_SIZE ? envInt("BENCH_SIZE", 0) : undefined,
    levels: levels.length > 0 ? levels : undefined,
    seed: envInt("BENCH_SEED", 0),
  });
}

const tasks = resolveSubset();
const h = createE2EHarness({ maxTurns: MAX_TURNS, testLabel: "bench-om2w" });

function buildTrajectory(traceFiles: string[]): string[] {
  const lines: string[] = [];
  for (const file of traceFiles) {
    for (const turn of readTrace(file)) {
      const url = turn.url ? ` @ ${turn.url}` : "";
      if (turn.toolCalls.length > 0) {
        for (const call of turn.toolCalls) {
          const args = Object.entries(call.args)
            .filter(([, v]) => typeof v === "string" || typeof v === "number")
            .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
            .join(", ");
          lines.push(`T${turn.turnNumber} ${call.name}(${args})${url}`);
        }
      } else if (turn.llmContent) {
        lines.push(`T${turn.turnNumber} say "${turn.llmContent.slice(0, 80)}"${url}`);
      }
    }
  }
  return lines;
}

function extractCostUsd(events: unknown[]): number | null {
  let cost: number | null = null;
  for (const event of events as Array<Record<string, unknown>>) {
    const payload = event?.payload as Record<string, unknown> | undefined;
    const candidate =
      (payload?.cost as number | undefined) ??
      (payload?.totalCost as number | undefined) ??
      ((payload?.metrics as Record<string, unknown> | undefined)?.totalCost as
        | number
        | undefined);
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      cost = candidate;
    }
  }
  return cost;
}

function writeEvidence(evidence: BenchRunEvidence): void {
  mkdirSync(TASKS_OUT_DIR, { recursive: true });
  const safeId = evidence.task.task_id.replace(/[^a-zA-Z0-9._-]+/g, "_");
  writeFileSync(
    join(TASKS_OUT_DIR, `${safeId}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf-8",
  );
}

function copyTraceReceipts(traceFiles: string[], taskId: string): string[] {
  const safeId = taskId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const receiptDir = join(RUN_DIR, "receipts", safeId);
  mkdirSync(receiptDir, { recursive: true });
  const copied: string[] = [];
  for (const file of traceFiles) {
    if (!existsSync(file)) continue;
    const dest = join(receiptDir, basename(file));
    try {
      copyFileSync(file, dest);
      copied.push(join("receipts", safeId, basename(file)));
    } catch {
      // best-effort receipt copy
    }
  }
  return copied;
}

describe.skipIf(!h.apiKey || tasks.length === 0)(
  `bench: Online-Mind2Web (${tasks.length} tasks)`,
  () => {
    beforeAll(async () => {
      mkdirSync(TASKS_OUT_DIR, { recursive: true });
      await h.beforeAllHook();
      // Live-web benchmark needs navigation enabled (harness defaults it off).
      await updateUserSettings(h.ctx, { allowNavigation: true });
    }, 120_000);
    beforeEach(() => h.beforeEachHook());
    afterEach(() => h.afterEachHook("bench-om2w"));
    afterAll(() => h.afterAllHook());

    for (const task of tasks) {
      const profile = buildSafetyProfile(task, {
        skipWriteMutations: !ALLOW_WRITES,
      });

      it(
        `${task.task_id} [${task.level}]`,
        async () => {
          if (profile.skip) {
            writeEvidence({
              task,
              completionStatus: "skipped",
              doneSummary: "",
              trajectory: [],
              finalUrl: task.website,
              turns: 0,
              costUsd: null,
              durationMs: 0,
              traceFiles: [],
              skipReason: profile.skipReason,
            });
            console.log(`[bench] SKIP ${task.task_id}: ${profile.skipReason}`);
            return;
          }

          const startedAt = Date.now();
          await navigateAndWait(h.page, task.website, { timeoutMs: 60_000 });
          await h.page.bringToFront();
          const tabId = await getActiveTabId(h.ctx.serviceWorker);

          const workspaceId = await sendUserChat(
            h.ctx,
            task.confirmed_task,
            tabId,
          );
          const outcome = await waitForTaskCompletion(
            h.ctx,
            TASK_TIMEOUT_MS,
            workspaceId,
          );
          const { traceFiles } = await h.printTraceSummary(workspaceId);

          const status: BenchRunEvidence["completionStatus"] = outcome.ok
            ? "completed"
            : outcome.reason.startsWith("task_partial")
              ? "partial"
              : outcome.reason.startsWith("task_stopped")
                ? "stopped"
                : "failed";

          const trajectory = buildTrajectory(traceFiles);
          const evidence: BenchRunEvidence = {
            task,
            completionStatus: status,
            doneSummary: extractDoneSummary(traceFiles),
            trajectory,
            finalUrl: h.page.url(),
            turns: trajectory.length,
            costUsd: extractCostUsd(outcome.events),
            durationMs: Date.now() - startedAt,
            traceFiles: copyTraceReceipts(traceFiles, task.task_id),
          };
          writeEvidence(evidence);
          console.log(
            `[bench] ${task.task_id}: ${status} (${evidence.turns} turns)`,
          );
        },
        TASK_TIMEOUT_MS + 120_000,
      );
    }
  },
);

// Record the resolved subset + pin so the scorer can aggregate even if a task
// crashes before writing its own evidence.
if (tasks.length > 0) {
  mkdirSync(RUN_DIR, { recursive: true });
  const file = loadTaskFile(TASKS_FILE);
  writeFileSync(
    join(RUN_DIR, "manifest.json"),
    `${JSON.stringify(
      {
        source: file.source,
        revision: file.revision,
        license: file.license,
        tasksFile: TASKS_FILE,
        taskIds: tasks.map((t) => t.task_id),
        maxTurns: MAX_TURNS,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}
