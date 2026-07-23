/**
 * JobAgent daemon (pi Phase 9) — the standalone local backend for the
 * job-application pipeline: review queue, criteria/answer editing, kit
 * drafting, run orchestration, and the submit-approval inbox.
 *
 * Headless by design. It exists to hold what a prompt cannot: the WS bridge
 * to the extension, the single-active-run mutex, and the run/approval
 * registries. The front-end is `cli.ts` (and, through it, agent-platform
 * skills) — there is no bundled web UI.
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
 * Start: `pnpm run jobagent serve`. Port via JOBAGENT_CONSOLE_PORT
 * (default 7591).
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveApplicationDir } from "../jobagent/index";
import { loadFillManifest } from "../jobagent/manifest";
import { loadApplicationPackage } from "../jobagent/package";
import { EventHub } from "./events";
import {
  createProductionDeps,
  RunManager,
  type RunManagerDeps,
} from "./runs";
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
  // charset is explicit: answers carry non-ASCII (em dashes, umlauts, accented
  // names), and clients that see a bare application/json fall back to
  // ISO-8859-1 and mangle them.
  res.writeHead(result.status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(result.body));
}

/**
 * Root is a machine-readable index, not a page. An agent (or a curious human
 * with curl) that hits the daemon cold gets the route list and the CLI verb
 * that fronts each one, so the surface is discoverable without reading this
 * file.
 */
function getIndex(): ApiResult {
  return {
    status: 200,
    body: {
      service: "jobagent-daemon",
      headless: true,
      cli: "pnpm run jobagent help",
      routes: {
        "GET /api/health": "status",
        "GET /api/queue": "queue",
        "POST /api/assess": "assess <url>",
        "POST /api/ingest": "ingest <url>",
        "POST /api/applications/:name/questions": "questions <name>",
        "GET /api/applications/:name": "show <name>",
        "POST /api/applications/:name/status": "set-status <name> <status>",
        "GET|PUT /api/criteria": "criteria [file]",
        "GET|PUT /api/answers": "answers [file]",
        "GET|POST|PUT /api/applications/:name/kit-draft": "draft / edit-draft",
        "POST /api/applications/:name/kit-approve": "approve-kit <name>",
        "GET /api/bridge": "status",
        "GET /api/runs": "runs",
        "POST /api/runs/discovery": "discover",
        "POST /api/runs/fill": "fill <name> | submit <name>",
        "GET /api/runs/:id": "run <id>",
        "POST /api/runs/:id/cancel": "cancel <id>",
        "GET /api/approvals": "approvals",
        "POST /api/approvals/:id": "decide <id> approve|deny",
        "GET /api/events": "(SSE stream)",
      },
    },
  };
}

/**
 * Where a package's application form lives: the approved run config if there is
 * one, else the posting URL discovery recorded. Returns undefined when neither
 * exists, so the caller can ask for `{ formUrl }` rather than guess.
 */
function resolveFormUrl(name: string): string | undefined {
  try {
    const dir = resolveApplicationDir(name);
    const manifest = loadFillManifest(dir);
    if (manifest?.formUrl) return manifest.formUrl;
    return loadApplicationPackage(dir)?.sourceUrl || undefined;
  } catch {
    return undefined;
  }
}

/* ── Server ───────────────────────────────────────────────── */

export interface ConsoleServer {
  port: number;
  url: string;
  events: EventHub;
  runs: RunManager;
  close(): Promise<void>;
}

export interface ConsoleServerOptions {
  /** Inject fake run-manager deps in tests; omit to use production deps. */
  runDeps?: (emit: RunManagerDeps["emit"]) => RunManagerDeps;
  /** Start the WS bridge on boot (default false — enable in the CLI entry). */
  ownBridge?: boolean;
}

