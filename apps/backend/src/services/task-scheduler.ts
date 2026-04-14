/**
 * Task Scheduler — manages the task queue lifecycle.
 *
 * - Stores tasks in SQLite
 * - Computes next run times from cron expressions
 * - Tick loop checks for due tasks every N seconds
 */

import { randomUUID } from "crypto";
import { CronExpressionParser } from "cron-parser";
import { getDatabase } from "../db.js";
import type { TaskInput, ScheduledTask, TaskPatch, TaskStatus } from "../types.js";

let tickTimer: ReturnType<typeof setInterval> | null = null;

// ── Row mapping (SQLite snake_case → TypeScript camelCase) ──

interface TaskRow {
  id: string;
  description: string;
  query: string;
  tab_url: string | null;
  workspace_id: string | null;
  schedule: string | null;
  run_at: number | null;
  status: TaskStatus;
  last_run_at: number | null;
  result: string | null;
  created_at: number;
  updated_at: number;
}

function rowToTask(row: TaskRow): ScheduledTask {
  return {
    id: row.id,
    description: row.description,
    query: row.query,
    tabUrl: row.tab_url,
    workspaceId: row.workspace_id,
    schedule: row.schedule,
    runAt: row.run_at,
    status: row.status,
    lastRunAt: row.last_run_at,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ──

export function createTask(input: TaskInput): ScheduledTask {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  let runAt: number | null = input.runAt ?? null;

  // If cron schedule provided and no explicit runAt, compute next occurrence
  if (input.schedule && !runAt) {
    runAt = computeNextRun(input.schedule);
  }

  const task: ScheduledTask = {
    id,
    description: input.description,
    query: input.query,
    tabUrl: input.tabUrl ?? null,
    workspaceId: input.workspaceId ?? null,
    schedule: input.schedule ?? null,
    runAt,
    status: "pending",
    lastRunAt: null,
    result: null,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO tasks (id, description, query, tab_url, workspace_id, schedule, run_at, status, last_run_at, result, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id,
    task.description,
    task.query,
    task.tabUrl,
    task.workspaceId,
    task.schedule,
    task.runAt,
    task.status,
    task.lastRunAt,
    task.result,
    task.createdAt,
    task.updatedAt,
  );

  return task;
}

export function listTasks(status?: TaskStatus, limit = 50): ScheduledTask[] {
  const db = getDatabase();

  if (status) {
    return (db
      .prepare("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?")
      .all(status, limit) as TaskRow[]).map(rowToTask);
  }

  return (db
    .prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?")
    .all(limit) as TaskRow[]).map(rowToTask);
}

export function getTask(id: string): ScheduledTask | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export function getPendingTasks(): ScheduledTask[] {
  const db = getDatabase();
  const now = Date.now();
  return (db
    .prepare("SELECT * FROM tasks WHERE status = 'pending' AND run_at <= ? ORDER BY run_at ASC")
    .all(now) as TaskRow[]).map(rowToTask);
}

export function updateTask(id: string, patch: TaskPatch): ScheduledTask | null {
  const db = getDatabase();
  const existing = getTask(id);
  if (!existing) return null;

  const now = Date.now();
  const newStatus = patch.status ?? existing.status;
  const newResult = patch.result ?? existing.result;

  // If completing a recurring task, recompute next run
  let newRunAt = existing.runAt;
  let resetStatus: TaskStatus = newStatus;
  if (newStatus === "completed" && existing.schedule) {
    newRunAt = computeNextRun(existing.schedule);
    resetStatus = "pending"; // recurring tasks go back to pending
  }

  db.prepare(`
    UPDATE tasks SET status = ?, result = ?, last_run_at = ?, run_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    resetStatus,
    newResult,
    (newStatus === "completed" || newStatus === "running") ? now : existing.lastRunAt,
    newRunAt,
    now,
    id,
  );

  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const db = getDatabase();
  const changes = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return changes.changes > 0;
}

// ── Tick loop ──

export function startTaskTick(intervalSeconds: number): void {
  if (tickTimer) return;

  console.log(`[scheduler] Starting tick loop (every ${intervalSeconds}s)`);

  tickTimer = setInterval(() => {
    // Just ensure pending tasks with past run_at are available for polling.
    // The extension polls /tasks/pending — we don't need to push.
    const due = getPendingTasks();
    if (due.length > 0) {
      console.log(`[scheduler] ${due.length} task(s) ready for pickup`);
    }
  }, intervalSeconds * 1000);

  tickTimer.unref(); // Don't keep the process alive just for the tick
}

export function stopTaskTick(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

// ── Cron helper ──

function computeNextRun(cronExpression: string): number {
  try {
    const expr = CronExpressionParser.parse(cronExpression);
    return expr.next().getTime();
  } catch (err) {
    console.warn(`[scheduler] Invalid cron expression "${cronExpression}":`, err);
    // Fallback: 24 hours from now
    return Date.now() + 24 * 60 * 60 * 1000;
  }
}
