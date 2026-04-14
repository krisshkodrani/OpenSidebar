/**
 * Task routes — REST endpoints for the scheduling queue.
 *
 * POST   /tasks           — Create scheduled task
 * GET    /tasks            — List tasks (optional status filter)
 * GET    /tasks/pending    — Poll for tasks ready to execute
 * PATCH  /tasks/:id        — Update task (status, result)
 * DELETE /tasks/:id        — Remove task
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "../server.js";
import type { TaskInput, TaskPatch, TaskStatus } from "../types.js";
import {
  createTask,
  listTasks,
  getPendingTasks,
  updateTask,
  deleteTask,
} from "../services/task-scheduler.js";

const VALID_STATUSES: TaskStatus[] = ["pending", "running", "completed", "failed", "cancelled"];

export async function handleTaskRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const { pathname, searchParams, method, parseJsonBody, sendJson, sendEmpty, sendError } = ctx;

  // GET /tasks/pending — Poll for due tasks
  if (pathname === "/tasks/pending" && method === "GET") {
    const tasks = getPendingTasks();
    sendJson(res, { tasks });
    return;
  }

  // POST /tasks — Create
  if (pathname === "/tasks" && method === "POST") {
    const body = (await parseJsonBody(req)) as Partial<TaskInput>;

    if (!body.description || !body.query) {
      sendError(res, "Missing required fields: description, query");
      return;
    }

    if (body.schedule) {
      // Validate cron expression
      try {
        const { CronExpressionParser } = await import("cron-parser");
        CronExpressionParser.parse(body.schedule);
      } catch {
        sendError(res, `Invalid cron expression: ${body.schedule}`);
        return;
      }
    }

    if (!body.schedule && !body.runAt) {
      sendError(res, "Either schedule (cron) or runAt (unix ms) is required");
      return;
    }

    const task = createTask({
      description: body.description,
      query: body.query,
      schedule: body.schedule,
      runAt: body.runAt,
      tabUrl: body.tabUrl,
      workspaceId: body.workspaceId,
    });

    sendJson(res, task, 201);
    return;
  }

  // GET /tasks — List
  if (pathname === "/tasks" && method === "GET") {
    const status = searchParams.get("status") as TaskStatus | null;
    const limit = Number(searchParams.get("limit")) || 50;

    if (status && !VALID_STATUSES.includes(status)) {
      sendError(res, `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`);
      return;
    }

    const tasks = listTasks(status ?? undefined, limit);
    sendJson(res, { tasks });
    return;
  }

  // PATCH /tasks/:id — Update
  const idMatch = pathname.match(/^\/tasks\/([a-f0-9-]+)$/);
  if (idMatch && method === "PATCH") {
    const body = (await parseJsonBody(req)) as Partial<TaskPatch>;

    if (body.status && !VALID_STATUSES.includes(body.status)) {
      sendError(res, `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`);
      return;
    }

    const updated = updateTask(idMatch[1], {
      status: body.status,
      result: body.result,
    });

    if (!updated) {
      sendError(res, "Task not found", 404);
      return;
    }

    sendJson(res, updated);
    return;
  }

  // DELETE /tasks/:id
  if (idMatch && method === "DELETE") {
    const deleted = deleteTask(idMatch[1]);
    if (!deleted) {
      sendError(res, "Task not found", 404);
      return;
    }
    sendEmpty(res);
    return;
  }

  sendError(res, "Not found", 404);
}
