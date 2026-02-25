/**
 * Log Drain Server — receives log entries from the extension via HTTP
 * and appends them to a JSONL file for querying.
 *
 * Usage: npx tsx scripts/log-server.ts
 * Or:    npm run logs
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, statSync, renameSync, unlinkSync, readFileSync } from "fs";
import { appendFile, readFile, writeFile } from "fs/promises";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

const PORT = Number(process.env.LOG_SERVER_PORT) || 7589;
const HOST = "127.0.0.1";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const LOG_DIR = join(PROJECT_ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "opensidebar.jsonl");
const TRACE_DIR = join(PROJECT_ROOT, "traces");
const TRACE_INDEX = join(TRACE_DIR, "index.jsonl");
const RUN_TRACE_DIR = join(TRACE_DIR, "runs");
const RUN_TRACE_INDEX = join(RUN_TRACE_DIR, "index.jsonl");
const GOLDEN_DIR = join(PROJECT_ROOT, "evals", "golden");
const DATA_DIR = join(PROJECT_ROOT, "data");
const SKILLS_FILE = join(DATA_DIR, "skills.json");
const MEMORY_FILE = join(DATA_DIR, "memory.json");
const SCREENSHOT_DIR = join(TRACE_DIR, "screenshots");
const VIEWER_DIR = join(PROJECT_ROOT, "dist", "src", "trace-viewer");
const TRACE_SCHEMA_VERSION = "2026-02-19" as const;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ROTATED = 5;

let entryCount = 0;
let traceEntryCount = 0;

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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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

function sendText(res: ServerResponse, text: string, status = 500): void {
  setCorsHeaders(res);
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
}

function sendFile(res: ServerResponse, filePath: string, contentType: string, extraHeaders?: Record<string, string>): void {
  setCorsHeaders(res);
  const headers: Record<string, string> = { "Content-Type": contentType, ...extraHeaders };
  res.writeHead(200, headers);
  const data = readFileSync(filePath);
  res.end(data);
}

/* ── Normalization helpers ─────────────────────────────────── */

function toRecordedAt(value: unknown, fallbackMs?: number): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof fallbackMs === "number" && Number.isFinite(fallbackMs)) {
    return new Date(fallbackMs).toISOString();
  }
  return new Date().toISOString();
}

