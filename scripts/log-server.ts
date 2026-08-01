/**
 * Log Drain Server — receives log entries from the extension via HTTP
 * and appends them to a JSONL file for querying.
 *
 * Usage: pnpm exec tsx scripts/log-server.ts
 * Or:    pnpm run logs
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  existsSync,
  mkdirSync,
  statSync,
  renameSync,
  unlinkSync,
  readFileSync,
  readdirSync,
} from "fs";
import { appendFile, readFile, writeFile } from "fs/promises";
import { join, dirname, extname, resolve } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import {
  dedupeAnnotationsLatestWins,
  getSessionModels,
  localDayKey,
  matchesTraceFilters,
  normalizeAgentSessionRecord,
  normalizeAgentTurnRecord,
  normalizeAnnotationInput,
  normalizeRunEventRecord,
  normalizeRunManifestRecord,
  parseAnnotationsJsonl,
  serializeTraceSearchSession,
  type RunAnnotationRecord,
  type TraceEntryLike,
  type TraceSearchFiltersLike,
  type TraceSessionLike,
} from "./log-server-helpers";
import {
  listSkillDescriptors,
  getLoadedSkillContract,
} from "../apps/extension/src/background/orchestrator/skills";
import {
  buildTraceInsights,
  type TraceInsightsFilters,
} from "./trace-insights";

import {
  buildHarnessRatchetCandidates,
  buildTraceInsightsFromSqlite,
  buildTraceTrendsFromSqlite,
  getTraceIndexStatus,
  insertRunTraceEventToSqlite,
  insertTraceTurnToSqlite,
  readRunRawJsonlFromSqlite,
  readTraceRawJsonlFromSqlite,
  searchTraceSessionsFromSqlite,
  recordTraceArtifactInSqlite,
  upsertRunTraceManifestToSqlite,
  upsertTraceSessionToSqlite,
} from "./trace-sqlite-store";
import { getRlTrajectory } from "./obs/core";
import { createTraceRepository } from "./obs/repository";
import {
  emitObsSpans,
  emitSessionRoots,
  flushSpineOtelExport,
  initSpineOtelExport,
} from "./obs/otel-emit";
import {
  recordEntrySpansSafe,
  recordRunEventSafe,
  recordSessionSafe,
} from "./obs/span-store";

const EXTENSION_ORIGIN = /^(chrome|moz)-extension:\/\/[a-z0-9_-]+$/i;
const LOCAL_BROWSER_ORIGINS = new Set([
  "http://127.0.0.1:7589",
  "http://localhost:7589",
]);

function firstAllowedOriginValue(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isAllowedLocalRequestOrigin(
  origin: string | string[] | undefined,
): boolean {
  const value = firstAllowedOriginValue(origin);
  if (!value) return true;
  if (EXTENSION_ORIGIN.test(value)) return true;
  if (LOCAL_BROWSER_ORIGINS.has(value)) return true;
  return new Set(
    (process.env.OPENSIDEBAR_LOCAL_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ).has(value);
}
const PORT = Number(process.env.LOG_SERVER_PORT) || 7589;
// In Docker, set LOG_SERVER_HOST=0.0.0.0 so the published (host-loopback) port routes in.
const HOST = process.env.LOG_SERVER_HOST || "127.0.0.1";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const traceRepository = createTraceRepository(PROJECT_ROOT);
const LOG_DIR = join(PROJECT_ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "opensidebar.jsonl");
const TRACE_DIR = join(PROJECT_ROOT, "traces");
const TRACE_INDEX = join(TRACE_DIR, "index.jsonl");
const RUN_TRACE_DIR = join(TRACE_DIR, "runs");
const RUN_TRACE_INDEX = join(RUN_TRACE_DIR, "index.jsonl");
const TRACE_SQLITE_INDEX = join(
  PROJECT_ROOT,
  ".artifacts",
  "trace-index.sqlite",
);
const GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden");
const EVALS_DIR = join(PROJECT_ROOT, "evals");
// Append-only human-adjudication log (verdict per run). Committable, next to
// evals/golden so exported cases and their source verdicts live together.
const ANNOTATIONS_FILE = join(EVALS_DIR, "annotations.jsonl");
const SCREENSHOT_DIR = join(TRACE_DIR, "screenshots");
// The trace viewer is a dev-only page: production builds strip it from dist/
// (vite.config.ts), so non-production builds emit it into dist-dev/. Prefer
// dist-dev and keep dist/ as a legacy fallback for older checkouts.
const VIEWER_BUILD_ROOTS = [
  join(PROJECT_ROOT, "dist-dev"),
  join(PROJECT_ROOT, "dist"),
];
function resolveViewerBuildRoot(): string | null {
  for (const root of VIEWER_BUILD_ROOTS) {
    if (existsSync(join(root, "src", "trace-viewer", "index.html"))) {
      return root;
    }
  }
  return null;
}
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ROTATED = 5;

let entryCount = 0;

/* Trace-session response cache */
// Viewer startup calls /api/traces/search, /api/traces/days, and
// /api/traces/models in parallel. All three need the same session list, so keep
// one source-aware in-memory copy and share the in-flight load.

interface TraceSessionsCacheSlot {
  sessions: TraceSessionLike[] | null;
  promise: Promise<TraceSessionLike[]> | null;
  sourceMtime: number;
}

let traceSessionsCache: TraceSessionsCacheSlot | null = null;
let traceSessionsCacheVersion = 0;

function invalidateTraceSessionsCache(): void {
  traceSessionsCache = null;
  traceSessionsCacheVersion += 1;
}

