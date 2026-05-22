/**
 * Backend Agent Service — HTTP server entry point
 *
 * Provides local durable run state (SQLite)
 * for the OpenSidebar Chrome extension.
 *
 * Usage: pnpm exec tsx apps/backend/src/server.ts
 * Or:    pnpm run backend:standalone
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { parse as parseYaml } from "yaml";
import { initDatabase, closeDatabase } from "./db.js";
import { handleHealth } from "./routes/health.js";
import { handleProfileRoutes } from "./routes/profile.js";
import { handleTaskRunRoutes } from "./routes/task-runs.js";
import type { BackendConfig } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadBackendConfig(): BackendConfig {
  const raw = readFileSync(join(__dirname, "config.yaml"), "utf-8");
  const yaml = parseYaml(raw);
  return {
    server: {
      port: Number(process.env.BACKEND_PORT) || yaml.server?.port || 7590,
      host: yaml.server?.host || "127.0.0.1",
    },
    storage: {
      databasePath: resolve(
        __dirname,
        yaml.storage?.database_path ||
          yaml.tasks?.database_path ||
          "../data/backend-tasks.sqlite",
      ),
    },
  };
}

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

function parseTextBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", reject);
  });
}

const CORS_METHODS = "POST, GET, PATCH, DELETE, OPTIONS";
const CORS_ALLOWED_HEADERS = "Content-Type";
const EXTENSION_ORIGIN = /^(chrome|moz)-extension:\/\/[a-z0-9_-]+$/i;
const LOCAL_BROWSER_ORIGINS = new Set([
  "http://127.0.0.1:7589",
  "http://localhost:7589",
  "http://127.0.0.1:7590",
  "http://localhost:7590",
]);

function getConfiguredAllowedOrigins(): Set<string> {
  return new Set(
    (process.env.OPENSIDEBAR_LOCAL_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function isAllowedLocalRequestOrigin(
  origin: string | string[] | undefined,
): boolean {
  const value = firstHeaderValue(origin);
  if (!value) return true;
  if (EXTENSION_ORIGIN.test(value)) return true;
  if (LOCAL_BROWSER_ORIGINS.has(value)) return true;
  return getConfiguredAllowedOrigins().has(value);
}

function setCorsHeaders(
  res: ServerResponse,
  origin?: string | string[],
): void {
  res.setHeader("Vary", "Origin");
  if (origin && isAllowedLocalRequestOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", firstHeaderValue(origin) ?? "");
  }
  res.setHeader("Access-Control-Allow-Methods", CORS_METHODS);
  res.setHeader("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
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

function parseUrl(req: IncomingMessage): {
  pathname: string;
  searchParams: URLSearchParams;
} {
  const url = new URL(req.url || "/", "http://localhost");
  return { pathname: url.pathname, searchParams: url.searchParams };
}

export async function handleBackendRequest(
  req: IncomingMessage,
  res: ServerResponse,
  route?: {
    pathname: string;
    searchParams: URLSearchParams;
  },
): Promise<void> {
  setCorsHeaders(res, req.headers.origin);
  if (!isAllowedLocalRequestOrigin(req.headers.origin)) {
    sendError(res, "Origin not allowed", 403);
    return;
  }

  if (req.method === "OPTIONS") {
    sendEmpty(res);
    return;
  }

  const { pathname, searchParams } = route ?? parseUrl(req);
  const method = req.method || "GET";

  try {
    if (pathname === "/health" && method === "GET") {
      await handleHealth(res, sendJson);
      return;
    }

    if (pathname.startsWith("/profile")) {
      await handleProfileRoutes(req, res, {
        pathname,
        searchParams,
        method,
        parseJsonBody,
        parseTextBody,
        sendJson,
        sendEmpty,
        sendError,
      });
      return;
    }

    if (pathname.startsWith("/task-runs")) {
      await handleTaskRunRoutes(req, res, {
        pathname,
        searchParams,
        method,
        parseJsonBody,
        parseTextBody,
        sendJson,
        sendEmpty,
        sendError,
      });
      return;
    }

    sendError(res, "Not found", 404);
  } catch (err) {
    console.error("[backend] Request error:", err);
    sendError(res, "Internal server error", 500);
  }
}

export async function startBackendServer(): Promise<void> {
  const config = loadBackendConfig();

  console.log("[backend] Initializing backend database...");
  initDatabase(config.storage.databasePath);

  const server = createServer((req, res) => {
    handleBackendRequest(req, res).catch((err) => {
      console.error("[backend] Unhandled request error:", err);
      if (!res.headersSent) {
        sendError(res, "Internal server error", 500);
      }
    });
  });

  server.listen(config.server.port, config.server.host, () => {
    console.log(
      `[backend] Backend agent service listening on http://${config.server.host}:${config.server.port}`,
    );
  });

  const shutdown = (signal: string) => {
    console.log(`\n[backend] Received ${signal}. Shutting down...`);
    closeDatabase();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  startBackendServer().catch((err) => {
    console.error("[backend] Fatal startup error:", err);
    process.exit(1);
  });
}

export type RouteContext = {
  pathname: string;
  searchParams: URLSearchParams;
  method: string;
  parseJsonBody: typeof parseJsonBody;
  parseTextBody: typeof parseTextBody;
  sendJson: typeof sendJson;
  sendEmpty: typeof sendEmpty;
  sendError: typeof sendError;
};