function normalizeAgentTurnRecord(entry: Record<string, unknown>): Record<string, unknown> {
  const runId =
    typeof entry?.runId === "string" && entry.runId.length > 0
      ? entry.runId
      : undefined;
  const sessionId =
    typeof entry?.sessionId === "string" && entry.sessionId.length > 0
      ? entry.sessionId
      : undefined;
  const correlationId =
    typeof entry?.correlationId === "string" && entry.correlationId.length > 0
      ? entry.correlationId
      : runId ?? sessionId;
  return {
    schemaVersion: entry?.schemaVersion ?? TRACE_SCHEMA_VERSION,
    traceKind: entry?.traceKind ?? "agent.turn",
    recordedAt: toRecordedAt(entry?.recordedAt, entry?.timestamp),
    producer: entry?.producer ?? "background.agent.trace-recorder",
    ...(runId ? { runId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(typeof entry?.parentRunId === "string" && entry.parentRunId.length > 0
      ? { parentRunId: entry.parentRunId }
      : runId
        ? { parentRunId: runId }
        : {}),
    ...entry,
  };
}

function normalizeAgentSessionRecord(
  session: Record<string, unknown>,
): Record<string, unknown> {
  const runId =
    typeof session?.runId === "string" && session.runId.length > 0
      ? session.runId
      : undefined;
  const sessionId =
    typeof session?.sessionId === "string" && session.sessionId.length > 0
      ? session.sessionId
      : undefined;
  const correlationId =
    typeof session?.correlationId === "string" && session.correlationId.length > 0
      ? session.correlationId
      : runId ?? sessionId;
  return {
    schemaVersion: session?.schemaVersion ?? TRACE_SCHEMA_VERSION,
    traceKind: session?.traceKind ?? "agent.session",
    recordedAt: toRecordedAt(session?.recordedAt, session?.endTime ?? session?.startTime),
    producer: session?.producer ?? "background.agent.trace-recorder",
    ...(runId ? { runId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(typeof session?.parentRunId === "string" && session.parentRunId.length > 0
      ? { parentRunId: session.parentRunId }
      : runId
        ? { parentRunId: runId }
        : {}),
    ...session,
  };
}

function normalizeRunEventRecord(event: Record<string, unknown>): Record<string, unknown> {
  const runId =
    typeof event?.runId === "string" && event.runId.length > 0
      ? event.runId
      : undefined;
  return {
    schemaVersion: event?.schemaVersion ?? TRACE_SCHEMA_VERSION,
    traceKind: event?.traceKind ?? "orchestrator.run.event",
    recordedAt: toRecordedAt(event?.recordedAt),
    producer: event?.producer ?? "background.orchestrator.run-trace-writer",
    ...(runId ? { runId } : {}),
    ...(typeof event?.correlationId === "string" && event.correlationId.length > 0
      ? { correlationId: event.correlationId }
      : runId
        ? { correlationId: runId }
        : {}),
    ...event,
  };
}

function normalizeRunManifestRecord(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  const runId =
    typeof manifest?.runId === "string" && manifest.runId.length > 0
      ? manifest.runId
      : undefined;
  return {
    schemaVersion: manifest?.schemaVersion ?? TRACE_SCHEMA_VERSION,
    traceKind: manifest?.traceKind ?? "orchestrator.run.manifest",
    recordedAt: toRecordedAt(manifest?.recordedAt),
    producer: manifest?.producer ?? "background.orchestrator.run-trace-writer",
    ...(runId ? { runId } : {}),
    ...(typeof manifest?.correlationId === "string" &&
    manifest.correlationId.length > 0
      ? { correlationId: manifest.correlationId }
      : runId
        ? { correlationId: runId }
        : {}),
    ...manifest,
  };
}

type TraceSessionLike = Record<string, unknown> & {
  startTime?: number;
  startUrl?: string;
  outcome?: string;
  sessionId?: string;
  query?: string;
};

function localDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isIsoDay(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function extractDomain(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  try {
    const host = new URL(rawUrl).hostname || "";
    return host.toLowerCase() || null;
  } catch {
    return null;
  }
}

async function readAllTraceSessions(): Promise<TraceSessionLike[]> {
  if (!existsSync(TRACE_INDEX)) return [];
  const raw = await readFile(TRACE_INDEX, "utf-8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return normalizeAgentSessionRecord(JSON.parse(line)) as TraceSessionLike;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as TraceSessionLike[];
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
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

/* ── Skills & Memory file helpers ─────────────────────────────── */

interface SkillRecord {
  id: string;
  [key: string]: unknown;
}

interface MemoryRecord {
  id: string;
  [key: string]: unknown;
}

async function readSkills(): Promise<SkillRecord[]> {
  try {
    if (!existsSync(SKILLS_FILE)) return [];
    const raw = await readFile(SKILLS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSkills(skills: SkillRecord[]): Promise<void> {
  await writeFile(SKILLS_FILE, JSON.stringify(skills, null, 2));
}

async function readMemoryEntries(): Promise<MemoryRecord[]> {
  try {
    if (!existsSync(MEMORY_FILE)) return [];
    const raw = await readFile(MEMORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeMemoryEntries(entries: MemoryRecord[]): Promise<void> {
  await writeFile(MEMORY_FILE, JSON.stringify(entries, null, 2));
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

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

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
      const lines = body.map((entry: unknown) => JSON.stringify(entry)).join("\n") + "\n";
      await appendFile(LOG_FILE, lines);
      entryCount += body.length;

      // Also write session-scoped entries to per-session files for correlation
      const bySession = new Map<string, unknown[]>();
      for (const entry of body) {
        const sid = (entry as Record<string, unknown>)?.sid;
        if (typeof sid === "string" && sid.length > 0) {
          let list = bySession.get(sid);
          if (!list) { list = []; bySession.set(sid, list); }
          list.push(entry);
        }
      }
      for (const [sid, entries] of bySession) {
        const sessionLogFile = join(LOG_DIR, `session-${sid}.jsonl`);
        const sessionLines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
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
      const traceFile = join(TRACE_DIR, `${sessionId}.jsonl`);
      await appendFile(traceFile, JSON.stringify(entry) + "\n");
      traceEntryCount++;
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
        return String(a.sessionId || "").localeCompare(String(b.sessionId || ""));
      });
      sendJson(res, sessions);
    } catch (err) {
      sendText(res, `Error reading traces: ${err}`, 500);
    }
    return;
  }

  // GET /api/traces/days — list day buckets with counts
  if (url.pathname === "/api/traces/days" && req.method === "GET") {
    try {
      const sessions = await readAllTraceSessions();
      const counts = new Map<string, number>();
      for (const s of sessions) {
        if (typeof s.startTime !== "number" || !Number.isFinite(s.startTime)) continue;
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

  // GET /api/traces/search — filter sessions by day/domain/outcome/session/query
  if (url.pathname === "/api/traces/search" && req.method === "GET") {
    try {
      const day = url.searchParams.get("day");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const domain = (url.searchParams.get("domain") || url.searchParams.get("website") || "").toLowerCase().trim();
      const outcome = (url.searchParams.get("outcome") || "").trim();
      const sessionPrefix = (url.searchParams.get("sessionIdPrefix") || "").trim();
      const q = (url.searchParams.get("q") || "").toLowerCase().trim();
      const cursor = (url.searchParams.get("cursor") || "").trim();
      const withMeta = url.searchParams.get("meta") === "1";
      const limitRaw = Number(url.searchParams.get("limit") || "200");
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(5000, Math.floor(limitRaw)))
        : 200;

      let sessions = await readAllTraceSessions();

      sessions = sessions.filter((s) => {
        const startTime = typeof s.startTime === "number" ? s.startTime : null;
        const domainValue = extractDomain(s.startUrl);
        const dayValue = startTime != null ? localDayKey(startTime) : null;
        const sessionId = typeof s.sessionId === "string" ? s.sessionId : "";
        const query = typeof s.query === "string" ? s.query.toLowerCase() : "";
        const startUrl = typeof s.startUrl === "string" ? s.startUrl.toLowerCase() : "";
        const outcomeValue = typeof s.outcome === "string" ? s.outcome : "";

        if (day && day !== "all" && dayValue !== day) return false;
        if (isIsoDay(from) && (!dayValue || dayValue < from)) return false;
        if (isIsoDay(to) && (!dayValue || dayValue > to)) return false;
        if (domain) {
          if (!domainValue) return false;
          if (!domainValue.includes(domain)) return false;
        }
        if (outcome && outcome !== "all" && outcomeValue !== outcome) return false;
        if (sessionPrefix && !sessionId.startsWith(sessionPrefix)) return false;
        if (q && !(query.includes(q) || startUrl.includes(q) || sessionId.includes(q.toLowerCase()))) return false;
        return true;
      });

      sessions.sort((a, b) => {
        const t = (b.startTime ?? 0) - (a.startTime ?? 0);
        if (t !== 0) return t;
        return String(a.sessionId || "").localeCompare(String(b.sessionId || ""));
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
      const sliced = page.map((s) => ({
        ...s,
        day: typeof s.startTime === "number" ? localDayKey(s.startTime) : null,
        domain: extractDomain(s.startUrl),
      }));
      const nextCursor = filtered.length > limit && page.length > 0
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
  const traceMatch = url.pathname.match(/^\/api\/traces\/([a-zA-Z0-9_-]+)$/);
  if (traceMatch && req.method === "GET") {
    try {
      const sessionId = traceMatch[1];
      const traceFile = join(TRACE_DIR, `${sessionId}.jsonl`);
      if (!existsSync(traceFile)) {
        sendJson(res, []);
        return;
      }
      const raw = await readFile(traceFile, "utf-8");
      const entries = raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .map((entry) => (entry ? normalizeAgentTurnRecord(entry) : null))
        .filter(Boolean);
      sendJson(res, entries);
    } catch (err) {
      sendText(res, `Error reading trace: ${err}`, 500);
    }
    return;
  }

  // GET /api/traces/:sessionId/screenshots/:turn — serve screenshot image
  const screenshotMatch = url.pathname.match(
    /^\/api\/traces\/([a-zA-Z0-9_-]+)\/screenshots\/(\d+)$/,
  );
  if (screenshotMatch && req.method === "GET") {
    const sessionId = screenshotMatch[1];
    const turn = screenshotMatch[2];
    const filepath = join(SCREENSHOT_DIR, `${sessionId}-T${turn}.jpg`);
    if (!existsSync(filepath)) {
      sendText(res, "Screenshot not found", 404);
      return;
    }
    sendFile(res, filepath, "image/jpeg", { "Cache-Control": "public, max-age=86400" });
    return;
  }

  // GET /api/logs/:sessionId — get all logs for a trace session
  const logSessionMatch = url.pathname.match(/^\/api\/logs\/([a-zA-Z0-9_-]+)$/);
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
          try { return JSON.parse(line); } catch { return null; }
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

  // GET /assets/* — serve built viewer assets from dist/assets/
  if (url.pathname.startsWith("/assets/") && req.method === "GET") {
    const distDir = join(PROJECT_ROOT, "dist");
    const filePath = join(distDir, ...url.pathname.split("/").filter(Boolean));
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      sendFile(res, filePath, contentType, { "Cache-Control": "public, max-age=31536000, immutable" });
      return;
    }
    sendText(res, "Asset not found", 404);
    return;
  }

  // GET /viewer* — serve the built React trace viewer
  if (url.pathname.startsWith("/viewer") && req.method === "GET") {
    try {
      // Strip /viewer prefix to get the sub-path
      let subPath = url.pathname.slice("/viewer".length);
      if (subPath === "" || subPath === "/") subPath = "/index.html";

      const filePath = join(VIEWER_DIR, ...subPath.split("/").filter(Boolean));
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        sendFile(res, filePath, contentType);
        return;
      }

      // SPA fallback — serve index.html for unknown sub-paths
      const indexPath = join(VIEWER_DIR, "index.html");
      if (existsSync(indexPath)) {
        const html = await readFile(indexPath, "utf-8");
        setCorsHeaders(res);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      sendText(res,
        "Trace viewer not found. Run 'npm run build' first. Expected at: " + VIEWER_DIR,
        404,
      );
    } catch (err) {
      sendText(res, `Error serving viewer: ${err}`, 500);
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
      const safeName = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
      const filename = `${safeName}.jsonl`;
      const filepath = join(GOLDEN_DIR, filename);
      const lines = cases.map((c: unknown) => JSON.stringify(c)).join("\n") + "\n";
      await writeFile(filepath, lines);
      sendJson(res, { filename, caseCount: cases.length });
    } catch (err) {
      sendText(res, `Golden save error: ${err}`, 500);
    }
    return;
  }

  // --- Skills API ---

  // POST /api/skills/sync — bulk replace all skills (extension pushes full list)
  if (url.pathname === "/api/skills/sync" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      if (!Array.isArray(body)) {
        sendText(res, "Expected JSON array", 400);
        return;
      }
      await writeSkills(body);
      sendJson(res, { count: body.length });
    } catch (err) {
      sendText(res, `Skills sync error: ${err}`, 500);
    }
    return;
  }

  // GET /api/skills — list all skills
  if (url.pathname === "/api/skills" && req.method === "GET") {
    try {
      const skills = await readSkills();
      sendJson(res, skills);
    } catch (err) {
      sendText(res, `Skills read error: ${err}`, 500);
    }
    return;
  }

  // PUT /api/skills/:id — update a skill
  const skillPutMatch = url.pathname.match(/^\/api\/skills\/([a-zA-Z0-9_-]+)$/);
  if (skillPutMatch && req.method === "PUT") {
    try {
      const skillId = skillPutMatch[1];
      const updates = await parseJsonBody(req);
      const skills = await readSkills();
      const idx = skills.findIndex((s) => s.id === skillId);
      if (idx === -1) {
        sendText(res, "Skill not found", 404);
        return;
      }
      // Merge allowed fields
      const allowed = ["name", "enabled", "pinned"];
      for (const key of allowed) {
        if (key in updates) {
          skills[idx][key] = updates[key];
        }
      }
      skills[idx].updatedAt = Date.now();
      await writeSkills(skills);
      sendJson(res, skills[idx]);
    } catch (err) {
      sendText(res, `Skills update error: ${err}`, 500);
    }
    return;
  }

  // DELETE /api/skills/:id — delete a skill
  const skillDeleteMatch = url.pathname.match(/^\/api\/skills\/([a-zA-Z0-9_-]+)$/);
  if (skillDeleteMatch && req.method === "DELETE") {
    try {
      const skillId = skillDeleteMatch[1];
      const skills = await readSkills();
      const next = skills.filter((s) => s.id !== skillId);
      if (next.length === skills.length) {
        sendText(res, "Skill not found", 404);
        return;
      }
      await writeSkills(next);
      sendEmpty(res, 204);
    } catch (err) {
      sendText(res, `Skills delete error: ${err}`, 500);
    }
    return;
  }

  // --- Memory API ---

  // POST /api/memory/sync — bulk replace all memory entries (extension pushes)
  if (url.pathname === "/api/memory/sync" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      if (!Array.isArray(body)) {
        sendText(res, "Expected JSON array", 400);
        return;
      }
      await writeMemoryEntries(body);
      sendJson(res, { count: body.length });
    } catch (err) {
      sendText(res, `Memory sync error: ${err}`, 500);
    }
    return;
  }

  // GET /api/memory — list all memory entries (optional ?category= filter)
  if (url.pathname === "/api/memory" && req.method === "GET") {
    try {
      let entries = await readMemoryEntries();
      const category = (url.searchParams.get("category") || "").trim();
      const q = (url.searchParams.get("q") || "").toLowerCase().trim();
      if (category) {
        entries = entries.filter((e) => String(e.category || "").toLowerCase() === category.toLowerCase());
      }
      if (q) {
        entries = entries.filter((e) =>
          String(e.content || "").toLowerCase().includes(q) ||
          String(e.category || "").toLowerCase().includes(q) ||
          String(e.sourceUrl || "").toLowerCase().includes(q),
        );
      }
      sendJson(res, entries);
    } catch (err) {
      sendText(res, `Memory read error: ${err}`, 500);
    }
    return;
  }

  // GET /api/memory/categories — list categories with counts
  if (url.pathname === "/api/memory/categories" && req.method === "GET") {
    try {
      const entries = await readMemoryEntries();
      const counts = new Map<string, number>();
      for (const e of entries) {
        const cat = String(e.category || "uncategorized");
        counts.set(cat, (counts.get(cat) || 0) + 1);
      }
      const categories = Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      sendJson(res, categories);
    } catch (err) {
      sendText(res, `Memory categories error: ${err}`, 500);
    }
    return;
  }

  // DELETE /api/memory/:id — delete a memory entry
  const memDeleteMatch = url.pathname.match(/^\/api\/memory\/([a-zA-Z0-9_-]+)$/);
  if (memDeleteMatch && req.method === "DELETE") {
    try {
      const memId = memDeleteMatch[1];
      const entries = await readMemoryEntries();
      const next = entries.filter((e) => e.id !== memId);
      if (next.length === entries.length) {
        sendText(res, "Memory entry not found", 404);
        return;
      }
      await writeMemoryEntries(next);
      sendEmpty(res, 204);
    } catch (err) {
      sendText(res, `Memory delete error: ${err}`, 500);
    }
    return;
  }

  sendText(res, "Not found", 404);
});

server.listen(PORT, HOST, () => {
  console.log(`Log server listening on http://${HOST}:${PORT}`);
  console.log(`Writing to ${LOG_FILE}`);
  console.log(`Traces to ${TRACE_DIR}`);
  console.log(`Trace viewer: http://${HOST}:${PORT}/viewer`);
  console.log(`Press Ctrl+C to stop\n`);
});
