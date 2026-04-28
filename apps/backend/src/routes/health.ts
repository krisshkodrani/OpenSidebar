/**
 * GET /health — Backend health check
 */

import type { ServerResponse } from "node:http";
import type { HealthResponse } from "../types.js";

const startedAt = Date.now();

export async function handleHealth(res: ServerResponse, sendJson: SendJsonFn): Promise<void> {
  const response: HealthResponse = {
    status: "ok",
    uptime: Date.now() - startedAt,
    pendingTasks: 0,
  };

  sendJson(res, response);
}

type SendJsonFn = (res: ServerResponse, data: unknown, status?: number) => void;
