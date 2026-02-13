/**
 * Log Drain Server — receives log entries from the extension via HTTP
 * and appends them to a JSONL file for querying.
 *
 * Usage: bun run scripts/log-server.ts
 * Or:    bun run logs
 */

import { existsSync, mkdirSync, statSync, renameSync, unlinkSync } from "fs";
import { appendFile } from "fs/promises";
import { join, dirname } from "path";

const PORT = Number(process.env.LOG_SERVER_PORT) || 7589;
const HOST = "127.0.0.1";
const PROJECT_ROOT = join(dirname(import.meta.dir));
const LOG_DIR = join(PROJECT_ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "opensidebar.jsonl");
const TRACE_DIR = join(PROJECT_ROOT, "traces");
const TRACE_INDEX = join(TRACE_DIR, "index.jsonl");

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ROTATED = 5;

let entryCount = 0;
let traceEntryCount = 0;

// Ensure directories exist
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}
if (!existsSync(TRACE_DIR)) {
  mkdirSync(TRACE_DIR, { recursive: true });
}

/** Rotate log file when it exceeds MAX_FILE_SIZE */
function rotateIfNeeded(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    const { size } = statSync(LOG_FILE);
    if (size < MAX_FILE_SIZE) return;

    // Delete oldest, then shift .4→.5, .3→.4, ... , .1→.2, current→.1
    const oldest = `${LOG_FILE}.${MAX_ROTATED}`;
    if (existsSync(oldest)) {
      unlinkSync(oldest);
    }
    for (let i = MAX_ROTATED - 1; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`;
      const dst = `${LOG_FILE}.${i + 1}`;
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }
    // Rotate current → .1
    renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch (err) {
    console.error("Log rotation failed:", err);
  }
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = Bun.serve({
  port: PORT,
  hostname: HOST,

  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      return Response.json(
        { entries: entryCount, file: LOG_FILE },
        { headers: CORS_HEADERS },
      );
    }

    // Ingest endpoint
    if (url.pathname === "/ingest" && req.method === "POST") {
      try {
        const body = await req.json();
        if (!Array.isArray(body)) {
          return new Response("Expected JSON array", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        rotateIfNeeded();

        const lines = body.map((entry: unknown) => JSON.stringify(entry)).join("\n") + "\n";
        await appendFile(LOG_FILE, lines);
        entryCount += body.length;

        return new Response(null, { status: 204, headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Ingest error: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    // Trace entry endpoint — append a TraceEntry to traces/{sessionId}.jsonl
    if (url.pathname === "/traces" && req.method === "POST") {
      try {
        const entry = await req.json();
        const sessionId = entry?.sessionId;
        if (!sessionId || typeof sessionId !== "string") {
          return new Response("Missing sessionId", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
        const traceFile = join(TRACE_DIR, `${sessionId}.jsonl`);
        await appendFile(traceFile, JSON.stringify(entry) + "\n");
        traceEntryCount++;
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Trace error: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    // Trace session endpoint — append a TraceSession to traces/index.jsonl
    if (url.pathname === "/traces/session" && req.method === "POST") {
      try {
        const session = await req.json();
        await appendFile(TRACE_INDEX, JSON.stringify(session) + "\n");
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Trace session error: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
});

console.log(`Log server listening on http://${HOST}:${server.port}`);
console.log(`Writing to ${LOG_FILE}`);
console.log(`Traces to ${TRACE_DIR}`);
console.log(`Press Ctrl+C to stop\n`);
