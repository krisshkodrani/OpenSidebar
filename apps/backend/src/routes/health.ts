/**
 * GET /health — Backend health check
 */

import type { ServerResponse } from "node:http";
import type { HealthResponse } from "../types.js";
import { getDatabase } from "../db.js";
import { isGBrainConnected, getGBrainStats } from "../gbrain-client.js";

const startedAt = Date.now();

export async function handleHealth(res: ServerResponse, sendJson: SendJsonFn): Promise<void> {
  const db = getDatabase();
  const pendingRow = db
    .prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'")
    .get() as { count: number };

  const memoryConnected = isGBrainConnected();
  let memoryStats: { pageCount: number } | undefined;

  if (memoryConnected) {
    try {
      const stats = await getGBrainStats();
      if (stats) memoryStats = { pageCount: stats.page_count ?? 0 };
    } catch {
      // stats are optional
    }
  }

  const response: HealthResponse = {
    status: "ok",
    uptime: Date.now() - startedAt,
    memoryConnected,
    pendingTasks: pendingRow.count,
    memoryStats,
  };

  sendJson(res, response);
}

type SendJsonFn = (res: ServerResponse, data: unknown, status?: number) => void;
