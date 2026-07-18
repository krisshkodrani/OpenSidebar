/**
 * JobAgent console server (pi Phase 9) — the standalone local backend for the
 * job-application pipeline: review queue, criteria/answer editing, kit
 * drafting, run orchestration, and the submit-approval inbox.
 *
 * Design rules (see docs/engineering/pi-backend-spike.md, Phase 9):
 *  - The seed dir IS the database (no server state beyond in-memory run/
 *    approval registries + JSONL audit files in the seed). Kill the server
 *    mid-anything and nothing corrupts; the lifecycle ratchet still gates
 *    every status write.
 *  - Loopback only. Mutating routes additionally require the
 *    `X-JobAgent-Console: 1` header (forces a CORS preflight, which the
 *    loopback-only origin allowlist rejects for foreign pages) and a
 *    loopback Host header — the zero-dependency CSRF/DNS-rebinding guard.
 *  - No npm dependencies: bare node:http, idioms copied from
 *    scripts/log-server.ts.
 *  - Removable: delete scripts/jobagent-console/ and everything else works.
 *
 * Start: `pnpm run jobagent` (nx run tools:jobagent-console). Port via
 * JOBAGENT_CONSOLE_PORT (default 7591).
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EventHub } from "./events";
import {
  getAnswers,
  getApplication,
  getCriteria,
  getHealth,
  getKitDraft,
  getQueue,
  postKitApprove,
  postKitDraft,
  postStatus,
  putAnswers,
  putCriteria,
  putKitDraft,
  type ApiResult,
} from "./api";

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_PATH = join(HERE, "ui", "index.html");

export const CONSOLE_PORT = Number(process.env.JOBAGENT_CONSOLE_PORT ?? 7591);
const HOST = "127.0.0.1";

/* ── Guards (log-server.ts conventions, tightened for this surface) ── */

/** Only loopback web origins (any port) and extension origins may talk to us. */
function isAllowedOrigin(origin: string): boolean {
  return (
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ||
    /^chrome-extension:\/\/[a-z]{32}$/.test(origin)
  );
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}

function setCorsHeaders(res: ServerResponse, origin?: string): void {
  res.setHeader("Vary", "Origin");
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-JobAgent-Console",
  );
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, result: ApiResult, origin?: string): void {
  setCorsHeaders(res, origin);
  res.writeHead(result.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result.body));
}

function sendHtml(res: ServerResponse): void {
  // Read per-request: the UI is a dev surface; no caching, no build step.
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(readFileSync(UI_PATH));
}

/* ── Server ───────────────────────────────────────────────── */

export interface ConsoleServer {
  port: number;
  url: string;
  events: EventHub;
  close(): Promise<void>;
}

/** Start the console server. `port: 0` picks an ephemeral port (tests). */
export function startConsoleServer(
  port: number = CONSOLE_PORT,
): Promise<ConsoleServer> {
  const events = new EventHub();

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin as string | undefined;
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      // DNS-rebinding guard: only loopback Host headers are served at all.
      if (!isLoopbackHost(req.headers.host)) {
        return send(res, { status: 403, body: { error: "forbidden host" } });
      }
      if (origin && !isAllowedOrigin(origin)) {
        return send(res, { status: 403, body: { error: "forbidden origin" } });
      }
      if (method === "OPTIONS") {
        setCorsHeaders(res, origin);
        res.writeHead(204);
        return res.end();
      }
      // CSRF guard: every mutation must carry the console header.
      if (
        method !== "GET" &&
        req.headers["x-jobagent-console"] !== "1"
      ) {
        return send(res, {
          status: 403,
          body: { error: "missing X-JobAgent-Console header" },
        });
      }

      if (method === "GET" && (path === "/" || path === "/index.html")) {
        return sendHtml(res);
      }
      if (method === "GET" && path === "/api/health") {
        return send(res, getHealth(actualPort()), origin);
      }
      if (method === "GET" && path === "/api/events") {
        return events.addClient(res);
      }
      if (method === "GET" && path === "/api/queue") {
        return send(res, getQueue(), origin);
      }

      const appMatch = path.match(/^\/api\/applications\/([^/]+)$/);
      if (method === "GET" && appMatch) {
        return send(res, getApplication(decodeURIComponent(appMatch[1])), origin);
      }
      const statusMatch = path.match(/^\/api\/applications\/([^/]+)\/status$/);
      if (method === "POST" && statusMatch) {
        const body = await parseJsonBody(req).catch(() => null);
        const result = postStatus(decodeURIComponent(statusMatch[1]), body);
        if (result.status === 200) {
          events.broadcast({ type: "queue-changed", data: result.body });
        }
        return send(res, result, origin);
      }
      if (path === "/api/criteria" && method === "GET") {
        return send(res, getCriteria(), origin);
      }
      if (path === "/api/criteria" && method === "PUT") {
        const body = await parseJsonBody(req).catch(() => null);
        return send(res, putCriteria(body), origin);
      }
      if (path === "/api/answers" && method === "GET") {
        return send(res, getAnswers(), origin);
      }
      if (path === "/api/answers" && method === "PUT") {
        const body = await parseJsonBody(req).catch(() => null);
        return send(res, putAnswers(body), origin);
      }

      const draftMatch = path.match(/^\/api\/applications\/([^/]+)\/kit-draft$/);
      if (draftMatch) {
        const name = decodeURIComponent(draftMatch[1]);
        if (method === "GET") return send(res, getKitDraft(name), origin);
        const body = await parseJsonBody(req).catch(() => null);
        if (method === "POST") return send(res, postKitDraft(name, body), origin);
        if (method === "PUT") return send(res, putKitDraft(name, body), origin);
      }
      const approveMatch = path.match(/^\/api\/applications\/([^/]+)\/kit-approve$/);
      if (method === "POST" && approveMatch) {
        const body = await parseJsonBody(req).catch(() => null);
        const result = postKitApprove(decodeURIComponent(approveMatch[1]), body);
        if (result.status === 200) {
          events.broadcast({ type: "queue-changed", data: result.body });
        }
        return send(res, result, origin);
      }

      return send(res, { status: 404, body: { error: `no route ${method} ${path}` } }, origin);
    } catch (e) {
      return send(
        res,
        { status: 500, body: { error: e instanceof Error ? e.message : String(e) } },
        origin,
      );
    }
  });

  const actualPort = () => {
    const addr = server.address();
    return typeof addr === "object" && addr ? addr.port : port;
  };

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      resolve({
        port: actualPort(),
        url: `http://${HOST}:${actualPort()}`,
        events,
        close: () =>
          new Promise<void>((done) => {
            events.close();
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/* ── CLI entry ────────────────────────────────────────────── */

const isMain =
  !!process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (process.env.VITEST === undefined && isMain) {
  startConsoleServer().then((s) => {
    console.log(`[jobagent-console] listening on ${s.url}`);
    console.log(
      `[jobagent-console] browser side: node .artifacts/pi-live/launch-chrome.mjs ` +
        `(extension WS port must match OPENSIDEBAR_WS_PORT, default 8917)`,
    );
  });
}