function traceSessionsSourceMtime(): number {
  let latest = 0;
  for (const path of [
    TRACE_SQLITE_INDEX,
    `${TRACE_SQLITE_INDEX}-wal`,
    TRACE_INDEX,
  ]) {
    try {
      if (existsSync(path)) {
        latest = Math.max(latest, statSync(path).mtimeMs);
      }
    } catch {
      // Best effort: explicit invalidation handles normal server writes.
    }
  }
  return latest;
}

/* ── Insights response cache ──────────────────────────────── */
// /api/trace-insights re-reads every session row, every turn, every tool call,
// and every run event from SQLite on every request. A single request with
// hundreds of sessions can take several seconds. This cache short-circuits
// repeated calls with identical filter parameters.

interface InsightsCacheSlot {
  key: string;
  payload: string; // pre-serialised JSON — avoids re-serialising on every hit
  ts: number;
}

const INSIGHTS_CACHE_TTL_MS = 30_000; // 30 s — fresh enough for local dev
let insightsCache: InsightsCacheSlot | null = null;

/** Call whenever a write makes cached insights stale. */
function invalidateInsightsCache(): void {
  insightsCache = null;
}

function invalidateTraceViewerCaches(): void {
  invalidateTraceSessionsCache();
  invalidateInsightsCache();
}

/* ── Node.js HTTP helpers ─────────────────────────────────── */

function parseJsonBody(req: IncomingMessage): Promise<any> {
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

/**
 * CORS headers for local development.
 * Extension origins and local viewer origins are allowed.
 * Arbitrary web origins are rejected before routing.
 */
const CORS_METHODS = "POST, GET, PATCH, PUT, DELETE, OPTIONS";
const CORS_ALLOWED_HEADERS = "Content-Type";

function setCorsHeaders(
  res: ServerResponse,
  origin?: string | string[],
): void {
  res.setHeader("Vary", "Origin");
  if (origin && isAllowedLocalRequestOrigin(origin)) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      Array.isArray(origin) ? origin[0] : origin,
    );
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

function sendText(res: ServerResponse, text: string, status = 500): void {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
}

function sendFile(
  res: ServerResponse,
  filePath: string,
  contentType: string,
  extraHeaders?: Record<string, string>,
): void {
  setCorsHeaders(res);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    ...extraHeaders,
  };
  res.writeHead(200, headers);
  const data = readFileSync(filePath);
  res.end(data);
}

/* ── Normalization helpers ─────────────────────────────────── */

async function loadAllTraceSessions(): Promise<TraceSessionLike[]> {
  return traceRepository.loadSessions();
}

async function readAllTraceSessions(): Promise<TraceSessionLike[]> {
  const sourceMtime = traceSessionsSourceMtime();
  if (
    traceSessionsCache?.sessions &&
    traceSessionsCache.sourceMtime === sourceMtime
  ) {
    return traceSessionsCache.sessions.slice();
  }

  if (traceSessionsCache?.promise) {
    const sessions = await traceSessionsCache.promise;
    return sessions.slice();
  }

  const staleSessions = traceSessionsCache?.sessions ?? null;
  const staleSourceMtime = traceSessionsCache?.sourceMtime ?? 0;
  const cacheVersion = traceSessionsCacheVersion;
  const promise = loadAllTraceSessions()
    .then((sessions) => {
      const loadedSourceMtime = traceSessionsSourceMtime();
      if (
        traceSessionsCacheVersion === cacheVersion &&
        traceSessionsCache?.promise === promise
      ) {
        traceSessionsCache =
          loadedSourceMtime === sourceMtime
            ? {
                sessions,
                promise: null,
                sourceMtime,
              }
            : staleSessions
              ? {
                  sessions: staleSessions,
                  promise: null,
                  sourceMtime: staleSourceMtime,
                }
              : null;
      }
      return sessions;
    })
    .catch((err) => {
      if (
        traceSessionsCacheVersion === cacheVersion &&
        traceSessionsCache?.promise === promise
      ) {
        traceSessionsCache = staleSessions
          ? {
              sessions: staleSessions,
              promise: null,
              sourceMtime: staleSourceMtime,
            }
          : null;
      }
      throw err;
    });

  traceSessionsCache = {
    sessions: staleSessions,
    promise,
    sourceMtime: staleSourceMtime,
  };

  const sessions = await promise;
  return sessions.slice();
}

async function readTraceEntries(sessionId: string): Promise<TraceEntryLike[]> {
  // RFC LP-7 Stage B1: the span spine is the AUTHORITATIVE source for per-turn
  // records. The spine stores each TraceEntry verbatim (byte-identical to the
  // legacy JSONL entry — parity-verified, 0 mismatches), so reading from it is
  // not a lossy projection: it returns the same bytes. The legacy JSONL/SQLite
  // store is kept as a derived fallback. Set OBS_DISABLE_SPINE_READS=1 to revert.
  return traceRepository.loadEntries(sessionId);
}

async function readRunTraceEvents(runId: string): Promise<TraceEntryLike[]> {
  // Spine is authoritative for run events too (stored verbatim). Reversible via
  // OBS_DISABLE_SPINE_READS=1; legacy store is the derived fallback.
  return traceRepository.loadRunEvents(runId);
}

