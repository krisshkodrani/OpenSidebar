import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join } from "path";
import {
  buildTraceInsights,
  type TraceInsightsFilters,
  type TraceInsightsResponse,
} from "./trace-insights";
import type { TraceEntryLike, TraceSessionLike } from "./log-server-helpers";

const DEFAULT_DB_PATH = ".artifacts/trace-index.sqlite";
const HOT_TRACE_DAYS = 7;

export interface TraceIndexStatus {
  available: boolean;
  source: "sqlite" | "jsonl";
  dbPath: string;
  indexedAt: number | null;
  hotTraceDays: number;
  sessions: number;
  hotSessions: number;
  archivedSessions: number;
  turns: number;
  tools: number;
  runEvents: number;
  screenshots: number;
  oldestSessionDay: string | null;
  newestSessionDay: string | null;
}

export interface HarnessRatchetCandidate {
  id: string;
  title: string;
  harnessLayer:
    | "tool"
    | "skill"
    | "prompt"
    | "policy"
    | "verifier"
    | "context"
    | "unknown";
  severity: "low" | "medium" | "high";
  count: number;
  failureRate?: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
  sampleSessionId?: string;
  sampleRunId?: string;
  evidenceQuery: string;
  suggestedAction: string;
}

function dbPath(projectRoot: string, path?: string): string {
  return path ?? join(projectRoot, DEFAULT_DB_PATH);
}

function openReadonly(path: string): Database.Database | null {
  if (!existsSync(path)) return null;
  return new Database(path, { readonly: true, fileMustExist: true });
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getMeta(db: Database.Database, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM trace_index_meta WHERE key = ?")
    .get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}

export function getTraceIndexStatus(
  projectRoot: string,
  path?: string,
): TraceIndexStatus {
  const pathToDb = dbPath(projectRoot, path);
  const db = openReadonly(pathToDb);
  if (!db) {
    return {
      available: false,
      source: "jsonl",
      dbPath: pathToDb,
      indexedAt: null,
      hotTraceDays: HOT_TRACE_DAYS,
      sessions: 0,
      hotSessions: 0,
      archivedSessions: 0,
      turns: 0,
      tools: 0,
      runEvents: 0,
      screenshots: 0,
      oldestSessionDay: null,
      newestSessionDay: null,
    };
  }

  try {
    const sessionCounts = db
      .prepare(
        `SELECT
          COUNT(*) AS sessions,
          SUM(CASE WHEN archive_state = 'archived' THEN 1 ELSE 0 END) AS archivedSessions,
          SUM(CASE WHEN archive_state != 'archived' THEN 1 ELSE 0 END) AS hotSessions,
          MIN(day) AS oldestSessionDay,
          MAX(day) AS newestSessionDay
        FROM trace_sessions`,
      )
      .get() as Record<string, unknown>;
    const count = (table: string) =>
      asNumber(
        (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count?: unknown;
        }).count,
      );

    return {
      available: true,
      source: "sqlite",
      dbPath: pathToDb,
      indexedAt: Number(getMeta(db, "indexed_at")) || null,
      hotTraceDays: HOT_TRACE_DAYS,
      sessions: asNumber(sessionCounts.sessions),
      hotSessions: asNumber(sessionCounts.hotSessions),
      archivedSessions: asNumber(sessionCounts.archivedSessions),
      turns: count("trace_turns"),
      tools: count("trace_tools"),
      runEvents: count("trace_run_events"),
      screenshots: count("trace_artifacts"),
      oldestSessionDay: asString(sessionCounts.oldestSessionDay) || null,
      newestSessionDay: asString(sessionCounts.newestSessionDay) || null,
    };
  } finally {
    db.close();
  }
}

