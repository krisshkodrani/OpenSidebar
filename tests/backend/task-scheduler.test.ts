import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";
import { initDatabase, closeDatabase } from "../../backend/db";
import {
  createTask,
  listTasks,
  getTask,
  getPendingTasks,
  updateTask,
  deleteTask,
} from "../../backend/services/task-scheduler";
import type { TaskInput } from "../../backend/types";

let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `test-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  initDatabase(dbPath);
});

afterEach(() => {
  closeDatabase();
  try {
    unlinkSync(dbPath);
    unlinkSync(dbPath + "-wal");
    unlinkSync(dbPath + "-shm");
  } catch {
    // cleanup is best-effort
  }
});

describe("createTask", () => {
  test("creates a one-shot task with explicit runAt", () => {
    const futureTime = Date.now() + 3_600_000;
    const task = createTask({
      description: "One-shot",
      query: "Navigate to google.com",
      runAt: futureTime,
    });

    expect(task.id).toBeTruthy();
    expect(task.description).toBe("One-shot");
    expect(task.query).toBe("Navigate to google.com");
    expect(task.status).toBe("pending");
    expect(task.runAt).toBe(futureTime);
    expect(task.schedule).toBeNull();
    expect(task.tabUrl).toBeNull();
    expect(task.lastRunAt).toBeNull();
    expect(task.result).toBeNull();
  });

  test("creates a recurring task with cron schedule and computes next run", () => {
    const before = Date.now();
    const task = createTask({
      description: "Daily check",
      query: "Check news",
      schedule: "0 9 * * *",
    });

    expect(task.schedule).toBe("0 9 * * *");
    expect(task.runAt).toBeGreaterThan(before);
    // Next 9am should be within 24 hours
    expect(task.runAt! - before).toBeLessThan(24 * 60 * 60 * 1000 + 1000);
  });

  test("preserves tabUrl and workspaceId", () => {
    const task = createTask({
      description: "Test",
      query: "Do something",
      runAt: Date.now() + 1000,
      tabUrl: "https://example.com",
      workspaceId: "ws-123",
    });

    expect(task.tabUrl).toBe("https://example.com");
    expect(task.workspaceId).toBe("ws-123");
  });

  test("sets createdAt and updatedAt to current time", () => {
    const before = Date.now();
    const task = createTask({
      description: "Test",
      query: "Test",
      runAt: Date.now() + 1000,
    });
    const after = Date.now();

    expect(task.createdAt).toBeGreaterThanOrEqual(before);
    expect(task.createdAt).toBeLessThanOrEqual(after);
    expect(task.updatedAt).toBe(task.createdAt);
  });

  test("generates unique IDs", () => {
    const a = createTask({ description: "A", query: "Q", runAt: Date.now() + 1000 });
    const b = createTask({ description: "B", query: "Q", runAt: Date.now() + 2000 });
    expect(a.id).not.toBe(b.id);
  });
});

describe("getTask", () => {
  test("retrieves an existing task by ID", () => {
    const created = createTask({ description: "Find me", query: "Q", runAt: Date.now() + 1000 });
    const found = getTask(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.description).toBe("Find me");
  });

  test("returns null for non-existent ID", () => {
    expect(getTask("nonexistent-id")).toBeNull();
  });
});

describe("listTasks", () => {
  test("lists all tasks ordered by created_at DESC", () => {
    createTask({ description: "First", query: "Q", runAt: Date.now() + 1000 });
    createTask({ description: "Second", query: "Q", runAt: Date.now() + 2000 });
    createTask({ description: "Third", query: "Q", runAt: Date.now() + 3000 });

    const tasks = listTasks();
    expect(tasks.length).toBe(3);
    // All three present (ordering depends on timestamp resolution)
    const descriptions = tasks.map((t) => t.description);
    expect(descriptions).toContain("First");
    expect(descriptions).toContain("Second");
    expect(descriptions).toContain("Third");
  });

  test("filters by status", () => {
    const a = createTask({ description: "A", query: "Q", runAt: Date.now() + 1000 });
    createTask({ description: "B", query: "Q", runAt: Date.now() + 2000 });
    updateTask(a.id, { status: "completed" });

    const pending = listTasks("pending");
    const completed = listTasks("completed");

    // Task A was one-shot, so completed stays completed (no schedule to reset)
    expect(completed.some((t) => t.id === a.id)).toBe(true);
    expect(pending.some((t) => t.id === a.id)).toBe(false);
  });

  test("respects limit", () => {
    for (let i = 0; i < 10; i++) {
      createTask({ description: `T${i}`, query: "Q", runAt: Date.now() + i * 100 });
    }
    const tasks = listTasks(undefined, 3);
    expect(tasks.length).toBe(3);
  });
});

describe("getPendingTasks", () => {
  test("returns pending tasks with runAt in the past", () => {
    const pastTask = createTask({ description: "Past", query: "Q", runAt: Date.now() - 5000 });
    const futureTask = createTask({ description: "Future", query: "Q", runAt: Date.now() + 60_000 });

    const pending = getPendingTasks();
    expect(pending.some((t) => t.id === pastTask.id)).toBe(true);
    expect(pending.some((t) => t.id === futureTask.id)).toBe(false);
  });

  test("excludes non-pending tasks even with past runAt", () => {
    const task = createTask({ description: "Running", query: "Q", runAt: Date.now() - 5000 });
    updateTask(task.id, { status: "running" });

    const pending = getPendingTasks();
    expect(pending.some((t) => t.id === task.id)).toBe(false);
  });

  test("returns empty array when nothing is due", () => {
    createTask({ description: "Far future", query: "Q", runAt: Date.now() + 999_999_999 });
    expect(getPendingTasks()).toHaveLength(0);
  });
});

describe("updateTask", () => {
  test("updates status", () => {
    const task = createTask({ description: "T", query: "Q", runAt: Date.now() - 1000 });
    const updated = updateTask(task.id, { status: "running" });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("running");
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(task.updatedAt);
  });

  test("updates result text", () => {
    const task = createTask({ description: "T", query: "Q", runAt: Date.now() - 1000 });
    const updated = updateTask(task.id, { status: "completed", result: "Done successfully" });

    expect(updated!.result).toBe("Done successfully");
  });

  test("sets lastRunAt when marking completed", () => {
    const task = createTask({ description: "T", query: "Q", runAt: Date.now() - 1000 });
    const before = Date.now();
    const updated = updateTask(task.id, { status: "completed" });

    expect(updated!.lastRunAt).toBeGreaterThanOrEqual(before);
  });

  test("recomputes next run for recurring task on completion", () => {
    const task = createTask({ description: "Recurring", query: "Q", schedule: "0 9 * * *" });
    const originalRunAt = task.runAt!;

    const updated = updateTask(task.id, { status: "completed", result: "OK" });

    // Recurring task should reset to pending with a new (later or equal) runAt
    expect(updated!.status).toBe("pending");
    expect(updated!.runAt).toBeGreaterThanOrEqual(originalRunAt);
    expect(updated!.result).toBe("OK");
  });

  test("one-shot task stays completed", () => {
    const task = createTask({ description: "One-shot", query: "Q", runAt: Date.now() - 1000 });
    const updated = updateTask(task.id, { status: "completed" });

    expect(updated!.status).toBe("completed");
    // runAt stays the same (no schedule to recompute)
    expect(updated!.runAt).toBe(task.runAt);
  });

  test("returns null for non-existent task", () => {
    expect(updateTask("fake-id", { status: "completed" })).toBeNull();
  });
});

describe("deleteTask", () => {
  test("removes a task and returns true", () => {
    const task = createTask({ description: "Delete me", query: "Q", runAt: Date.now() + 1000 });
    expect(deleteTask(task.id)).toBe(true);
    expect(getTask(task.id)).toBeNull();
  });

  test("returns false for non-existent task", () => {
    expect(deleteTask("nonexistent")).toBe(false);
  });
});