function traceInsightsFilters(searchParams: URLSearchParams): TraceInsightsFilters {
  return {
    day: searchParams.get("day"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    domain:
      searchParams.get("domain") ||
      searchParams.get("website") ||
      searchParams.get("host") ||
      "",
    outcome: (searchParams.get("outcome") || "").trim(),
    sessionPrefix: (
      searchParams.get("sessionId") ||
      searchParams.get("sessionIdPrefix") ||
      ""
    ).trim(),
    sessionId: (searchParams.get("sessionId") || "").trim(),
    mode: (searchParams.get("mode") || "").trim(),
    model: (searchParams.get("model") || "").trim(),
    skill: (searchParams.get("skill") || "").trim(),
    q: (searchParams.get("q") || "").toLowerCase().trim(),
    runId: (searchParams.get("runId") || "").trim(),
    tier: (searchParams.get("tier") || "").trim(),
    tool: (searchParams.get("tool") || "").trim(),
    toolStatus: (searchParams.get("toolStatus") || "").trim(),
    failure: (searchParams.get("failure") || "").trim(),
    eventType: (searchParams.get("eventType") || "").trim(),
  };
}

// Ensure directories exist
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}
if (!existsSync(TRACE_DIR)) {
  mkdirSync(TRACE_DIR, { recursive: true });
}
if (!existsSync(RUN_TRACE_DIR)) {
  mkdirSync(RUN_TRACE_DIR, { recursive: true });
}
if (!existsSync(SCREENSHOT_DIR)) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
}
if (!existsSync(GOLDEN_DIR)) {
  mkdirSync(GOLDEN_DIR, { recursive: true });
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

function stripInlinePageStateScreenshots(entry: Record<string, unknown>): void {
  const pageState = entry.pageState as Record<string, unknown> | undefined;
  if (!pageState) return;
  for (const capture of Object.values(pageState)) {
    const screenshots = (capture as Record<string, unknown> | undefined)
      ?.screenshots;
    if (!Array.isArray(screenshots)) continue;
    for (const screenshot of screenshots) {
      if (!screenshot || typeof screenshot !== "object") continue;
      const shot = screenshot as Record<string, unknown>;
      if (
        typeof shot.dataUrl === "string" &&
        shot.dataUrl.startsWith("data:image/")
      ) {
        delete shot.dataUrl;
      }
    }
  }
}

/* ── MIME type map ─────────────────────────────────────────── */

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/* ── HTTP Server ───────────────────────────────────────────── */

const server = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    setCorsHeaders(res, req.headers.origin);

    if (!isAllowedLocalRequestOrigin(req.headers.origin)) {
      sendText(res, "Origin not allowed", 403);
      return;
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      sendEmpty(res, 204);
      return;
    }

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, { entries: entryCount, file: LOG_FILE });
      return;
    }

    // Ingest endpoint
    if (url.pathname === "/ingest" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        if (!Array.isArray(body)) {
          sendText(res, "Expected JSON array", 400);
          return;
        }

        rotateIfNeeded();

        // Write all entries to the main log file
        const lines =
          body.map((entry: unknown) => JSON.stringify(entry)).join("\n") + "\n";
        await appendFile(LOG_FILE, lines);
        entryCount += body.length;

        // Also write session-scoped entries to per-session files for correlation
        const bySession = new Map<string, unknown[]>();
        for (const entry of body) {
          const sid = (entry as Record<string, unknown>)?.sid;
          if (typeof sid === "string" && sid.length > 0) {
            let list = bySession.get(sid);
            if (!list) {
              list = [];
              bySession.set(sid, list);
            }
            list.push(entry);
          }
        }
        for (const [sid, entries] of bySession) {
          const sessionLogFile = join(LOG_DIR, `session-${sid}.jsonl`);
          const sessionLines =
            entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
          await appendFile(sessionLogFile, sessionLines);
        }

        sendEmpty(res, 204);
      } catch (err) {
        sendText(res, `Ingest error: ${err}`, 500);
      }
      return;
    }

    // Trace entry endpoint — append a TraceEntry to traces/{sessionId}.jsonl
    if (url.pathname === "/traces" && req.method === "POST") {
      try {
        const entry = normalizeAgentTurnRecord(await parseJsonBody(req));
        const sessionId = entry?.sessionId;
        if (!sessionId || typeof sessionId !== "string") {
          sendText(res, "Missing sessionId", 400);
          return;
        }

        // Auto-extract inline screenshots to files (keeps JSONL compact)
        const perception = entry?.perception as
          | Record<string, unknown>
          | undefined;
        const turnNumber = entry?.turnNumber;
        if (perception && typeof turnNumber === "number") {
          const dataUrl = perception.screenshotDataUrl;
          if (
            typeof dataUrl === "string" &&
            dataUrl.startsWith("data:image/")
          ) {
            try {
              const base64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
              const buffer = Buffer.from(base64, "base64");
              const filename = `${sessionId}-T${turnNumber}.jpg`;
              const filepath = join(SCREENSHOT_DIR, filename);
              await writeFile(filepath, buffer);
              recordTraceArtifactInSqlite(PROJECT_ROOT, {
                path: filepath,
                kind: "screenshot",
                sessionId,
                sizeBytes: buffer.length,
                mtimeMs: Date.now(),
              });
            } catch {
              /* best-effort */
            }
            // Strip inline data URL — viewer will use the file-based API instead
            delete perception.screenshotDataUrl;
          }

          // Also extract panoramic shots to files
          const panoramicShots = perception.panoramicShots as
            | Array<Record<string, unknown>>
            | undefined;
          if (Array.isArray(panoramicShots)) {
            for (let i = 0; i < panoramicShots.length; i++) {
              const shot = panoramicShots[i];
              const shotUrl = shot?.dataUrl;
              if (
                typeof shotUrl === "string" &&
                shotUrl.startsWith("data:image/")
              ) {
                try {
                  const base64 = shotUrl.replace(
                    /^data:image\/[a-z]+;base64,/,
                    "",
                  );
                  const buffer = Buffer.from(base64, "base64");
                  const filename = `${sessionId}-T${turnNumber}-pan${i}.jpg`;
                  const filepath = join(SCREENSHOT_DIR, filename);
                  await writeFile(filepath, buffer);
                  recordTraceArtifactInSqlite(PROJECT_ROOT, {
                    path: filepath,
                    kind: "screenshot",
                    sessionId,
                    sizeBytes: buffer.length,
                    mtimeMs: Date.now(),
                  });
                  // Replace inline data URL with file reference
                  shot.dataUrl = `/api/traces/${sessionId}/screenshots/${turnNumber}-pan${i}`;
                } catch {
                  /* best-effort */
                }
              }
            }
          }
        }

        stripInlinePageStateScreenshots(entry as Record<string, unknown>);

        const traceFile = join(TRACE_DIR, `${sessionId}.jsonl`);
        if (!hasTraceTurn(traceFile, entry)) {
          await appendFile(traceFile, JSON.stringify(entry) + "\n");
        }
        insertTraceTurnToSqlite(PROJECT_ROOT, entry as TraceEntryLike);
        // RFC LP-7 Stage B1: additive span-spine dual-write (fully guarded —
        // can never break trace recording). When Bluebox export is configured,
        // the same derived spans also stream out as OTLP (emit never throws).
        const spineRecord = recordEntrySpansSafe(entry);
        if (spineRecord) emitObsSpans(spineRecord.spans);
        invalidateInsightsCache();
        sendEmpty(res, 204);
      } catch (err) {
        sendText(res, `Trace error: ${err}`, 500);
      }
      return;
    }

    // Trace session endpoint — append a TraceSession to traces/index.jsonl
    if (url.pathname === "/traces/session" && req.method === "POST") {
      try {
        const session = normalizeAgentSessionRecord(await parseJsonBody(req));
        await appendFile(TRACE_INDEX, JSON.stringify(session) + "\n");
        const sessionId =
          typeof session.sessionId === "string" ? session.sessionId : "";
        upsertTraceSessionToSqlite(PROJECT_ROOT, session, {
          traceFile: sessionId ? join(TRACE_DIR, `${sessionId}.jsonl`) : undefined,
        });
        recordSessionSafe(session); // RFC LP-7 B1: guarded spine dual-write
        // Root spans (orchestrator.run / agent.session) exist only as session
        // records — synthesize them for the OTLP stream (no-op when off).
        emitSessionRoots(session);
        invalidateTraceViewerCaches();
        sendEmpty(res, 204);
      } catch (err) {
        sendText(res, `Trace session error: ${err}`, 500);
      }
      return;
    }

    // Screenshot save endpoint — decode base64 data URL and write to traces/screenshots/
    if (url.pathname === "/traces/screenshot" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const sessionId = body?.sessionId;
        const turnNumber = body?.turnNumber;
        const dataUrl = body?.dataUrl;
        if (
          !sessionId ||
          typeof sessionId !== "string" ||
          typeof turnNumber !== "number" ||
          !dataUrl ||
          typeof dataUrl !== "string"
        ) {
          sendText(res, "Expected { sessionId, turnNumber, dataUrl }", 400);
          return;
        }
        // Strip data URL prefix (e.g. "data:image/jpeg;base64,")
        const base64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        const filename = `${sessionId}-T${turnNumber}.jpg`;
        const filepath = join(SCREENSHOT_DIR, filename);
        await writeFile(filepath, buffer);
        recordTraceArtifactInSqlite(PROJECT_ROOT, {
          path: filepath,
          kind: "screenshot",
          sessionId,
          sizeBytes: buffer.length,
          mtimeMs: Date.now(),
        });
        sendEmpty(res, 204);
      } catch (err) {
        sendText(res, `Screenshot save error: ${err}`, 500);
      }
      return;
    }

    // Orchestrator run-trace event endpoint
    if (url.pathname === "/run-traces" && req.method === "POST") {
      try {
        const event = normalizeRunEventRecord(await parseJsonBody(req));
        const runId = event?.runId;
        if (!runId || typeof runId !== "string") {
          sendText(res, "Missing runId", 400);
          return;
        }
        const traceFile = join(RUN_TRACE_DIR, `${runId}.jsonl`);
        await appendFile(traceFile, JSON.stringify(event) + "\n");
        insertRunTraceEventToSqlite(PROJECT_ROOT, event as TraceEntryLike);
        recordRunEventSafe(event); // RFC LP-7 B1: guarded spine dual-write
        invalidateInsightsCache();
        sendEmpty(res, 204);
      } catch (err) {
        sendText(res, `Run trace error: ${err}`, 500);
      }
      return;
    }

    // Orchestrator run-trace manifest endpoint
    if (url.pathname === "/run-traces/session" && req.method === "POST") {
      try {
        const manifest = normalizeRunManifestRecord(await parseJsonBody(req));
        await appendFile(RUN_TRACE_INDEX, JSON.stringify(manifest) + "\n");
        upsertRunTraceManifestToSqlite(PROJECT_ROOT, manifest as TraceEntryLike);
        sendEmpty(res, 204);
      } catch (err) {
        sendText(res, `Run manifest error: ${err}`, 500);
      }
      return;
    }

    // --- Trace Viewer API ---

    // GET /api/traces — list all trace sessions
    if (url.pathname === "/api/traces" && req.method === "GET") {
      try {
        const sessions = (await readAllTraceSessions()).sort((a, b) => {
          const t = (b.startTime ?? 0) - (a.startTime ?? 0);
          if (t !== 0) return t;
          return String(a.sessionId || "").localeCompare(
            String(b.sessionId || ""),
          );
        });
        sendJson(res, sessions);
      } catch (err) {
        sendText(res, `Error reading traces: ${err}`, 500);
      }
      return;
    }

    // DELETE /api/traces — delete all trace sessions, turn files, and screenshots
    if (url.pathname === "/api/traces" && req.method === "DELETE") {
      try {
        let deleted = 0;
        const removeDirFiles = (
          dir: string,
          filter: (f: string) => boolean,
        ) => {
          if (!existsSync(dir)) return;
          for (const file of readdirSync(dir)) {
            if (filter(file)) {
              try {
                unlinkSync(join(dir, file));
                deleted++;
              } catch {
                /* ignore */
              }
            }
          }
        };
        // Trace session files + index
        removeDirFiles(TRACE_DIR, (f) => f.endsWith(".jsonl"));
        // Screenshots
        removeDirFiles(SCREENSHOT_DIR, () => true);
        // Per-session log files (not the main log)
        removeDirFiles(
          LOG_DIR,
          (f) => f.startsWith("session-") && f.endsWith(".jsonl"),
        );
        // Run traces
        removeDirFiles(RUN_TRACE_DIR, (f) => f.endsWith(".jsonl"));

        invalidateTraceViewerCaches();
        sendJson(res, { deleted });
      } catch (err) {
        sendText(res, `Delete error: ${err}`, 500);
      }
      return;
    }

    // GET /api/traces/days — list day buckets with counts
    if (url.pathname === "/api/traces/days" && req.method === "GET") {
      try {
        const sessions = await readAllTraceSessions();
        const counts = new Map<string, number>();
        for (const s of sessions) {
          if (typeof s.startTime !== "number" || !Number.isFinite(s.startTime))
            continue;
          const key = localDayKey(s.startTime);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        const days = Array.from(counts.entries())
          .map(([day, count]) => ({ day, count }))
          .sort((a, b) => b.day.localeCompare(a.day));
        sendJson(res, days);
      } catch (err) {
        sendText(res, `Error reading trace days: ${err}`, 500);
      }
      return;
    }

    // GET /api/traces/models — list unique model names with counts
    if (url.pathname === "/api/traces/models" && req.method === "GET") {
      try {
        const sessions = await readAllTraceSessions();
        const counts = new Map<string, number>();
        for (const s of sessions) {
          for (const m of getSessionModels(s)) {
            if (m === "recording" || m === "manual") continue;
            counts.set(m, (counts.get(m) || 0) + 1);
          }
        }
        const result = Array.from(counts.entries())
          .map(([model, count]) => ({ model, count }))
          .sort((a, b) => b.count - a.count);
        sendJson(res, result);
      } catch (err) {
        sendText(res, `Error reading trace models: ${err}`, 500);
      }
      return;
    }

    // GET /api/trace-insights — aggregate sessions, tools, skills, runs, models, failures, events
    if (url.pathname === "/api/trace-insights" && req.method === "GET") {
      try {
        // Stable cache key: sorted query-string so param order doesn't matter.
        const cacheKey = Array.from(url.searchParams.entries())
          .filter(([, v]) => v !== "" && v !== "all")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join("&");

        if (
          insightsCache &&
          insightsCache.key === cacheKey &&
          Date.now() - insightsCache.ts < INSIGHTS_CACHE_TTL_MS
        ) {
          setCorsHeaders(res, req.headers.origin);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(insightsCache.payload);
          return;
        }

        const filters = traceInsightsFilters(url.searchParams);
        let sqliteInsights = null;
        const indexStatus = getTraceIndexStatus(PROJECT_ROOT);
        // Aggregates use the SQLite index — a DERIVED projection of the spine
        // (rebuildable from it; parity-verified), which keeps insights fast. The
        // opt-in OBS_SPINE_READS=1 forces the slow spine-direct JS path below
        // (for when the index is unavailable). Default = fast derived index.
        if (process.env.OBS_SPINE_READS !== "1") {
          try {
            sqliteInsights = buildTraceInsightsFromSqlite(PROJECT_ROOT, filters);
          } catch (err) {
            console.warn("SQLite trace insights failed:", err);
            if (indexStatus.available) {
              sendText(
                res,
                "SQLite trace index failed while building insights. Rebuild the trace index instead of falling back to the slow JSONL scan.",
                500,
              );
              return;
            }
          }
        }
        if (sqliteInsights) {
          const payload = JSON.stringify(sqliteInsights);
          insightsCache = { key: cacheKey, payload, ts: Date.now() };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(payload);
          return;
        }

        const sessions = await readAllTraceSessions();
        const entriesBySession = new Map<string, TraceEntryLike[]>();
        const runEventsByRun = new Map<string, TraceEntryLike[]>();

        await Promise.all(
          sessions.map(async (session) => {
            const sessionId =
              typeof session.sessionId === "string" ? session.sessionId : "";
            if (sessionId) {
              entriesBySession.set(sessionId, await readTraceEntries(sessionId));
            }
            const runId = typeof session.runId === "string" ? session.runId : "";
            if (runId && !runEventsByRun.has(runId)) {
              runEventsByRun.set(runId, await readRunTraceEvents(runId));
            }
          }),
        );

        const jsonlInsights = buildTraceInsights({
          sessions,
          entriesBySession,
          runEventsByRun,
          filters,
        });
        const payload = JSON.stringify(jsonlInsights);
        insightsCache = { key: cacheKey, payload, ts: Date.now() };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(payload);
      } catch (err) {
        sendText(res, `Error reading trace insights: ${err}`, 500);
      }
      return;
    }

    // GET /api/trace-index/status — SQLite observability index health and coverage
    if (url.pathname === "/api/trace-trends" && req.method === "GET") {
      try {
        const requestedLimit = Number(url.searchParams.get("limit") || "30");
        const trends = buildTraceTrendsFromSqlite(
          PROJECT_ROOT,
          traceInsightsFilters(url.searchParams),
          Number.isFinite(requestedLimit) ? requestedLimit : 30,
        );
        if (!trends) {
          sendText(
            res,
            "Trace trends require the SQLite index. Run pnpm traces:index.",
            503,
          );
          return;
        }
        sendJson(res, trends);
      } catch (err) {
        sendText(res, `Error reading trace trends: ${err}`, 500);
      }
      return;
    }

    if (url.pathname === "/api/trace-index/status" && req.method === "GET") {
      try {
        sendJson(res, getTraceIndexStatus(PROJECT_ROOT));
      } catch (err) {
        sendText(res, `Error reading trace index status: ${err}`, 500);
      }
      return;
    }

    // GET /api/harness-ratchet — repeated trace failures that should become harness work
    if (url.pathname === "/api/harness-ratchet" && req.method === "GET") {
      try {
        sendJson(res, buildHarnessRatchetCandidates(PROJECT_ROOT));
      } catch (err) {
        sendText(res, `Error reading harness ratchet candidates: ${err}`, 500);
      }
      return;
    }

    // GET /api/traces/search — filter sessions by day/domain/outcome/session/query/mode/model
    if (url.pathname === "/api/traces/search" && req.method === "GET") {
      try {
        const day = url.searchParams.get("day");
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const domain = (
          url.searchParams.get("domain") ||
          url.searchParams.get("website") ||
          ""
        )
          .toLowerCase()
          .trim();
        const outcome = (url.searchParams.get("outcome") || "").trim();
        const sessionPrefix = (
          url.searchParams.get("sessionIdPrefix") || ""
        ).trim();
        const mode = (url.searchParams.get("mode") || "").trim();
        const model = (url.searchParams.get("model") || "").trim();
        const skill = (url.searchParams.get("skill") || "").trim();
        const tier = (url.searchParams.get("tier") || "").trim();
        const q = (url.searchParams.get("q") || "").toLowerCase().trim();
        const runId = (url.searchParams.get("runId") || "").trim();
        const cursor = (url.searchParams.get("cursor") || "").trim();
        const withMeta = url.searchParams.get("meta") === "1";
        const limitRaw = Number(url.searchParams.get("limit") || "200");
        const limit = Number.isFinite(limitRaw)
          ? Math.max(1, Math.min(5000, Math.floor(limitRaw)))
          : 200;

        const baseFilters: TraceSearchFiltersLike = {
          day,
          from,
          to,
          domain,
          outcome,
          sessionPrefix,
          mode,
          model,
          skill,
          tier,
          q,
          runId,
        };

        const sqlitePage = searchTraceSessionsFromSqlite(
          PROJECT_ROOT,
          baseFilters,
          { limit, cursor },
        );
        if (sqlitePage) {
          const items = sqlitePage.items.map(serializeTraceSearchSession);
          if (withMeta) {
            sendJson(res, {
              items,
              total: sqlitePage.total,
              returned: items.length,
              hasMore: sqlitePage.hasMore,
              nextCursor: sqlitePage.nextCursor,
            });
          } else {
            sendJson(res, items);
          }
          return;
        }

        let sessions = await readAllTraceSessions();
        sessions = sessions.filter((s) => matchesTraceFilters(s, baseFilters));

        if (tier && tier !== "all") {
          const withEntries = await Promise.all(
            sessions.map(async (session) => {
              if (
                typeof session.sessionId !== "string" ||
                session.sessionId.length === 0
              ) {
                return session;
              }
              return {
                ...session,
                _entries: await readTraceEntries(session.sessionId),
              };
            }),
          );
          sessions = withEntries.filter((s) =>
            matchesTraceFilters(s, { ...baseFilters, tier }, s._entries),
          );
        }

        sessions.sort((a, b) => {
          const t = (b.startTime ?? 0) - (a.startTime ?? 0);
          if (t !== 0) return t;
          return String(a.sessionId || "").localeCompare(
            String(b.sessionId || ""),
          );
        });
        let filtered = sessions;
        if (cursor) {
          const sep = cursor.indexOf("|");
          if (sep > 0) {
            const cursorStart = Number(cursor.slice(0, sep));
            const cursorSession = cursor.slice(sep + 1);
            if (Number.isFinite(cursorStart)) {
              filtered = sessions.filter((s) => {
                const st = typeof s.startTime === "number" ? s.startTime : 0;
                const sid = typeof s.sessionId === "string" ? s.sessionId : "";
                if (st < cursorStart) return true;
                if (st > cursorStart) return false;
                return sid > cursorSession;
              });
            }
          }
        }

        const page = filtered.slice(0, limit);
        const sliced = page.map(serializeTraceSearchSession);
        const nextCursor =
          filtered.length > limit && page.length > 0
            ? `${page[page.length - 1].startTime || 0}|${page[page.length - 1].sessionId || ""}`
            : null;

        if (withMeta) {
          sendJson(res, {
            items: sliced,
            total: sessions.length,
            returned: sliced.length,
            hasMore: Boolean(nextCursor),
            nextCursor,
          });
          return;
        }
        sendJson(res, sliced);
      } catch (err) {
        sendText(res, `Error searching traces: ${err}`, 500);
      }
      return;
    }

    // GET /api/traces/:sessionId — get all turns for a session
    const runRawMatch = url.pathname.match(
      /^\/api\/run-traces\/([a-zA-Z0-9_-]+)\/raw-jsonl$/,
    );
    if (runRawMatch && req.method === "GET") {
      try {
        const runId = runRawMatch[1];
        const sqliteLines = readRunRawJsonlFromSqlite(PROJECT_ROOT, runId);
        if (sqliteLines && sqliteLines.length > 0) {
          sendText(res, `${sqliteLines.join("\n")}\n`, 200);
          return;
        }
        const traceFile = join(RUN_TRACE_DIR, `${runId}.jsonl`);
        if (!existsSync(traceFile)) {
          sendText(res, "", 404);
          return;
        }
        sendFile(res, traceFile, "application/x-ndjson; charset=utf-8");
      } catch (err) {
        sendText(res, `Error reading raw run trace: ${err}`, 500);
      }
      return;
    }

    const traceRawMatch = url.pathname.match(
      /^\/api\/traces\/([a-zA-Z0-9_-]+)\/raw-jsonl$/,
    );
    if (traceRawMatch && req.method === "GET") {
      try {
        const sessionId = traceRawMatch[1];
        const sqliteLines = readTraceRawJsonlFromSqlite(PROJECT_ROOT, sessionId);
        if (sqliteLines && sqliteLines.length > 0) {
          sendText(res, `${sqliteLines.join("\n")}\n`, 200);
          return;
        }
        const traceFile = join(TRACE_DIR, `${sessionId}.jsonl`);
        if (!existsSync(traceFile)) {
          sendText(res, "", 404);
          return;
        }
        sendFile(res, traceFile, "application/x-ndjson; charset=utf-8");
      } catch (err) {
        sendText(res, `Error reading raw trace: ${err}`, 500);
      }
      return;
    }

    const runTraceMatch = url.pathname.match(
      /^\/api\/run-traces\/([a-zA-Z0-9_-]+)$/,
    );
    if (runTraceMatch && req.method === "GET") {
      try {
        const runId = runTraceMatch[1];
        const events = (await readRunTraceEvents(runId)).sort((a, b) =>
            String((a as any).ts ?? (a as any).recordedAt ?? "").localeCompare(
              String((b as any).ts ?? (b as any).recordedAt ?? ""),
            ),
        );
        sendJson(res, events);
      } catch (err) {
        sendText(res, `Error reading run trace: ${err}`, 500);
      }
      return;
    }

    const traceMatch = url.pathname.match(/^\/api\/traces\/([a-zA-Z0-9_-]+)$/);
    if (traceMatch && req.method === "GET") {
      try {
        const sessionId = traceMatch[1];
        const entries = await readTraceEntries(sessionId);
        sendJson(res, entries);
      } catch (err) {
        sendText(res, `Error reading trace: ${err}`, 500);
      }
      return;
    }

    // GET /api/traces/:sessionId/rl-trajectory — OpenClaw (state,action,reward) projection
    const rlTrajectoryMatch = url.pathname.match(
      /^\/api\/traces\/([a-zA-Z0-9_-]+)\/rl-trajectory$/,
    );
    if (rlTrajectoryMatch && req.method === "GET") {
      try {
        const sessionId = rlTrajectoryMatch[1];
        const trajectory = getRlTrajectory(traceRepository, sessionId);
        if (!trajectory) {
          sendText(res, `No trajectory for session ${sessionId}`, 404);
          return;
        }
        sendJson(res, trajectory);
      } catch (err) {
        sendText(res, `Error building RL trajectory: ${err}`, 500);
      }
      return;
    }

    // GET /api/traces/:sessionId/screenshots/:turn — serve screenshot image
    // Supports both primary (T3) and panoramic (T3-pan0) filenames
    const screenshotMatch = url.pathname.match(
      /^\/api\/traces\/([a-zA-Z0-9_-]+)\/screenshots\/(\d+(?:-pan\d+)?)$/,
    );
    if (screenshotMatch && req.method === "GET") {
      const sessionId = screenshotMatch[1];
      const turn = screenshotMatch[2];
      const filepath = join(SCREENSHOT_DIR, `${sessionId}-T${turn}.jpg`);
      if (!existsSync(filepath)) {
        sendText(res, "Screenshot not found", 404);
        return;
      }
      sendFile(res, filepath, "image/jpeg", {
        "Cache-Control": "public, max-age=86400",
      });
      return;
    }

    // GET /api/logs/:sessionId — get all logs for a trace session
    const logSessionMatch = url.pathname.match(
      /^\/api\/logs\/([a-zA-Z0-9_-]+)$/,
    );
    if (logSessionMatch && req.method === "GET") {
      try {
        const sessionId = logSessionMatch[1];
        const sessionLogFile = join(LOG_DIR, `session-${sessionId}.jsonl`);
        if (!existsSync(sessionLogFile)) {
          sendJson(res, []);
          return;
        }
        const raw = await readFile(sessionLogFile, "utf-8");
        const entries = raw
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        // Optional level filter
        const level = (url.searchParams.get("level") || "").toUpperCase();
        const filtered = level
          ? entries.filter((e: Record<string, unknown>) => e.lvl === level)
          : entries;

        sendJson(res, filtered);
      } catch (err) {
        sendText(res, `Error reading session logs: ${err}`, 500);
      }
      return;
    }

    // GET /assets/* — serve built viewer assets from the viewer build root
    if (url.pathname.startsWith("/assets/") && req.method === "GET") {
      for (const distDir of VIEWER_BUILD_ROOTS) {
        const filePath = resolve(
          distDir,
          ...url.pathname.split("/").filter(Boolean),
        );
        if (!filePath.startsWith(distDir)) {
          sendText(res, "Forbidden", 403);
          return;
        }
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const ext = extname(filePath);
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          sendFile(res, filePath, contentType, {
            "Cache-Control": "public, max-age=31536000, immutable",
          });
          return;
        }
      }
      sendText(res, "Asset not found", 404);
      return;
    }

    // GET /viewer* — serve the built React trace viewer
    if (url.pathname.startsWith("/viewer") && req.method === "GET") {
      try {
        const buildRoot = resolveViewerBuildRoot();
        if (!buildRoot) {
          sendText(
            res,
            "Trace viewer not found. It is a dev-only page stripped from the production dist/, " +
              "so build the dev-surface bundle first: 'pnpm exec nx run extension:build-e2e' " +
              "(or keep 'pnpm run dev' running). Expected at: " +
              join(VIEWER_BUILD_ROOTS[0], "src", "trace-viewer"),
            404,
          );
          return;
        }
        const viewerDir = join(buildRoot, "src", "trace-viewer");

        // Strip /viewer prefix to get the sub-path
        let subPath = url.pathname.slice("/viewer".length);
        if (subPath === "" || subPath === "/") subPath = "/index.html";

        const filePath = resolve(
          viewerDir,
          ...subPath.split("/").filter(Boolean),
        );
        if (!filePath.startsWith(viewerDir)) {
          sendText(res, "Forbidden", 403);
          return;
        }
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const ext = extname(filePath);
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          sendFile(res, filePath, contentType);
          return;
        }

        // SPA fallback — serve index.html for unknown sub-paths
        const html = await readFile(join(viewerDir, "index.html"), "utf-8");
        setCorsHeaders(res);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (err) {
        sendText(res, `Error serving viewer: ${err}`, 500);
      }
      return;
    }

    // GET /api/skills — list all skill descriptors
    if (url.pathname === "/api/skills" && req.method === "GET") {
      try {
        const skills = listSkillDescriptors();
        sendJson(res, skills);
      } catch (err) {
        sendText(res, `Error reading skills: ${err}`, 500);
      }
      return;
    }

    // GET /api/skills/:skillId — get full skill contract
    const skillMatch = url.pathname.match(/^\/api\/skills\/([a-zA-Z0-9_-]+)$/);
    if (skillMatch && req.method === "GET") {
      try {
        const skillId = skillMatch[1];
        const contract = getLoadedSkillContract(skillId);
        if (!contract) {
          sendJson(res, { error: "Skill not found" }, 404);
          return;
        }
        sendJson(res, contract);
      } catch (err) {
        sendText(res, `Error reading skill: ${err}`, 500);
      }
      return;
    }

    // GET /api/annotations — human adjudication verdicts (latest per run).
    // Optional ?sessionId= / ?runId= filters; no params → the whole deduped set
    // (the fleet uses that to badge every row).
    if (url.pathname === "/api/annotations" && req.method === "GET") {
      try {
        const sessionId = url.searchParams.get("sessionId");
        const runId = url.searchParams.get("runId");
        let records: RunAnnotationRecord[] = [];
        if (existsSync(ANNOTATIONS_FILE)) {
          records = dedupeAnnotationsLatestWins(
            parseAnnotationsJsonl(await readFile(ANNOTATIONS_FILE, "utf-8")),
          );
        }
        if (runId) records = records.filter((r) => r.runId === runId);
        else if (sessionId)
          records = records.filter((r) => r.sessionId === sessionId);
        sendJson(res, records);
      } catch (err) {
        sendText(res, `Annotation read error: ${err}`, 500);
      }
      return;
    }

    // POST /api/annotations — append one human verdict. The server stamps the
    // id + annotatedAt (trusted clock); latest-per-run wins on read.
    if (url.pathname === "/api/annotations" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const norm = normalizeAnnotationInput(body);
        if (!norm.ok) {
          sendText(res, norm.error, 400);
          return;
        }
        const record: RunAnnotationRecord = {
          ...norm.value,
          id: randomUUID(),
          annotatedAt: new Date().toISOString(),
        };
        if (!existsSync(EVALS_DIR)) mkdirSync(EVALS_DIR, { recursive: true });
        await appendFile(ANNOTATIONS_FILE, JSON.stringify(record) + "\n");
        sendJson(res, record);
      } catch (err) {
        sendText(res, `Annotation save error: ${err}`, 500);
      }
      return;
    }

    // Golden dataset endpoint — save EvalCase JSONL to evals/golden/
    if (url.pathname === "/golden" && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const rawName = body?.name;
        const cases = body?.cases;
        if (!rawName || typeof rawName !== "string" || !Array.isArray(cases)) {
          sendText(res, "Expected { name: string, cases: EvalCase[] }", 400);
          return;
        }
        const safeName = rawName
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "-")
          .replace(/-+/g, "-");
        const filename = `${safeName}.jsonl`;
        const filepath = join(GOLDEN_DIR, filename);
        const lines =
          cases.map((c: unknown) => JSON.stringify(c)).join("\n") + "\n";
        await writeFile(filepath, lines);
        sendJson(res, { filename, caseCount: cases.length });
      } catch (err) {
        sendText(res, `Golden save error: ${err}`, 500);
      }
      return;
    }

    sendText(res, "Not found", 404);
  },
);