export function buildTraceInsightsFromSqlite(
  projectRoot: string,
  filters: TraceInsightsFilters,
  path?: string,
): TraceInsightsResponse | null {
  const pathToDb = dbPath(projectRoot, path);
  const db = openReadonly(pathToDb);
  if (!db) return null;

  try {
    const sessionRows = db
      .prepare(
        `SELECT session_id, raw_json, run_id, source, start_time, end_time,
          outcome, query, start_url, turn_count, total_cost
        FROM trace_sessions`,
      )
      .all() as Array<Record<string, unknown>>;
    const sessions = sessionRows.map((row) => {
      const parsed = parseJson<Record<string, unknown>>(row.raw_json, {});
      return {
        sessionId: asString(row.session_id),
        runId: asString(row.run_id),
        source: asString(row.source),
        startTime: asNumber(row.start_time),
        endTime: asNumber(row.end_time),
        outcome: asString(row.outcome),
        query: asString(row.query),
        startUrl: asString(row.start_url),
        turnCount: asNumber(row.turn_count),
        metrics: { totalCost: asNumber(row.total_cost) },
        ...parsed,
      } as TraceSessionLike;
    });

    const entriesBySession = new Map<string, TraceEntryLike[]>();
    for (const row of db
      .prepare("SELECT session_id, raw_json FROM trace_turns ORDER BY turn_number")
      .all() as Array<{ session_id: string; raw_json: string }>) {
      const entry = parseJson<TraceEntryLike | null>(row.raw_json, null);
      if (!entry) continue;
      const entries = entriesBySession.get(row.session_id) ?? [];
      entries.push(entry);
      entriesBySession.set(row.session_id, entries);
    }

    const runEventsByRun = new Map<string, TraceEntryLike[]>();
    for (const row of db
      .prepare("SELECT run_id, raw_json FROM trace_run_events ORDER BY ordinal")
      .all() as Array<{ run_id: string; raw_json: string }>) {
      const entry = parseJson<TraceEntryLike | null>(row.raw_json, null);
      if (!entry) continue;
      const events = runEventsByRun.get(row.run_id) ?? [];
      events.push(entry);
      runEventsByRun.set(row.run_id, events);
    }

    return buildTraceInsights({
      sessions,
      entriesBySession,
      runEventsByRun,
      filters,
    });
  } finally {
    db.close();
  }
}

function severity(count: number, failureRate?: number): HarnessRatchetCandidate["severity"] {
  if (count >= 20 || (failureRate ?? 0) >= 0.5) return "high";
  if (count >= 5 || (failureRate ?? 0) >= 0.2) return "medium";
  return "low";
}

