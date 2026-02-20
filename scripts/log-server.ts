/**
 * Log Drain Server — receives log entries from the extension via HTTP
 * and appends them to a JSONL file for querying.
 *
 * Usage: bun run scripts/log-server.ts
 * Or:    bun run logs
 */

import { existsSync, mkdirSync, statSync, renameSync, unlinkSync } from "fs";
import { appendFile, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";

const PORT = Number(process.env.LOG_SERVER_PORT) || 7589;
const HOST = "127.0.0.1";
const PROJECT_ROOT = join(dirname(import.meta.dir));
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
const VIEWER_HTML = join(dirname(import.meta.dir), "scripts", "trace-viewer.html");
const TRACE_SCHEMA_VERSION = "2026-02-19" as const;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ROTATED = 5;

let entryCount = 0;
let traceEntryCount = 0;

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
        const entry = normalizeAgentTurnRecord(await req.json());
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
        const session = normalizeAgentSessionRecord(await req.json());
        await appendFile(TRACE_INDEX, JSON.stringify(session) + "\n");
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Trace session error: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    // Orchestrator run-trace event endpoint
    if (url.pathname === "/run-traces" && req.method === "POST") {
      try {
        const event = normalizeRunEventRecord(await req.json());
        const runId = event?.runId;
        if (!runId || typeof runId !== "string") {
          return new Response("Missing runId", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
        const traceFile = join(RUN_TRACE_DIR, `${runId}.jsonl`);
        await appendFile(traceFile, JSON.stringify(event) + "\n");
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Run trace error: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    // Orchestrator run-trace manifest endpoint
    if (url.pathname === "/run-traces/session" && req.method === "POST") {
      try {
        const manifest = normalizeRunManifestRecord(await req.json());
        await appendFile(RUN_TRACE_INDEX, JSON.stringify(manifest) + "\n");
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Run manifest error: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
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
        return Response.json(sessions, { headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Error reading traces: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
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
        return Response.json(days, { headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Error reading trace days: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
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
          return Response.json(
            {
              items: sliced,
              total: sessions.length,
              returned: sliced.length,
              hasMore: Boolean(nextCursor),
              nextCursor,
            },
            { headers: CORS_HEADERS },
          );
        }
        return Response.json(sliced, { headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Error searching traces: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    // GET /api/traces/:sessionId — get all turns for a session
    const traceMatch = url.pathname.match(/^\/api\/traces\/([a-zA-Z0-9_-]+)$/);
    if (traceMatch && req.method === "GET") {
      try {
        const sessionId = traceMatch[1];
        const traceFile = join(TRACE_DIR, `${sessionId}.jsonl`);
        if (!existsSync(traceFile)) {
          return Response.json([], { headers: CORS_HEADERS });
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
        return Response.json(entries, { headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Error reading trace: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    // GET /viewer — serve the trace viewer HTML
    if (url.pathname === "/viewer" && req.method === "GET") {
      try {
        if (!existsSync(VIEWER_HTML)) {
          return new Response("Trace viewer HTML not found. Expected at: " + VIEWER_HTML, {
            status: 404,
            headers: CORS_HEADERS,
          });
        }
        const html = await readFile(VIEWER_HTML, "utf-8");
        return new Response(html, {
          headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (err) {
        return new Response(`Error serving viewer: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    // Golden dataset endpoint — save EvalCase JSONL to evals/golden/
    if (url.pathname === "/golden" && req.method === "POST") {
      try {
        const body = await req.json();
        const rawName = body?.name;
        const cases = body?.cases;
        if (!rawName || typeof rawName !== "string" || !Array.isArray(cases)) {
          return new Response("Expected { name: string, cases: EvalCase[] }", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
        const safeName = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
        const filename = `${safeName}.jsonl`;
        const filepath = join(GOLDEN_DIR, filename);
        const lines = cases.map((c: unknown) => JSON.stringify(c)).join("\n") + "\n";
        await writeFile(filepath, lines);
        return Response.json(
          { filename, caseCount: cases.length },
          { headers: CORS_HEADERS },
        );
      } catch (err) {
        return new Response(`Golden save error: ${err}`, {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    // --- Skills API ---

    // POST /api/skills/sync — bulk replace all skills (extension pushes full list)
    if (url.pathname === "/api/skills/sync" && req.method === "POST") {
      try {
        const body = await req.json();
        if (!Array.isArray(body)) {
          return new Response("Expected JSON array", { status: 400, headers: CORS_HEADERS });
        }
        await writeSkills(body);
        return Response.json({ count: body.length }, { headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Skills sync error: ${err}`, { status: 500, headers: CORS_HEADERS });
      }
    }

    // GET /api/skills — list all skills
    if (url.pathname === "/api/skills" && req.method === "GET") {
      try {
        const skills = await readSkills();
        return Response.json(skills, { headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Skills read error: ${err}`, { status: 500, headers: CORS_HEADERS });
      }
    }

    // PUT /api/skills/:id — update a skill
    const skillPutMatch = url.pathname.match(/^\/api\/skills\/([a-zA-Z0-9_-]+)$/);
    if (skillPutMatch && req.method === "PUT") {
      try {
        const skillId = skillPutMatch[1];
        const updates = await req.json();
        const skills = await readSkills();
        const idx = skills.findIndex((s) => s.id === skillId);
        if (idx === -1) {
          return new Response("Skill not found", { status: 404, headers: CORS_HEADERS });
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
        return Response.json(skills[idx], { headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Skills update error: ${err}`, { status: 500, headers: CORS_HEADERS });
      }
    }

    // DELETE /api/skills/:id — delete a skill
    const skillDeleteMatch = url.pathname.match(/^\/api\/skills\/([a-zA-Z0-9_-]+)$/);
    if (skillDeleteMatch && req.method === "DELETE") {
      try {
        const skillId = skillDeleteMatch[1];
        const skills = await readSkills();
        const next = skills.filter((s) => s.id !== skillId);
        if (next.length === skills.length) {
          return new Response("Skill not found", { status: 404, headers: CORS_HEADERS });
        }
        await writeSkills(next);
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Skills delete error: ${err}`, { status: 500, headers: CORS_HEADERS });
      }
    }

    // --- Memory API ---

    // POST /api/memory/sync — bulk replace all memory entries (extension pushes)
    if (url.pathname === "/api/memory/sync" && req.method === "POST") {
      try {
        const body = await req.json();
        if (!Array.isArray(body)) {
          return new Response("Expected JSON array", { status: 400, headers: CORS_HEADERS });
        }
        await writeMemoryEntries(body);
        return Response.json({ count: body.length }, { headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Memory sync error: ${err}`, { status: 500, headers: CORS_HEADERS });
      }
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
        return Response.json(entries, { headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Memory read error: ${err}`, { status: 500, headers: CORS_HEADERS });
      }
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
        return Response.json(categories, { headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Memory categories error: ${err}`, { status: 500, headers: CORS_HEADERS });
      }
    }

    // DELETE /api/memory/:id — delete a memory entry
    const memDeleteMatch = url.pathname.match(/^\/api\/memory\/([a-zA-Z0-9_-]+)$/);
    if (memDeleteMatch && req.method === "DELETE") {
      try {
        const memId = memDeleteMatch[1];
        const entries = await readMemoryEntries();
        const next = entries.filter((e) => e.id !== memId);
        if (next.length === entries.length) {
          return new Response("Memory entry not found", { status: 404, headers: CORS_HEADERS });
        }
        await writeMemoryEntries(next);
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      } catch (err) {
        return new Response(`Memory delete error: ${err}`, { status: 500, headers: CORS_HEADERS });
      }
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
});

console.log(`Log server listening on http://${HOST}:${server.port}`);
console.log(`Writing to ${LOG_FILE}`);
console.log(`Traces to ${TRACE_DIR}`);
console.log(`Trace viewer: http://${HOST}:${server.port}/viewer`);
console.log(`Press Ctrl+C to stop\n`);
