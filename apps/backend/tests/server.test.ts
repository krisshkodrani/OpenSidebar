import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync } from "fs";
import { initDatabase, closeDatabase } from "../src/db";

// We test the route handlers directly by building a minimal server,
// bypassing GBrain (memory endpoints need GBrain which is too heavy for unit tests).

import { handleTaskRoutes } from "../src/routes/tasks";
import type { RouteContext } from "../src/server";

let server: Server;
let baseUrl: string;
let dbPath: string;

function parseJsonBody(req: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: any, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendEmpty(res: any, status = 204): void {
  res.writeHead(status);
  res.end();
}

function sendError(res: any, message: string, status = 400): void {
  sendJson(res, { error: message }, status);
}

beforeAll(async () => {
  dbPath = join(tmpdir(), `test-server-${Date.now()}.sqlite`);
  initDatabase(dbPath);

  server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const ctx: RouteContext = {
      pathname: url.pathname,
      searchParams: url.searchParams,
      method: req.method || "GET",
      parseJsonBody: () => parseJsonBody(req),
      sendJson,
      sendEmpty,
      sendError,
    };

    if (url.pathname === "/health") {
      sendJson(res, { status: "ok", pendingTasks: 0 });
      return;
    }

    if (url.pathname.startsWith("/tasks")) {
      await handleTaskRoutes(req, res, ctx);
      return;
    }

    sendError(res, "Not found", 404);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
  closeDatabase();
  try {
    unlinkSync(dbPath);
    unlinkSync(dbPath + "-wal");
    unlinkSync(dbPath + "-shm");
  } catch {
    // best-effort cleanup
  }
});

// Helper
async function api(
  path: string,
  options?: RequestInit,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();
  return {
    status: res.status,
    data: text ? JSON.parse(text) : null,
  };
}

describe("GET /health", () => {
  test("returns 200 with status", async () => {
    const { status, data } = await api("/health");
    expect(status).toBe(200);
    expect(data.status).toBe("ok");
  });
});

describe("POST /tasks", () => {
  test("creates a task with cron schedule", async () => {
    const { status, data } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Daily check",
        query: "Check HN",
        schedule: "0 9 * * *",
      }),
    });

    expect(status).toBe(201);
    expect(data.id).toBeTruthy();
    expect(data.status).toBe("pending");
    expect(data.schedule).toBe("0 9 * * *");
    expect(data.runAt).toBeGreaterThan(Date.now());
  });

  test("creates a one-shot task with runAt", async () => {
    const futureTime = Date.now() + 3_600_000;
    const { status, data } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "One-shot",
        query: "Do something",
        runAt: futureTime,
      }),
    });

    expect(status).toBe(201);
    expect(data.runAt).toBe(futureTime);
    expect(data.schedule).toBeNull();
  });

  test("rejects invalid cron expression", async () => {
    const { status, data } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Bad cron",
        query: "Test",
        schedule: "not-a-cron",
      }),
    });

    expect(status).toBe(400);
    expect(data.error).toContain("Invalid cron");
  });

  test("rejects task without schedule or runAt", async () => {
    const { status, data } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "No timing",
        query: "Test",
      }),
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  test("rejects task without required fields", async () => {
    const { status } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({ query: "Missing description" }),
    });
    expect(status).toBe(400);
  });
});

describe("GET /tasks", () => {
  test("lists all tasks", async () => {
    const { data } = await api("/tasks");
    expect(data.tasks).toBeDefined();
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  test("filters by status", async () => {
    // Create and complete a task
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "To complete",
        query: "Test",
        runAt: Date.now() + 1000,
      }),
    });
    await api(`/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });

    const { data: completed } = await api("/tasks?status=completed");
    expect(completed.tasks.some((t: any) => t.id === created.id)).toBe(true);

    const { data: pending } = await api("/tasks?status=pending");
    expect(pending.tasks.some((t: any) => t.id === created.id)).toBe(false);
  });

  test("rejects invalid status filter", async () => {
    const { status } = await api("/tasks?status=bogus");
    expect(status).toBe(400);
  });
});

describe("GET /tasks/pending", () => {
  test("returns tasks with past runAt", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Due now",
        query: "Test",
        runAt: Date.now() - 5000,
      }),
    });

    const { data } = await api("/tasks/pending");
    expect(data.tasks.some((t: any) => t.id === created.id)).toBe(true);
  });

  test("excludes tasks with future runAt", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Not yet",
        query: "Test",
        runAt: Date.now() + 999_999,
      }),
    });

    const { data } = await api("/tasks/pending");
    expect(data.tasks.some((t: any) => t.id === created.id)).toBe(false);
  });
});

describe("PATCH /tasks/:id", () => {
  test("updates task status and result", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "To update",
        query: "Test",
        runAt: Date.now() - 1000,
      }),
    });

    const { status, data } = await api(`/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed", result: "All done" }),
    });

    expect(status).toBe(200);
    expect(data.status).toBe("completed");
    expect(data.result).toBe("All done");
    expect(data.lastRunAt).toBeGreaterThan(0);
  });

  test("recurring task resets to pending with new runAt on completion", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Recurring",
        query: "Check",
        schedule: "0 9 * * *",
      }),
    });
    const originalRunAt = created.runAt;

    const { data: updated } = await api(`/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });

    expect(updated.status).toBe("pending");
    expect(updated.runAt).toBeGreaterThanOrEqual(originalRunAt);
  });

  test("returns 404 for non-existent task", async () => {
    const { status } = await api("/tasks/nonexistent-id", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    expect(status).toBe(404);
  });

  test("rejects invalid status value", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "T",
        query: "Q",
        runAt: Date.now() + 1000,
      }),
    });
    const { status } = await api(`/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "invalid" }),
    });
    expect(status).toBe(400);
  });
});

describe("DELETE /tasks/:id", () => {
  test("removes a task and returns 204", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Delete me",
        query: "Test",
        runAt: Date.now() + 1000,
      }),
    });

    const { status } = await api(`/tasks/${created.id}`, { method: "DELETE" });
    expect(status).toBe(204);

    // Verify it's gone from the list
    const { data: list } = await api("/tasks");
    expect(list.tasks.some((t: any) => t.id === created.id)).toBe(false);
  });

  test("returns 404 for non-existent task", async () => {
    const { status } = await api("/tasks/nonexistent", { method: "DELETE" });
    expect(status).toBe(404);
  });
});