export function buildHarnessRatchetCandidates(
  projectRoot: string,
  path?: string,
): HarnessRatchetCandidate[] {
  const pathToDb = dbPath(projectRoot, path);
  const db = openReadonly(pathToDb);
  if (!db) return [];

  try {
    const candidates: HarnessRatchetCandidate[] = [];
    const toolRows = db
      .prepare(
        `SELECT
          tool_name AS toolName,
          COUNT(*) AS calls,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failures,
          MIN(s.day) AS firstSeen,
          MAX(s.day) AS lastSeen,
          MIN(t.session_id) AS sampleSessionId,
          MIN(s.run_id) AS sampleRunId
        FROM trace_tools t
        JOIN trace_sessions s ON s.session_id = t.session_id
        WHERE tool_name IS NOT NULL
        GROUP BY tool_name
        HAVING failures > 0
        ORDER BY failures DESC, calls DESC
        LIMIT 8`,
      )
      .all() as Array<Record<string, unknown>>;

    for (const row of toolRows) {
      const calls = asNumber(row.calls);
      const failures = asNumber(row.failures);
      const failureRate = calls > 0 ? failures / calls : 0;
      const toolName = asString(row.toolName);
      candidates.push({
        id: `tool:${toolName}`,
        title: `${toolName} has ${failures.toLocaleString("en-US")} failed calls`,
        harnessLayer: "tool",
        severity: severity(failures, failureRate),
        count: failures,
        failureRate,
        firstSeen: asString(row.firstSeen) || null,
        lastSeen: asString(row.lastSeen) || null,
        sampleSessionId: asString(row.sampleSessionId),
        sampleRunId: asString(row.sampleRunId),
        evidenceQuery: `tool=${encodeURIComponent(toolName)}&toolStatus=failure`,
        suggestedAction:
          "Inspect the sample failures and decide whether the fix belongs in the tool primitive, page controller, or verifier.",
      });
    }

    const outcomeRows = db
      .prepare(
        `SELECT
          outcome,
          COUNT(*) AS count,
          MIN(day) AS firstSeen,
          MAX(day) AS lastSeen,
          MIN(session_id) AS sampleSessionId,
          MIN(run_id) AS sampleRunId
        FROM trace_sessions
        WHERE outcome IS NOT NULL AND outcome NOT IN ('completed', 'success')
        GROUP BY outcome
        ORDER BY count DESC
        LIMIT 6`,
      )
      .all() as Array<Record<string, unknown>>;

    for (const row of outcomeRows) {
      const outcome = asString(row.outcome) || "unknown";
      const count = asNumber(row.count);
      candidates.push({
        id: `outcome:${outcome}`,
        title: `${count.toLocaleString("en-US")} sessions ended as ${outcome}`,
        harnessLayer: outcome === "max_turns" ? "policy" : "verifier",
        severity: severity(count),
        count,
        firstSeen: asString(row.firstSeen) || null,
        lastSeen: asString(row.lastSeen) || null,
        sampleSessionId: asString(row.sampleSessionId),
        sampleRunId: asString(row.sampleRunId),
        evidenceQuery: `outcome=${encodeURIComponent(outcome)}`,
        suggestedAction:
          outcome === "max_turns"
            ? "Review decomposition and continuation policy for early loop pressure before adding prompt rules."
            : "Open sample sessions and convert the repeated failure into a verifier, recovery path, or explicit harness rule.",
      });
    }

    const contextRow = db
      .prepare(
        `SELECT
          COUNT(*) AS count,
          MIN(s.day) AS firstSeen,
          MAX(s.day) AS lastSeen,
          MIN(t.session_id) AS sampleSessionId,
          MIN(s.run_id) AS sampleRunId
        FROM trace_turns t
        JOIN trace_sessions s ON s.session_id = t.session_id
        WHERE context_utilization >= 0.85 OR dropped_messages > 0`,
      )
      .get() as Record<string, unknown>;
    const contextCount = asNumber(contextRow.count);
    if (contextCount > 0) {
      candidates.push({
        id: "context:pressure",
        title: `${contextCount.toLocaleString("en-US")} turns show context pressure`,
        harnessLayer: "context",
        severity: severity(contextCount),
        count: contextCount,
        firstSeen: asString(contextRow.firstSeen) || null,
        lastSeen: asString(contextRow.lastSeen) || null,
        sampleSessionId: asString(contextRow.sampleSessionId),
        sampleRunId: asString(contextRow.sampleRunId),
        evidenceQuery: "context=pressure",
        suggestedAction:
          "Inspect high-pressure turns and tune compaction, tool-output offloading, or progressive disclosure.",
      });
    }

    const perceptionRow = db
      .prepare(
        `SELECT
          COUNT(*) AS count,
          MIN(s.day) AS firstSeen,
          MAX(s.day) AS lastSeen,
          MIN(t.session_id) AS sampleSessionId,
          MIN(s.run_id) AS sampleRunId
        FROM trace_turns t
        JOIN trace_sessions s ON s.session_id = t.session_id
        WHERE screenshot_status IN ('capture_failed', 'missing', 'none')
          OR perception_mode IN ('degraded', 'element_only')`,
      )
      .get() as Record<string, unknown>;
    const perceptionCount = asNumber(perceptionRow.count);
    if (perceptionCount > 0) {
      candidates.push({
        id: "perception:degraded",
        title: `${perceptionCount.toLocaleString("en-US")} turns have degraded visual evidence`,
        harnessLayer: "tool",
        severity: severity(perceptionCount),
        count: perceptionCount,
        firstSeen: asString(perceptionRow.firstSeen) || null,
        lastSeen: asString(perceptionRow.lastSeen) || null,
        sampleSessionId: asString(perceptionRow.sampleSessionId),
        sampleRunId: asString(perceptionRow.sampleRunId),
        evidenceQuery: "perception=degraded",
        suggestedAction:
          "Check screenshot capture and perception fallback paths before trusting failures as model mistakes.",
      });
    }

    return candidates.sort((a, b) => {
      const severityRank = { high: 3, medium: 2, low: 1 };
      const severityDelta = severityRank[b.severity] - severityRank[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return b.count - a.count;
    });
  } finally {
    db.close();
  }
}