/** Start the console server. `port: 0` picks an ephemeral port (tests). */
export async function startConsoleServer(
  port: number = CONSOLE_PORT,
  options: ConsoleServerOptions = {},
): Promise<ConsoleServer> {
  const events = new EventHub();
  const emit = events.broadcast.bind(events);
  const runs = new RunManager(
    options.runDeps ? options.runDeps(emit) : createProductionDeps(emit),
  );
  if (options.ownBridge) await runs.start();

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

      if (method === "GET" && path === "/") {
        return send(res, getIndex(), origin);
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

      /* — v2: runs + approvals — */
      if (path === "/api/bridge" && method === "GET") {
        return send(
          res,
          {
            status: 200,
            body: {
              ...runs.bridgeStatus(),
              wsPort: Number(process.env.OPENSIDEBAR_WS_PORT ?? 8917),
            },
          },
          origin,
        );
      }
      /* — LP-22: single-URL ingest + form-question extraction — */
      if (path === "/api/assess" && method === "POST") {
        const body = (await parseJsonBody(req).catch(() => null)) as {
          url?: string;
        } | null;
        if (!body?.url) {
          return send(res, { status: 400, body: { error: "body must be { url }" } }, origin);
        }
        return send(res, (await runs.assessUrl(body.url)) as ApiResult, origin);
      }
      if (path === "/api/ingest" && method === "POST") {
        const body = (await parseJsonBody(req).catch(() => null)) as {
          url?: string;
          source?: string;
          name?: string;
        } | null;
        if (!body?.url) {
          return send(res, { status: 400, body: { error: "body must be { url, source?, name? }" } }, origin);
        }
        const result = (await runs.ingestUrl(body.url, {
          source: body.source,
          name: body.name,
        })) as ApiResult;
        return send(res, result, origin);
      }
      const questionsMatch = path.match(/^\/api\/applications\/([^/]+)\/questions$/);
      if (method === "POST" && questionsMatch) {
        const name = decodeURIComponent(questionsMatch[1]);
        const body = (await parseJsonBody(req).catch(() => null)) as {
          formUrl?: string;
        } | null;
        const formUrl = body?.formUrl ?? resolveFormUrl(name);
        if (!formUrl) {
          return send(
            res,
            {
              status: 409,
              body: {
                error:
                  `no form URL for "${name}" — the package has no run-config or ` +
                  `sourceUrl; pass { formUrl } explicitly`,
              },
            },
            origin,
          );
        }
        return send(res, (await runs.extractFormQuestions(name, formUrl)) as ApiResult, origin);
      }

      if (path === "/api/runs" && method === "GET") {
        return send(
          res,
          { status: 200, body: { runs: runs.listRuns().map(({ log, ...r }) => ({ ...r, logLength: log.length })) } },
          origin,
        );
      }
      if (path === "/api/runs/discovery" && method === "POST") {
        return send(res, { ...runs.startDiscovery() } as ApiResult, origin);
      }
      if (path === "/api/runs/fill" && method === "POST") {
        const body = (await parseJsonBody(req).catch(() => null)) as {
          name?: string;
          mode?: "fill" | "submit";
        } | null;
        if (!body?.name || (body.mode !== "fill" && body.mode !== "submit")) {
          return send(res, { status: 400, body: { error: "body must be { name, mode: fill|submit }" } }, origin);
        }
        return send(res, { ...runs.startFill(body.name, body.mode) } as ApiResult, origin);
      }
      const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
      if (method === "GET" && runMatch) {
        const run = runs.getRun(decodeURIComponent(runMatch[1]));
        if (!run) return send(res, { status: 404, body: { error: "unknown run" } }, origin);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const { log, ...rest } = run;
        return send(
          res,
          {
            status: 200,
            body: { run: rest, log: log.slice(offset), nextOffset: log.length },
          },
          origin,
        );
      }
      const cancelMatch = path.match(/^\/api\/runs\/([^/]+)\/cancel$/);
      if (method === "POST" && cancelMatch) {
        const canceled = runs.cancelRun(decodeURIComponent(cancelMatch[1]));
        return send(
          res,
          canceled
            ? { status: 200, body: { canceled: true } }
            : { status: 409, body: { error: "run is not active" } },
          origin,
        );
      }
      if (path === "/api/approvals" && method === "GET") {
        return send(res, { status: 200, body: runs.listApprovals() }, origin);
      }
      const approvalMatch = path.match(/^\/api\/approvals\/([^/]+)$/);
      if (method === "POST" && approvalMatch) {
        const body = (await parseJsonBody(req).catch(() => null)) as {
          approved?: boolean;
        } | null;
        if (typeof body?.approved !== "boolean") {
          return send(res, { status: 400, body: { error: "body must be { approved: boolean }" } }, origin);
        }
        const result = runs.resolveApproval(
          decodeURIComponent(approvalMatch[1]),
          body.approved,
        );
        return send(res, result as ApiResult, origin);
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
        runs,
        close: async () => {
          await runs.stop();
          await new Promise<void>((done) => {
            events.close();
            server.closeAllConnections?.();
            server.close(() => done());
          });
        },
      });
    });
  });
}

/* ── Direct entry ─────────────────────────────────────────── */

// `pnpm run jobagent serve` is the documented way in (cli.ts imports this
// module); running server.ts directly stays supported so the daemon can be
// started without the CLI layer — e.g. from a supervisor or a debugger.
const isMain =
  !!process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (process.env.VITEST === undefined && isMain) {
  startConsoleServer(CONSOLE_PORT, { ownBridge: true }).then((s) => {
    console.log(`[jobagent] daemon listening on ${s.url}`);
    console.log(
      `[jobagent] WS bridge owned on port ${process.env.OPENSIDEBAR_WS_PORT ?? 8917} — ` +
        `launch the browser side with: node .artifacts/pi-live/launch-chrome.mjs`,
    );
  });
}
