/**
 * GET /health — Backend health check
 */

import type { ServerResponse } from "node:http";
import type { HealthResponse } from "../types.js";
import { getDatabase } from "../db.js";
import { getMemoryStats, isMemoryAvailable } from "../services/memory-service.js";

const startedAt = Date.now();

export async function handleHealth(res: ServerResponse, sendJson: SendJsonFn): Promise<void> {
  const db = getDatabase();
  const pendingRow = db
    .prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'")
    .get() as { count: number };

  const memoryConnected = isMemoryAvailable();
  const memoryStats = getMemoryStats();

  const response: HealthResponse = {
    status: "ok",
    uptime: Date.now() - startedAt,
    memoryConnected,
    memoryBackend: "sqlite",
    pendingTasks: pendingRow.count,
    memoryStats,
  };

  sendJson(res, response);
}

type SendJsonFn = (res: ServerResponse, data: unknown, status?: number) => void;
