/**
 * Backend Agent Service — HTTP server entry point
 *
 * Provides long-term memory (GBrain) and task scheduling (SQLite)
 * for the OpenSidebar Chrome extension.
 *
 * Usage: npx tsx apps/backend/src/server.ts
 * Or:    npm run backend
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import { initDatabase, closeDatabase } from "./db.js";
import { connectGBrain, disconnectGBrain } from "./gbrain-client.js";
import { handleHealth } from "./routes/health.js";
import { handleMemoryRoutes } from "./routes/memory.js";
import { handleProfileRoutes } from "./routes/profile.js";
import { handleTaskRoutes } from "./routes/tasks.js";
import { startTaskTick, stopTaskTick } from "./services/task-scheduler.js";
import type { BackendConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

// ── Load config ──

function loadConfig(): BackendConfig {
  const raw = readFileSync(join(__dirname, "config.yaml"), "utf-8");
  const yaml = parseYaml(raw);
  return {
    server: {
      port: Number(process.env.BACKEND_PORT) || yaml.server?.port || 7590,
      host: yaml.server?.host || "127.0.0.1",
    },
    gbrain: {
      enabled: yaml.gbrain?.enabled ?? false,
      databasePath: resolve(__dirname, yaml.gbrain?.database_path || "../data/agent-brain.pglite"),
      mcpCommand: yaml.gbrain?.mcp_command || "bun",
      mcpArgs: yaml.gbrain?.mcp_args || ["run", "path/to/gbrain-cli.ts", "serve"],
    },
    tasks: {
      databasePath: resolve(__dirname, yaml.tasks?.database_path || "../data/backend-tasks.sqlite"),
      tickIntervalSeconds: yaml.tasks?.tick_interval_seconds || 60,
      maxConcurrent: yaml.tasks?.max_concurrent || 1,
    },
  };
}

// ── HTTP helpers (same pattern as scripts/log-server.ts) ──

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function setCorsHeaders(res: ServerResponse): void {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }
}

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendEmpty(res: ServerResponse, status = 204): void {
  setCorsHeaders(res);
  res.writeHead(status);
  res.end();
}

function sendError(res: ServerResponse, message: string, status = 400): void {
  sendJson(res, { error: message }, status);
}

// ── URL parsing helper ──

function parseUrl(req: IncomingMessage): { pathname: string; searchParams: URLSearchParams } {
  const url = new URL(req.url || "/", "http://localhost");
  return { pathname: url.pathname, searchParams: url.searchParams };
}

// ── Request router ──

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    sendEmpty(res);
    return;
  }

  const { pathname, searchParams } = parseUrl(req);
  const method = req.method || "GET";

  try {
    // Health
    if (pathname === "/health" && method === "GET") {
      await handleHealth(res, sendJson);
      return;
    }

    // Memory routes
    if (pathname.startsWith("/memory")) {
      await handleMemoryRoutes(req, res, { pathname, searchParams, method, parseJsonBody, sendJson, sendEmpty, sendError });
      return;
    }

    // Profile routes
    if (pathname.startsWith("/profile")) {
      await handleProfileRoutes(req, res, { pathname, searchParams, method, parseJsonBody, sendJson, sendEmpty, sendError });
      return;
    }

    // Task routes
    if (pathname.startsWith("/tasks")) {
      await handleTaskRoutes(req, res, { pathname, searchParams, method, parseJsonBody, sendJson, sendEmpty, sendError });
      return;
    }

    // 404
    sendError(res, "Not found", 404);
  } catch (err) {
    console.error("[backend] Request error:", err);
    sendError(res, "Internal server error", 500);
  }
}

// ── Startup ──

async function main(): Promise<void> {
  const config = loadConfig();

  // 1. Initialize SQLite (tasks)
  console.log("[backend] Initializing task database...");
  initDatabase(config.tasks.databasePath);

  // 2. Connect optional memory service
  if (config.gbrain.enabled) {
    console.log("[backend] Connecting memory service...");
    try {
      await connectGBrain(config.gbrain, PROJECT_ROOT);
      console.log("[backend] Memory service connected.");
    } catch (err) {
      console.warn("[backend] GBrain connection failed — running without memory:", err);
    }
  }

  // 3. Start task scheduler tick
  startTaskTick(config.tasks.tickIntervalSeconds);

  // 4. Start HTTP server
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("[backend] Unhandled request error:", err);
      if (!res.headersSent) {
        sendError(res, "Internal server error", 500);
      }
    });
  });

  server.listen(config.server.port, config.server.host, () => {
    console.log(`[backend] Backend agent service listening on http://${config.server.host}:${config.server.port}`);
  });

  // 5. Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n[backend] Received ${signal}. Shutting down...`);
    stopTaskTick();
    disconnectGBrain();
    closeDatabase();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[backend] Fatal startup error:", err);
  process.exit(1);
});

// Export helpers for route modules
export type RouteContext = {
  pathname: string;
  searchParams: URLSearchParams;
  method: string;
  parseJsonBody: typeof parseJsonBody;
  sendJson: typeof sendJson;
  sendEmpty: typeof sendEmpty;
  sendError: typeof sendError;
};