server.listen(PORT, HOST, () => {
  console.log(`Local server listening on http://${HOST}:${PORT}`);
  console.log(`Writing to ${LOG_FILE}`);
  console.log(`Traces to ${TRACE_DIR}`);
  console.log(`Trace viewer: http://${HOST}:${PORT}/viewer`);
  console.log(`Press Ctrl+C to stop\n`);
  // Bluebox OTLP export of the span spine — default-off, never load-bearing.
  initSpineOtelExport()
    .then((on) => {
      if (on) console.log("[obs] Spine OTLP export to Bluebox enabled");
    })
    .catch(() => {});
  if (process.env.LOG_SERVER_SKIP_TRACE_WARMUP !== "1") {
    readAllTraceSessions().catch((err) => {
      console.warn("Trace viewer session cache warmup failed:", err);
    });
  }
});

function hasTraceTurn(
  traceFile: string,
  entry: Record<string, unknown>,
): boolean {
  const turnId = typeof entry.turnId === "string" ? entry.turnId : "";
  const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : "";
  const turnNumber =
    typeof entry.turnNumber === "number" ? entry.turnNumber : null;
  if (!existsSync(traceFile) || (!turnId && (!sessionId || turnNumber == null))) {
    return false;
  }

  try {
    const lines = readFileSync(traceFile, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as Record<string, unknown>;
      if (turnId && record.turnId === turnId) return true;
      if (
        !turnId &&
        record.sessionId === sessionId &&
        record.turnNumber === turnNumber
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

const shutdown = (signal: string) => {
  console.log(`\n[local-server] Received ${signal}. Shutting down...`);
  // Best-effort flush of queued OTLP spans within the 2s grace window.
  void flushSpineOtelExport().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
