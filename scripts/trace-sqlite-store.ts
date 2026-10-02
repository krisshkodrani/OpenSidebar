import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  truncateText,
  type TraceInsightsFilters,
  type TraceInsightsFacets,
  type TraceInsightsMetricRow,
  type TraceInsightsResponse,
  type TraceInsightsRunRow,
  type TraceInsightsSummary,
} from "./trace-insights";
import {
  isIsoDay,
  normalizeTraceModelId,
  type TraceEntryLike,
  type TraceSessionLike,
} from "./log-server-helpers";
import { estimateCostBreakdownUsd } from "../apps/extension/src/background/llm/pricing";
import type { ProviderConfig } from "../apps/extension/src/background/llm/types";
import type { TraceTrendPoint } from "@observability-schema";

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

function json(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function dayKey(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function localDayStartMs(day: string): number {
  const [year, month, date] = day.split("-").map((part) => Number(part));
  return new Date(year, month - 1, date).getTime();
}

function localNextDayStartMs(day: string): number {
  const [year, month, date] = day.split("-").map((part) => Number(part));
  return new Date(year, month - 1, date + 1).getTime();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function sessionInsightFilterSql(filters: TraceInsightsFilters): {
  whereSql: string;
  params: Record<string, string | number>;
} {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  const day = asString(filters.day).trim();
  const from = asString(filters.from).trim();
  const to = asString(filters.to).trim();

  if (day && day !== "all" && isIsoDay(day)) {
    where.push("start_time >= @fromMs AND start_time < @toMs");
    params.fromMs = localDayStartMs(day);
    params.toMs = localNextDayStartMs(day);
  } else {
    if (isIsoDay(from)) {
      where.push("start_time >= @fromMs");
      params.fromMs = localDayStartMs(from);
    }
    if (isIsoDay(to)) {
      where.push("start_time < @toMs");
      params.toMs = localNextDayStartMs(to);
    }
  }

  const outcome = asString(filters.outcome).trim();
  if (outcome && outcome !== "all") {
    where.push("outcome = @outcome");
    params.outcome = outcome;
  }

  const domainFilter = asString(filters.domain).trim().toLowerCase();
  if (domainFilter) {
    where.push("LOWER(domain) LIKE @domain ESCAPE '\\'");
    params.domain = `%${escapeLike(domainFilter)}%`;
  }

  const runId = asString(filters.runId).trim();
  if (runId) {
    where.push("run_id LIKE @runId ESCAPE '\\'");
    params.runId = `${escapeLike(runId)}%`;
  }

  const sessionPrefix = (
    asString(filters.sessionId).trim() ||
    asString(filters.sessionPrefix).trim()
  );
  if (sessionPrefix) {
    where.push("session_id LIKE @sessionPrefix ESCAPE '\\'");
    params.sessionPrefix = `${escapeLike(sessionPrefix)}%`;
  }

  const q = asString(filters.q).trim().toLowerCase();
  if (q) {
    where.push(
      "(LOWER(query) LIKE @q ESCAPE '\\' OR LOWER(start_url) LIKE @q ESCAPE '\\' OR LOWER(session_id) LIKE @q ESCAPE '\\')",
    );
    params.q = `%${escapeLike(q)}%`;
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}


function domain(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function usageNumber(usage: Record<string, unknown> | null, keys: string[]): number {
  if (!usage) return 0;
  for (const key of keys) {
    const value = asNumber(usage[key]);
    if (value > 0) return value;
  }
  return 0;
}

function cachedTokensFromUsage(
  usage: Record<string, unknown> | null,
  promptTokens: number,
): number {
  let cachedTokens = usageNumber(usage, ["cached_tokens"]);
  const promptTokenDetails =
    usage?.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
      ? (usage.prompt_tokens_details as Record<string, unknown>)
      : null;
  if (cachedTokens === 0) {
    cachedTokens = usageNumber(promptTokenDetails, ["cached_tokens"]);
  }
  const cacheTelemetry =
    usage?.cacheTelemetry && typeof usage.cacheTelemetry === "object"
      ? (usage.cacheTelemetry as Record<string, unknown>)
      : null;
  if (cachedTokens === 0) {
    cachedTokens = usageNumber(cacheTelemetry, ["cachedPromptTokens"]);
  }
  return Math.max(0, Math.min(cachedTokens, promptTokens));
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trace_sessions (
      session_id TEXT PRIMARY KEY,
      run_id TEXT,
      source TEXT NOT NULL,
      archive_state TEXT NOT NULL DEFAULT 'hot',
      start_time INTEGER,
      end_time INTEGER,
      day TEXT,
      domain TEXT,
      outcome TEXT,
      query TEXT,
      start_url TEXT,
      turn_count INTEGER,
      total_tokens INTEGER,
      total_cost REAL,
      raw_json TEXT,
      trace_file TEXT,
      indexed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trace_sessions_start_time
      ON trace_sessions(start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_trace_sessions_outcome
      ON trace_sessions(outcome);
    CREATE INDEX IF NOT EXISTS idx_trace_sessions_domain
      ON trace_sessions(domain);
    CREATE INDEX IF NOT EXISTS idx_trace_sessions_run
      ON trace_sessions(run_id);

    CREATE TABLE IF NOT EXISTS trace_turns (
      session_id TEXT NOT NULL,
      turn_number INTEGER NOT NULL,
      run_id TEXT,
      model TEXT,
      model_tier TEXT,
      provider TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      context_utilization REAL,
      dropped_messages INTEGER,
      perception_mode TEXT,
      perception_source TEXT,
      screenshot_status TEXT,
      url TEXT,
      title TEXT,
      raw_json TEXT,
      PRIMARY KEY (session_id, turn_number)
    );

    CREATE INDEX IF NOT EXISTS idx_trace_turns_model
      ON trace_turns(model);
    CREATE INDEX IF NOT EXISTS idx_trace_turns_perception
      ON trace_turns(perception_mode, screenshot_status);

    CREATE TABLE IF NOT EXISTS trace_tools (
      session_id TEXT NOT NULL,
      turn_number INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      tool_name TEXT,
      success INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      result TEXT,
      PRIMARY KEY (session_id, turn_number, ordinal)
    );

    CREATE INDEX IF NOT EXISTS idx_trace_tools_name_success
      ON trace_tools(tool_name, success);

    CREATE TABLE IF NOT EXISTS trace_run_events (
      run_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      type TEXT,
      role TEXT,
      turn_number INTEGER,
      ts TEXT,
      raw_json TEXT,
      PRIMARY KEY (run_id, ordinal)
    );

    CREATE INDEX IF NOT EXISTS idx_trace_run_events_type
      ON trace_run_events(type);

    CREATE TABLE IF NOT EXISTS trace_run_manifests (
      run_id TEXT PRIMARY KEY,
      raw_json TEXT,
      indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trace_artifacts (
      path TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      archive_state TEXT NOT NULL DEFAULT 'hot',
      session_id TEXT,
      run_id TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      mtime_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trace_index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const ensureColumn = (table: string, column: string, sql: string) => {
    const columns = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => String((row as { name: unknown }).name)),
    );
    if (!columns.has(column)) db.exec(sql);
  };

  ensureColumn(
    "trace_sessions",
    "archive_state",
    "ALTER TABLE trace_sessions ADD COLUMN archive_state TEXT NOT NULL DEFAULT 'hot'",
  );
  ensureColumn(
    "trace_artifacts",
    "archive_state",
    "ALTER TABLE trace_artifacts ADD COLUMN archive_state TEXT NOT NULL DEFAULT 'hot'",
  );
  ensureColumn(
    "trace_turns",
    "cached_tokens",
    "ALTER TABLE trace_turns ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0",
  );
}

const retainedWriters = new Map<string, { db: Database.Database; leases: number }>();
const retainedConnections = new WeakSet<Database.Database>();

/** Keep a server's writer open so each ingest does not checkpoint and close WAL. */
export function retainTraceSqliteWriter(projectRoot: string, path?: string): () => void {
  const key = resolve(dbPath(projectRoot, path));
  let writer = retainedWriters.get(key);
  if (!writer) {
    writer = { db: openWritable(projectRoot, path), leases: 0 };
    retainedWriters.set(key, writer);
    retainedConnections.add(writer.db);
  }
  writer.leases++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--writer.leases === 0) {
      retainedWriters.delete(key);
      retainedConnections.delete(writer.db);
      writer.db.close();
    }
  };
}

function releaseWritable(db: Database.Database): void {
  if (!retainedConnections.has(db)) db.close();
}

function openWritable(projectRoot: string, path?: string): Database.Database {
  const pathToDb = resolve(dbPath(projectRoot, path));
  const retained = retainedWriters.get(pathToDb);
  if (retained) return retained.db;
  mkdirSync(dirname(pathToDb), { recursive: true });
  const db = new Database(pathToDb);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 3000");
  initSchema(db);
  return db;
}

function getMeta(db: Database.Database, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM trace_index_meta WHERE key = ?")
    .get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}

export function upsertTraceSessionToSqlite(
  projectRoot: string,
  session: TraceSessionLike,
  options: { dbPath?: string; traceFile?: string } = {},
): void {
  const sessionId = asString(session.sessionId);
  if (!sessionId) return;
  const db = openWritable(projectRoot, options.dbPath);
  try {
    const indexedAt = Date.now();
    const metrics =
      session.metrics && typeof session.metrics === "object"
        ? (session.metrics as Record<string, unknown>)
        : null;
    db.prepare(
      `INSERT INTO trace_sessions (
        session_id, run_id, source, start_time, end_time, day, domain, outcome,
        query, start_url, turn_count, total_tokens, total_cost, raw_json,
        trace_file, indexed_at, archive_state
      ) VALUES (
        @session_id, @run_id, @source, @start_time, @end_time, @day, @domain,
        @outcome, @query, @start_url, @turn_count, @total_tokens, @total_cost,
        @raw_json, @trace_file, @indexed_at, 'hot'
      )
      ON CONFLICT(session_id) DO UPDATE SET
        run_id=excluded.run_id,
        source=excluded.source,
        archive_state='hot',
        start_time=excluded.start_time,
        end_time=excluded.end_time,
        day=excluded.day,
        domain=excluded.domain,
        outcome=excluded.outcome,
        query=excluded.query,
        start_url=excluded.start_url,
        turn_count=excluded.turn_count,
        total_tokens=excluded.total_tokens,
        total_cost=excluded.total_cost,
        raw_json=excluded.raw_json,
        trace_file=COALESCE(excluded.trace_file, trace_file),
        indexed_at=excluded.indexed_at`,
    ).run({
      session_id: sessionId,
      run_id: asString(session.runId) || null,
      source: asString(session.source) || "live",
      start_time: asNumber(session.startTime) || null,
      end_time: asNumber(session.endTime) || null,
      day: dayKey(asNumber(session.startTime)),
      domain: domain(session.startUrl),
      outcome: asString(session.outcome) || null,
      query: asString(session.query) || null,
      start_url: asString(session.startUrl) || null,
      turn_count: asNumber(session.turnCount) || null,
      total_tokens: asNumber(metrics?.totalTokens) || null,
      total_cost: asNumber(metrics?.totalCost) || null,
      raw_json: json(session),
      trace_file: options.traceFile ?? null,
      indexed_at: indexedAt,
    });
    db.prepare(
      "INSERT OR REPLACE INTO trace_index_meta (key, value) VALUES (?, ?)",
    ).run("indexed_at", String(indexedAt));
  } finally {
    releaseWritable(db);
  }
}

export function insertTraceTurnToSqlite(
  projectRoot: string,
  entry: TraceEntryLike,
  options: { dbPath?: string } = {},
): void {
  const sessionId = asString(entry.sessionId);
  const turnNumber = asNumber(entry.turnNumber);
  if (!sessionId || !turnNumber) return;
  const db = openWritable(projectRoot, options.dbPath);
  try {
    const indexedAt = Date.now();
    const llmRequest =
      entry.llmRequest && typeof entry.llmRequest === "object"
        ? (entry.llmRequest as Record<string, unknown>)
        : null;
    const llmResponse =
      entry.llmResponse && typeof entry.llmResponse === "object"
        ? (entry.llmResponse as Record<string, unknown>)
        : null;
    const usage =
      llmResponse?.usage && typeof llmResponse.usage === "object"
        ? (llmResponse.usage as Record<string, unknown>)
        : null;
    const promptTokens = usageNumber(usage, ["prompt_tokens", "input_tokens"]);
    const completionTokens = usageNumber(usage, [
      "completion_tokens",
      "output_tokens",
    ]);
    const cachedTokens = cachedTokensFromUsage(usage, promptTokens);
    const snapshot =
      entry.snapshot && typeof entry.snapshot === "object"
        ? (entry.snapshot as Record<string, unknown>)
        : null;
    const perception =
      entry.perception && typeof entry.perception === "object"
        ? (entry.perception as Record<string, unknown>)
        : null;
    const contextMetrics =
      llmRequest?.contextMetrics && typeof llmRequest.contextMetrics === "object"
        ? (llmRequest.contextMetrics as Record<string, unknown>)
        : null;

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT OR REPLACE INTO trace_turns (
          session_id, turn_number, run_id, model, model_tier, provider,
          prompt_tokens, cached_tokens, completion_tokens, total_tokens, cost,
          duration_ms,
          context_utilization, dropped_messages, perception_mode, perception_source,
          screenshot_status, url, title, raw_json
        ) VALUES (
          @session_id, @turn_number, @run_id, @model, @model_tier, @provider,
          @prompt_tokens, @cached_tokens, @completion_tokens, @total_tokens,
          @cost, @duration_ms,
          @context_utilization, @dropped_messages, @perception_mode,
          @perception_source, @screenshot_status, @url, @title, @raw_json
        )`,
      ).run({
        session_id: sessionId,
        turn_number: turnNumber,
        run_id: asString(entry.runId) || null,
        model:
          normalizeTraceModelId(
            asString(llmResponse?.actualModel) || asString(llmRequest?.model),
          ) || null,
        model_tier: asString(llmRequest?.modelTier) || null,
        provider: asString(llmResponse?.actualProviderId) || null,
        prompt_tokens: promptTokens,
        cached_tokens: cachedTokens,
        completion_tokens: completionTokens,
        total_tokens:
          usageNumber(usage, ["total_tokens"]) || promptTokens + completionTokens,
        cost: usageNumber(usage, ["cost"]),
        duration_ms: asNumber(llmResponse?.durationMs),
        context_utilization: asNumber(contextMetrics?.utilization) || null,
        dropped_messages: asNumber(contextMetrics?.droppedMessageCount) || null,
        perception_mode: asString(perception?.mode) || null,
        perception_source: asString(perception?.source) || null,
        screenshot_status: asString(perception?.screenshotStatus) || null,
        url: asString(snapshot?.url) || null,
        title: asString(snapshot?.title) || null,
        raw_json: json(entry),
      });

      db.prepare(
        "DELETE FROM trace_tools WHERE session_id = ? AND turn_number = ?",
      ).run(sessionId, turnNumber);
      const insertTool = db.prepare(
        `INSERT OR REPLACE INTO trace_tools (
          session_id, turn_number, ordinal, tool_name, success, duration_ms, error, result
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const executions = Array.isArray(entry.toolExecutions)
        ? entry.toolExecutions
        : [];
      executions.forEach((execution, ordinal) => {
        if (!execution || typeof execution !== "object") return;
        const tool = execution as Record<string, unknown>;
        insertTool.run(
          sessionId,
          turnNumber,
          ordinal,
          asString(tool.toolName) || null,
          tool.success === true ? 1 : 0,
          asNumber(tool.durationMs),
          asString(tool.error) || null,
          asString(tool.result) || null,
        );
      });
      db.prepare(
        "INSERT OR REPLACE INTO trace_index_meta (key, value) VALUES (?, ?)",
      ).run("indexed_at", String(indexedAt));
    });
    tx();
  } finally {
    releaseWritable(db);
  }
}

export function insertRunTraceEventToSqlite(
  projectRoot: string,
  event: TraceEntryLike,
  options: { dbPath?: string } = {},
): void {
  const runId = asString(event.runId);
  if (!runId) return;
  const db = openWritable(projectRoot, options.dbPath);
  try {
    const rawJson = json(event);
    const existing = db
      .prepare("SELECT ordinal FROM trace_run_events WHERE run_id = ? AND raw_json = ?")
      .get(runId, rawJson) as { ordinal?: number } | undefined;
    if (existing) return;
    const next = db
      .prepare("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM trace_run_events WHERE run_id = ?")
      .get(runId) as { ordinal: number };
    db.prepare(
      `INSERT INTO trace_run_events (
        run_id, ordinal, type, role, turn_number, ts, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      runId,
      next.ordinal,
      asString(event.type) || null,
      asString(event.role) || null,
      asNumber(event.turn) || asNumber(event.turnNumber) || null,
      asString(event.ts) || asString(event.recordedAt) || null,
      rawJson,
    );
    db.prepare(
      "INSERT OR REPLACE INTO trace_index_meta (key, value) VALUES (?, ?)",
    ).run("indexed_at", String(Date.now()));
  } finally {
    releaseWritable(db);
  }
}

export function upsertRunTraceManifestToSqlite(
  projectRoot: string,
  manifest: TraceEntryLike,
  options: { dbPath?: string } = {},
): void {
  const runId = asString(manifest.runId);
  if (!runId) return;
  const db = openWritable(projectRoot, options.dbPath);
  try {
    const indexedAt = Date.now();
    db.prepare(
      `INSERT INTO trace_run_manifests (run_id, raw_json, indexed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         raw_json=excluded.raw_json,
         indexed_at=excluded.indexed_at`,
    ).run(runId, json(manifest), indexedAt);
    db.prepare(
      "INSERT OR REPLACE INTO trace_index_meta (key, value) VALUES (?, ?)",
    ).run("indexed_at", String(indexedAt));
  } finally {
    releaseWritable(db);
  }
}

export function recordTraceArtifactInSqlite(
  projectRoot: string,
  artifact: {
    path: string;
    kind: string;
    sessionId?: string | null;
    runId?: string | null;
    sizeBytes?: number;
    mtimeMs?: number;
  },
  options: { dbPath?: string } = {},
): void {
  const db = openWritable(projectRoot, options.dbPath);
  try {
    db.prepare(
      `INSERT OR REPLACE INTO trace_artifacts (
        path, kind, archive_state, session_id, run_id, size_bytes, mtime_ms
      ) VALUES (?, ?, 'hot', ?, ?, ?, ?)`,
    ).run(
      artifact.path,
      artifact.kind,
      artifact.sessionId ?? null,
      artifact.runId ?? null,
      artifact.sizeBytes ?? 0,
      artifact.mtimeMs ?? Date.now(),
    );
  } finally {
    releaseWritable(db);
  }
}

export function readTraceSessionsFromSqlite(
  projectRoot: string,
  path?: string,
): TraceSessionLike[] | null {
  const pathToDb = dbPath(projectRoot, path);
  const db = openReadonly(pathToDb);
  if (!db) return null;
  try {
    return (db
      .prepare(
        `SELECT session_id, raw_json, run_id, source, start_time, end_time,
          outcome, query, start_url, turn_count, total_cost
        FROM trace_sessions
        ORDER BY start_time DESC`,
      )
      .all() as Array<Record<string, unknown>>).map((row) => ({
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
      ...parseJson<Record<string, unknown>>(row.raw_json, {}),
    })) as TraceSessionLike[];
  } finally {
    db.close();
  }
}

export function readTraceEntriesFromSqlite(
  projectRoot: string,
  sessionId: string,
  path?: string,
): TraceEntryLike[] | null {
  const pathToDb = dbPath(projectRoot, path);
  const db = openReadonly(pathToDb);
  if (!db) return null;
  try {
    return (db
      .prepare(
        "SELECT raw_json FROM trace_turns WHERE session_id = ? ORDER BY turn_number",
      )
      .all(sessionId) as Array<{ raw_json: string }>).map((row) =>
      parseJson<TraceEntryLike>(row.raw_json, {}),
    );
  } finally {
    db.close();
  }
}

export function readRunTraceEventsFromSqlite(
  projectRoot: string,
  runId: string,
  path?: string,
): TraceEntryLike[] | null {
  const pathToDb = dbPath(projectRoot, path);
  const db = openReadonly(pathToDb);
  if (!db) return null;
  try {
    return (db
      .prepare(
        "SELECT raw_json FROM trace_run_events WHERE run_id = ? ORDER BY ordinal",
      )
      .all(runId) as Array<{ raw_json: string }>).map((row) =>
      parseJson<TraceEntryLike>(row.raw_json, {}),
    );
  } finally {
    db.close();
  }
}

export function readTraceRawJsonlFromSqlite(
  projectRoot: string,
  sessionId: string,
  path?: string,
): string[] | null {
  const pathToDb = dbPath(projectRoot, path);
  const db = openReadonly(pathToDb);
  if (!db) return null;
  try {
    const lines: string[] = [];
    const session = db
      .prepare("SELECT raw_json FROM trace_sessions WHERE session_id = ?")
      .get(sessionId) as { raw_json?: string } | undefined;
    if (session?.raw_json) lines.push(session.raw_json);
    for (const row of db
      .prepare(
        "SELECT raw_json FROM trace_turns WHERE session_id = ? ORDER BY turn_number",
      )
      .all(sessionId) as Array<{ raw_json: string }>) {
      if (row.raw_json) lines.push(row.raw_json);
    }
    return lines;
  } finally {
    db.close();
  }
}

export function readRunRawJsonlFromSqlite(
  projectRoot: string,
  runId: string,
  path?: string,
): string[] | null {
  const pathToDb = dbPath(projectRoot, path);
  const db = openReadonly(pathToDb);
  if (!db) return null;
  try {
    const lines: string[] = [];
    const manifest = db
      .prepare("SELECT raw_json FROM trace_run_manifests WHERE run_id = ?")
      .get(runId) as { raw_json?: string } | undefined;
    if (manifest?.raw_json) lines.push(manifest.raw_json);
    for (const row of db
      .prepare(
        "SELECT raw_json FROM trace_run_events WHERE run_id = ? ORDER BY ordinal",
      )
      .all(runId) as Array<{ raw_json: string }>) {
      if (row.raw_json) lines.push(row.raw_json);
    }
    return lines;
  } finally {
    db.close();
  }
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

// ── Provider helpers (mirrors trace-insights.ts, kept local to avoid circular dep) ──
const INSIGHT_PROVIDER_IDS = new Set<ProviderConfig["providerId"]>([
  "openrouter", "openai", "groq", "fireworks", "moonshot", "deepseek", "xiaomi",
]);

function asProviderId(value: unknown): ProviderConfig["providerId"] | null {
  const p = asString(value);
  return INSIGHT_PROVIDER_IDS.has(p as ProviderConfig["providerId"])
    ? (p as ProviderConfig["providerId"])
    : null;
}

function inferProviderIdFromModel(model: string): ProviderConfig["providerId"] | null {
  const n = model.trim().toLowerCase();
  if (!n) return null;
  if (n.startsWith("accounts/fireworks/")) return "fireworks";
  if (n.includes("kimi-k2p")) return "fireworks";
  if (n.startsWith("kimi-")) return "moonshot";
  if (n.startsWith("deepseek-")) return "deepseek";
  if (n.startsWith("mimo-")) return "xiaomi";
  return null;
}

function pricingModelForNormalizedId(
  providerId: ProviderConfig["providerId"] | null,
  model: string,
): string {
  if (providerId === "fireworks" && !model.includes("/")) {
    return `accounts/fireworks/routers/${model}`;
  }
  return model;
}

/**
 * Build the SQL WHERE clause + params for the filtered session CTE.
 *
 * Extends `sessionInsightFilterSql` with additional filters that require
 * sub-selects (model, tier, mode, tool, toolStatus, skill, failure, eventType).
 * All extra param names are prefixed with `_f` to avoid collisions.
 */
function failureLabelSql(rawJson: string, outcome: string): string {
  return `COALESCE(
    NULLIF(NULLIF(json_extract(${rawJson}, '$.failureCode'), 'none'), ''),
    NULLIF(NULLIF(json_extract(${rawJson}, '$.failureCategory'), 'none'), ''),
    CASE WHEN ${outcome} IN ('completed', 'success') THEN NULL
         ELSE COALESCE(NULLIF(${outcome}, ''), 'unknown_failure') END
  )`;
}

function buildSessionCteFilter(
  filters: TraceInsightsFilters,
): { whereSql: string; params: Record<string, string | number> } {
  const base = sessionInsightFilterSql(filters);
  const conditions: string[] = base.whereSql
    ? [base.whereSql.replace(/^WHERE\s+/i, "")]
    : [];
  const params: Record<string, string | number> = { ...base.params };
  const esc = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
  const sessionHasModel = (valueSql: string) => `(
    EXISTS (SELECT 1 FROM json_each(s.raw_json, '$.models') _sm
            WHERE _sm.type = 'text'
              AND normalize_trace_model_id(_sm.value) = ${valueSql})
    OR EXISTS (SELECT 1 FROM json_each(s.raw_json, '$.metrics.modelBreakdown') _bm
               WHERE normalize_trace_model_id(_bm.key) = ${valueSql})
  )`;

  // Model and mode filters use the session's recorded model set.
  const model = normalizeTraceModelId(asString(filters.model).trim());
  if (model && model !== "all") {
    conditions.push(sessionHasModel("@_fModel"));
    params._fModel = model;
  }

  // Tier filter — executor / planner
  const tier = asString(filters.tier).trim();
  if (tier && tier !== "all") {
    conditions.push(
      `EXISTS (SELECT 1 FROM trace_turns _ft WHERE _ft.session_id = s.session_id AND _ft.model_tier = @_fTier)`,
    );
    params._fTier = tier;
  }

  // Mode filter — recording, manual, agent
  const mode = asString(filters.mode).trim();
  if (mode && mode !== "all") {
    if (mode === "recording") {
      conditions.push(sessionHasModel("'recording'"));
    } else if (mode === "manual") {
      conditions.push(sessionHasModel("'manual'"));
    } else if (mode === "agent") {
      conditions.push(`NOT ${sessionHasModel("'recording'")}`);
      conditions.push(`NOT ${sessionHasModel("'manual'")}`);
    }
  }

  // Tool / toolStatus filter
  const tool = asString(filters.tool).trim();
  const toolStatus = asString(filters.toolStatus).trim();
  if (tool || (toolStatus && toolStatus !== "all")) {
    const tc: string[] = ["_ftl.session_id = s.session_id"];
    if (tool) { tc.push("_ftl.tool_name = @_fToolName"); params._fToolName = tool; }
    if (toolStatus === "success") tc.push("_ftl.success = 1");
    else if (toolStatus === "failure") tc.push("_ftl.success = 0");
    // The name-first index makes SQLite scan every call of a popular tool for
    // each session. The primary key starts with session_id and bounds the probe.
    conditions.push(`EXISTS (SELECT 1 FROM trace_tools _ftl INDEXED BY sqlite_autoindex_trace_tools_1 WHERE ${tc.join(" AND ")})`);
  }

  // Skill filter — embedded in raw_json (LIKE is imprecise but fast enough)
  const skill = asString(filters.skill).trim();
  if (skill && skill !== "all") {
    conditions.push(`s.raw_json LIKE @_fSkill ESCAPE '\\'`);
    params._fSkill = `%${esc(skill)}%`;
  }

  // Failure filter — failureCode > failureCategory > outcome
  const failure = asString(filters.failure).trim();
  if (failure && failure !== "all") {
    conditions.push(`${failureLabelSql("s.raw_json", "s.outcome")} = @_fFailure`);
    params._fFailure = failure;
  }

  // Event type filter — turn/session event or run event associated with the session's run
  const eventType = asString(filters.eventType).trim();
  if (eventType && eventType !== "all") {
    conditions.push(`(
      EXISTS (
        SELECT 1 FROM trace_run_events _fre INDEXED BY sqlite_autoindex_trace_run_events_1
        WHERE _fre.run_id = s.run_id AND _fre.type = @_fEventType
      )
      OR EXISTS (
        SELECT 1 FROM trace_turns _fet
        JOIN json_each(_fet.raw_json, '$.events') _fee
        WHERE _fet.session_id = s.session_id
          AND json_extract(_fee.value, '$.type') = @_fEventType
      )
      OR EXISTS (
        SELECT 1 FROM json_each(s.raw_json, '$.events') _fse
        WHERE json_extract(_fse.value, '$.type') = @_fEventType
      )
    )`);
    params._fEventType = eventType;
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

const MAX_INSIGHTS_RUN_ROWS = 200;
const MAX_INSIGHTS_FACET_IDS = 500;

/**
 * Build trace insights entirely from SQL aggregation — no row-per-row JS loops.
 *
 * Replaces the old approach of loading every session + turn + tool row into
 * memory and aggregating in JavaScript.  All GROUP BY / COUNT / SUM work is
 * done inside SQLite (C), which is 10–100× faster for large trace stores.
 *
 * Estimated costs (which require calling estimateCostBreakdownUsd) are computed
 * per unique model rather than per turn — O(M models) instead of O(N turns).
 */
function buildInsightsSql(
  db: Database.Database,
  filters: TraceInsightsFilters,
): TraceInsightsResponse {
  const { whereSql, params: filterParams } = buildSessionCteFilter(filters);
  db.function("normalize_trace_model_id", (value: unknown) =>
    normalizeTraceModelId(asString(value)));

  // Reusable CTE for filtered sessions — does NOT include raw_json to keep
  // it lean. Queries that need raw_json JOIN back to trace_sessions.
  const filteredSelect = `
    SELECT s.session_id, s.run_id, s.outcome, s.domain,
           s.turn_count, s.total_cost, s.start_time, s.end_time,
           s.query, s.start_url
    FROM trace_sessions s
    ${whereSql}
  `;
  let cte = `WITH filtered AS (${filteredSelect})`;
  let params = filterParams;
  const eventType = asString(filters.eventType).trim();
  if (eventType && eventType !== "all") {
    // Parsing turn-event JSON is expensive. Reuse the selected sessions across
    // aggregate queries instead of reevaluating the predicate each time.
    db.prepare(`CREATE TEMP TABLE filtered_insights AS ${filteredSelect}`).run(filterParams);
    db.exec("CREATE UNIQUE INDEX filtered_insights_session ON filtered_insights(session_id)");
    cte = "WITH filtered AS (SELECT * FROM filtered_insights)";
    params = {};
  }
  // ── 1. Session summary (one row) ────────────────────────────────────────
  const sr = db.prepare(`
    ${cte}
    SELECT
      COUNT(*)                                                                    AS totalSessions,
      COUNT(DISTINCT f.run_id)                                                    AS totalRuns,
      SUM(CASE WHEN f.outcome IN ('completed','success') THEN 1 ELSE 0 END)      AS completedSessions,
      SUM(CASE WHEN f.outcome NOT IN ('completed','success') OR f.outcome IS NULL
               THEN 1 ELSE 0 END)                                               AS failedSessions,
      SUM(COALESCE(f.turn_count, 0))                                             AS totalTurns,
      SUM(COALESCE(f.total_cost, 0))                                              AS totalCost,
      AVG(CASE WHEN f.end_time - f.start_time > 0
               THEN CAST(f.end_time - f.start_time AS REAL) ELSE 0 END)         AS averageDurationMs,
      SUM(CASE WHEN json_extract(ts.raw_json,'$.partialHandoff') IS NOT NULL
               THEN 1 ELSE 0 END)                                                AS partialHandoffCount,
      SUM(CASE WHEN f.outcome = 'max_turns'
               AND json_extract(ts.raw_json,'$.partialHandoff') IS NOT NULL
               THEN 1 ELSE 0 END)                                                AS maxTurnsWithHandoffCount,
      SUM(CASE WHEN f.outcome = 'max_turns'
               AND (
                 json_extract(ts.raw_json,'$.partialHandoff') IS NULL
                 OR (
                   COALESCE(json_array_length(json_extract(ts.raw_json,'$.partialHandoff.evidence')),0) = 0
                   AND COALESCE(json_array_length(json_extract(ts.raw_json,'$.partialHandoff.completed')),0) = 0
                   AND NULLIF(json_extract(ts.raw_json,'$.partialHandoff.currentState.url'),'') IS NULL
                   AND NULLIF(json_extract(ts.raw_json,'$.partialHandoff.currentState.title'),'') IS NULL
                 )
               )
               THEN 1 ELSE 0 END)                                                AS maxTurnsWithoutUsefulProgressCount
    FROM filtered f
    JOIN trace_sessions ts ON ts.session_id = f.session_id
  `).get(params) as Record<string, unknown> | undefined;

  // Return empty response if no sessions matched
  if (!sr || (sr.totalSessions ?? 0) === 0) {
    return buildEmptyInsightsResponse();
  }

  // ── 2. Turn / token / cost aggregate (one row) ─────────────────────────
  const tr = (db.prepare(`
    ${cte}
    SELECT
      COUNT(*)                                   AS llmRequests,
      SUM(t.prompt_tokens)                       AS promptTokens,
      SUM(t.cached_tokens)                       AS cachedTokens,
      SUM(t.completion_tokens)                   AS completionTokens,
      SUM(t.total_tokens)                        AS totalTokens,
      SUM(t.cost)                                AS requestCost,
      SUM(t.duration_ms)                         AS totalLlmDurationMs,
      AVG(CASE WHEN t.duration_ms > 0 THEN CAST(t.duration_ms AS REAL)
               ELSE NULL END)                     AS averageLlmDurationMs,
      AVG(CAST(t.prompt_tokens AS REAL))         AS averagePromptTokens,
      AVG(CAST(t.completion_tokens AS REAL))     AS averageCompletionTokens,
      AVG(CAST(t.total_tokens AS REAL))          AS averageTotalTokens
    FROM trace_turns t
    WHERE t.session_id IN (SELECT session_id FROM filtered)
  `).get(params) ?? {}) as Record<string, unknown>;

  // ── 3. Tool counts (one row) ────────────────────────────────────────────
  const toolr = (db.prepare(`
    ${cte}
    SELECT
      COUNT(*) AS toolCalls,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS toolFailures
    FROM trace_tools tt
    WHERE tt.session_id IN (SELECT session_id FROM filtered)
  `).get(params) ?? {}) as Record<string, unknown>;

  // ── 4. Per-model aggregates (for model mix + cost estimation) ───────────
  const modelCte = `${cte}
    , model_source AS (
      SELECT f.session_id, normalize_trace_model_id(m.value) AS model,
             1 AS sessionListed, CAST(m.key AS INTEGER) AS position
      FROM filtered f JOIN trace_sessions ts ON ts.session_id = f.session_id
      JOIN json_each(ts.raw_json, '$.models') m
      WHERE m.type = 'text'

      UNION ALL

      SELECT f.session_id, normalize_trace_model_id(m.key) AS model,
             1 AS sessionListed, 1000000 + CAST(m.id AS INTEGER) AS position
      FROM filtered f JOIN trace_sessions ts ON ts.session_id = f.session_id
      JOIN json_each(ts.raw_json, '$.metrics.modelBreakdown') m

      UNION ALL

      SELECT t.session_id, normalize_trace_model_id(t.model) AS model,
             0 AS sessionListed,
             2000000 + t.turn_number AS position
      FROM trace_turns t JOIN filtered f ON f.session_id = t.session_id
    ), model_sessions AS (
      SELECT session_id, model, MAX(sessionListed) AS sessionListed,
             MIN(position) AS firstPosition
      FROM model_source
      WHERE model IS NOT NULL AND model != ''
      GROUP BY session_id, model
    ), ranked_model_sessions AS (
      SELECT ms.*,
             ROW_NUMBER() OVER (
               PARTITION BY ms.model ORDER BY f.start_time DESC, f.session_id
             ) AS firstRank
      FROM model_sessions ms
      JOIN filtered f ON f.session_id = ms.session_id
    )`;
  const modelAggs = db.prepare(`
    ${modelCte}
    SELECT
      ms.model,
      MIN(t.provider)                         AS provider,
      COUNT(DISTINCT ms.session_id)          AS sessions,
      COUNT(DISTINCT f.run_id)               AS runs,
      COUNT(t.session_id)                    AS requests,
      SUM(t.prompt_tokens)                   AS promptTokens,
      SUM(t.cached_tokens)                   AS cachedTokens,
      SUM(t.completion_tokens)               AS completionTokens,
      SUM(t.total_tokens)                    AS totalTokens,
      SUM(t.cost)                            AS requestCost,
      SUM(t.duration_ms)                     AS durationMs,
      SUM(CASE WHEN t.prompt_tokens > 0 OR t.completion_tokens > 0
               THEN 1 ELSE 0 END)            AS pricedRequestCandidates,
      MAX(f.start_time)                       AS firstStartTime,
      MAX(CASE WHEN ms.firstRank = 1 THEN ms.firstPosition END) AS firstPosition,
      MAX(CASE WHEN ms.firstRank = 1 THEN ms.session_id END) AS sampleSessionId,
      MAX(CASE WHEN ms.firstRank = 1 THEN f.run_id END) AS sampleRunId
    FROM ranked_model_sessions ms
    JOIN filtered f ON f.session_id = ms.session_id
    -- The model-only index scans every turn for popular models per session.
    -- The primary key starts with session_id and bounds each lookup.
    LEFT JOIN trace_turns t INDEXED BY sqlite_autoindex_trace_turns_1
      ON t.session_id = ms.session_id
      AND normalize_trace_model_id(t.model) = ms.model
    GROUP BY ms.model
    ORDER BY requests DESC
  `).all(params) as Array<Record<string, unknown>>;

  const modelSessionAggs = db.prepare(`
    ${modelCte}
    SELECT ms.model,
      SUM(ms.sessionListed) AS calls,
      SUM(CASE WHEN ms.sessionListed = 1 AND f.outcome IN ('completed','success')
               THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN ms.sessionListed = 1 AND
               (f.outcome NOT IN ('completed','success') OR f.outcome IS NULL)
               THEN 1 ELSE 0 END) AS failures,
      SUM(COALESCE(f.turn_count, 0)) AS totalTurns,
      SUM(COALESCE(f.total_cost, 0)) AS totalCost
    FROM model_sessions ms
    JOIN filtered f ON f.session_id = ms.session_id
    GROUP BY ms.model
  `).all(params) as Array<Record<string, unknown>>;
  const modelSessionById = new Map(modelSessionAggs.map((row) => [asString(row.model), row]));

  // ── 5. Tool breakdown ───────────────────────────────────────────────────
  const toolAggs = db.prepare(`
    ${cte}
    , tool_sessions AS (
      SELECT
        tt.tool_name, tt.session_id, f.run_id,
        COUNT(*) AS calls,
        SUM(CASE WHEN tt.success = 1 THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN tt.success = 0 THEN 1 ELSE 0 END) AS failures,
        SUM(tt.duration_ms) AS durationMs,
        MIN(printf('%09d:%09d', tt.turn_number, tt.ordinal)) AS firstPosition,
        f.turn_count, f.total_cost, f.start_time
      FROM trace_tools tt
      JOIN filtered f ON f.session_id = tt.session_id
      WHERE tt.tool_name IS NOT NULL AND tt.tool_name != ''
      GROUP BY tt.tool_name, tt.session_id
    )
    SELECT
      tool_name,
      COUNT(*) AS sessions,
      COUNT(DISTINCT run_id) AS runs,
      SUM(calls) AS calls,
      SUM(successes) AS successes,
      SUM(failures) AS failures,
      SUM(durationMs) AS durationMs,
      SUM(COALESCE(turn_count, 0)) AS totalTurns,
      SUM(COALESCE(total_cost, 0)) AS totalCost,
      (SELECT COALESCE(NULLIF(tt2.error, ''), tt2.result, '')
       FROM trace_tools tt2 JOIN filtered f2 ON f2.session_id = tt2.session_id
       WHERE tt2.tool_name = tool_sessions.tool_name AND tt2.success = 0
       ORDER BY f2.start_time DESC, f2.session_id,
                tt2.turn_number, tt2.ordinal LIMIT 1) AS sampleError,
      (SELECT ts2.session_id FROM tool_sessions ts2
       WHERE ts2.tool_name = tool_sessions.tool_name
       ORDER BY ts2.start_time DESC, ts2.session_id LIMIT 1) AS sampleSessionId,
      (SELECT ts2.run_id FROM tool_sessions ts2
       WHERE ts2.tool_name = tool_sessions.tool_name
       ORDER BY ts2.start_time DESC, ts2.session_id LIMIT 1) AS sampleRunId,
      MAX(start_time) AS firstStartTime,
      (SELECT ts2.firstPosition FROM tool_sessions ts2
       WHERE ts2.tool_name = tool_sessions.tool_name
       ORDER BY ts2.start_time DESC, ts2.session_id LIMIT 1) AS firstOrder
    FROM tool_sessions
    GROUP BY tool_name
    ORDER BY failures DESC, calls DESC, sessions DESC,
             firstStartTime DESC, firstOrder
  `).all(params) as Array<Record<string, unknown>>;

  // ── 6. Failure breakdown ────────────────────────────────────────────────
  const failureAggs = db.prepare(`
    ${cte}
    , labeled_failures AS (
      SELECT f.*,
        ${failureLabelSql("ts.raw_json", "f.outcome")} AS failureLabel
      FROM filtered f
      JOIN trace_sessions ts ON ts.session_id = f.session_id
    )
    SELECT
      f.failureLabel,
      COUNT(*)                  AS sessions,
      COUNT(DISTINCT f.run_id)  AS runs,
      SUM(COALESCE(f.turn_count, 0)) AS totalTurns,
      SUM(COALESCE(f.total_cost, 0)) AS totalCost,
      (SELECT f2.session_id FROM labeled_failures f2
       WHERE f2.failureLabel = f.failureLabel
       ORDER BY f2.start_time DESC, f2.session_id LIMIT 1) AS sampleSessionId,
      (SELECT f2.run_id FROM labeled_failures f2
       WHERE f2.failureLabel = f.failureLabel
         AND f2.run_id IS NOT NULL AND f2.run_id != ''
       ORDER BY f2.start_time DESC, f2.session_id LIMIT 1) AS sampleRunId
    FROM labeled_failures f
    WHERE f.failureLabel IS NOT NULL
    GROUP BY f.failureLabel
    ORDER BY MAX(f.start_time) DESC, f.failureLabel
  `).all(params) as Array<Record<string, unknown>>;

  // ── 6b. Authoritative run outcomes (issue #45) — the orchestrator's
  //        task_completed run event carries an explicit success flag and a
  //        coarse failure classification. `alreadyLabeled` counts sessions in
  //        the run whose own failure label equals the classification, so the
  //        JS patch below can avoid double-counting a label the session
  //        breakdown already carries (mirrors trace-insights.ts).
  const runOutcomeRows = db.prepare(`
    ${cte}
    SELECT
      re.run_id                                              AS runId,
      json_extract(re.raw_json,'$.data.classification')      AS classification,
      json_extract(re.raw_json,'$.data.success')             AS success,
      (SELECT f2.session_id FROM filtered f2 WHERE f2.run_id = re.run_id
       ORDER BY f2.start_time DESC, f2.session_id LIMIT 1) AS sampleSessionId,
      MAX(f.start_time)                                     AS firstStartTime,
      COUNT(DISTINCT f.session_id)                           AS sessions,
      SUM(COALESCE(f.turn_count, 0))                         AS totalTurns,
      SUM(COALESCE(f.total_cost, 0))                         AS totalCost,
      SUM(CASE WHEN ${failureLabelSql("ts.raw_json", "f.outcome")}
               = json_extract(re.raw_json,'$.data.classification')
               THEN 1 ELSE 0 END)                            AS alreadyLabeled
    FROM trace_run_events re
    JOIN filtered f ON f.run_id = re.run_id
    JOIN trace_sessions ts ON ts.session_id = f.session_id
    WHERE re.type = 'task_completed'
      AND json_extract(re.raw_json,'$.data.classification') IS NOT NULL
    GROUP BY re.run_id
    ORDER BY firstStartTime DESC
  `).all(params) as Array<Record<string, unknown>>;

  // ── 7. Skill breakdown (explicit tool skill + selected plan skills) ──────
  const skillAggs = db.prepare(`
    ${cte}
    , skill_source AS (
      SELECT f.session_id, f.run_id,
             json_extract(ts.raw_json,'$.skillToolMetrics.skillId') AS skillId,
             0 AS position
      FROM filtered f
      JOIN trace_sessions ts ON ts.session_id = f.session_id

      UNION ALL

      SELECT f.session_id, f.run_id,
             json_extract(step.value, '$.selectedSkillId') AS skillId,
             CAST(step.key AS INTEGER) + 1 AS position
      FROM filtered f
      JOIN trace_sessions ts ON ts.session_id = f.session_id
      JOIN json_each(ts.raw_json, '$.planDecomposition.steps') step
    ),
    skill_sessions AS (
      SELECT skillId, session_id, MIN(position) AS firstPosition
      FROM skill_source
      WHERE skillId IS NOT NULL AND skillId != ''
      GROUP BY skillId, session_id
    )
    SELECT
      ss.skillId,
      COUNT(*) AS sessions,
      COUNT(DISTINCT f.run_id) AS runs,
      SUM(CASE WHEN f.outcome IN ('completed','success') THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN f.outcome NOT IN ('completed','success') OR f.outcome IS NULL
               THEN 1 ELSE 0 END) AS failures,
      SUM(COALESCE(f.turn_count, 0)) AS totalTurns,
      SUM(COALESCE(f.total_cost, 0)) AS totalCost,
      (SELECT ss2.session_id FROM skill_sessions ss2
       JOIN filtered f2 ON f2.session_id = ss2.session_id
       WHERE ss2.skillId = ss.skillId
       ORDER BY f2.start_time DESC, f2.session_id LIMIT 1) AS sampleSessionId,
      (SELECT f2.run_id FROM skill_sessions ss2
       JOIN filtered f2 ON f2.session_id = ss2.session_id
       WHERE ss2.skillId = ss.skillId
       ORDER BY f2.start_time DESC, f2.session_id LIMIT 1) AS sampleRunId
    FROM skill_sessions ss
    JOIN filtered f ON f.session_id = ss.session_id
    GROUP BY ss.skillId
    ORDER BY failures DESC, sessions DESC, MAX(f.start_time) DESC,
             MIN(ss.firstPosition)
  `).all(params) as Array<Record<string, unknown>>;

  // ── 8. Event type breakdown (turn, session, and run events) ──────────────
  const eventAggs = db.prepare(`
    ${cte}
    , filtered_runs AS (
      SELECT run_id, session_id AS sample_session_id, start_time
      FROM (
        SELECT f.run_id, f.session_id, f.start_time,
               ROW_NUMBER() OVER (
                 PARTITION BY f.run_id
                 ORDER BY f.start_time DESC, f.session_id
               ) AS rank
        FROM filtered f
        WHERE f.run_id IS NOT NULL AND f.run_id != ''
      )
      WHERE rank = 1
    ),
    event_source AS (
      SELECT
        t.session_id AS session_id,
        f.run_id AS run_id,
        json_extract(ev.value, '$.type') AS type,
        json_extract(ev.value, '$.data.type') AS data_type,
        json_extract(ev.value, '$.data.outcome') AS data_outcome,
        1 AS escalation_source,
        f.start_time AS start_time,
        printf('%s:0:%09d:%09d', t.session_id, t.turn_number,
               CAST(ev.key AS INTEGER)) AS firstOrder
      FROM trace_turns t
      JOIN filtered f ON f.session_id = t.session_id
      JOIN json_each(t.raw_json, '$.events') ev

      UNION ALL

      SELECT
        f.session_id AS session_id,
        f.run_id AS run_id,
        json_extract(ev.value, '$.type') AS type,
        json_extract(ev.value, '$.data.type') AS data_type,
        json_extract(ev.value, '$.data.outcome') AS data_outcome,
        1 AS escalation_source,
        f.start_time AS start_time,
        printf('%s:1:%09d', f.session_id, CAST(ev.key AS INTEGER)) AS firstOrder
      FROM filtered f
      JOIN trace_sessions ts ON ts.session_id = f.session_id
      JOIN json_each(ts.raw_json, '$.events') ev

      UNION ALL

      SELECT
        fr.sample_session_id AS session_id,
        re.run_id AS run_id,
        re.type AS type,
        NULL AS data_type,
        NULL AS data_outcome,
        0 AS escalation_source,
        fr.start_time AS start_time,
        printf('%s:2:%09d', fr.sample_session_id, re.ordinal) AS firstOrder
      FROM trace_run_events re
      JOIN filtered_runs fr ON fr.run_id = re.run_id
    ),
    event_sessions AS (
      SELECT type, session_id, run_id, MAX(start_time) AS start_time,
             COUNT(*) AS calls,
             MIN(firstOrder) AS firstOrder
      FROM event_source
      WHERE type IS NOT NULL AND type != ''
      GROUP BY type, session_id
    ), ranked_event_sessions AS (
      SELECT es.*,
             ROW_NUMBER() OVER (
               PARTITION BY type ORDER BY start_time DESC, session_id
             ) AS sampleRank,
             ROW_NUMBER() OVER (
               PARTITION BY type ORDER BY start_time DESC, firstOrder
             ) AS orderRank
      FROM event_sessions es
    ), escalation_stats AS (
      SELECT
        COUNT(DISTINCT CASE WHEN type = 'escalation'
          OR (type = 'stuck_signal' AND data_type = 'escalate')
          THEN session_id END) AS escalatedSessions,
        SUM(CASE WHEN type = 'escalation'
          OR (type = 'stuck_signal' AND data_type = 'escalate')
          THEN 1 ELSE 0 END) AS escalations,
        SUM(CASE WHEN type = 'escalation_outcome' AND data_outcome = 'rescued'
          THEN 1 ELSE 0 END) AS escalationRescued,
        SUM(CASE WHEN type = 'escalation_outcome' AND data_outcome = 'failed_fast'
          THEN 1 ELSE 0 END) AS escalationFailedFast,
        SUM(CASE WHEN type = 'escalation_outcome' AND data_outcome = 'budget_exhausted'
          THEN 1 ELSE 0 END) AS escalationBudgetExhausted
      FROM event_source
      WHERE escalation_source = 1
    )
    SELECT
      es.type,
      COUNT(*) AS sessions,
      COUNT(DISTINCT es.run_id) AS runs,
      SUM(es.calls) AS calls,
      SUM(COALESCE(f.turn_count, 0)) AS totalTurns,
      SUM(COALESCE(f.total_cost, 0)) AS totalCost,
      MAX(CASE WHEN es.sampleRank = 1 THEN es.session_id END) AS sampleSessionId,
      MAX(CASE WHEN es.sampleRank = 1 THEN es.run_id END) AS sampleRunId,
      MAX(es.start_time) AS firstStartTime,
      MAX(CASE WHEN es.orderRank = 1 THEN es.firstOrder END) AS firstOrder,
      MAX(st.escalatedSessions) AS escalatedSessions,
      MAX(st.escalations) AS escalations,
      MAX(st.escalationRescued) AS escalationRescued,
      MAX(st.escalationFailedFast) AS escalationFailedFast,
      MAX(st.escalationBudgetExhausted) AS escalationBudgetExhausted
    FROM ranked_event_sessions es
    JOIN filtered f ON f.session_id = es.session_id
    CROSS JOIN escalation_stats st
    GROUP BY es.type
    ORDER BY calls DESC, sessions DESC, firstStartTime DESC, firstOrder
  `).all(params) as Array<Record<string, unknown>>;
  const escr = eventAggs[0] ?? {};

  // ── 9. Run rows ─────────────────────────────────────────────────────────
  const runAggs = db.prepare(`
    ${cte}
    SELECT
      f.run_id,
      (SELECT f2.query FROM filtered f2 WHERE f2.run_id = f.run_id
       ORDER BY f2.start_time DESC, f2.session_id LIMIT 1) AS query,
      COALESCE((SELECT f2.outcome FROM filtered f2
                WHERE f2.run_id = f.run_id
                  AND f2.outcome NOT IN ('completed','success')
                ORDER BY f2.start_time ASC, f2.session_id LIMIT 1),
               'completed')                                                            AS outcome,
      COUNT(*)                                                                        AS sessions,
      SUM(CASE WHEN f.outcome NOT IN ('completed','success') OR f.outcome IS NULL
               THEN 1 ELSE 0 END)                                                   AS failedSessions,
      SUM(COALESCE(f.turn_count, 0))                                                  AS totalTurns,
      SUM(COALESCE(f.total_cost, 0))                                                  AS totalCost,
      MAX(f.end_time) - MIN(f.start_time)                                             AS durationMs,
      (SELECT f2.session_id FROM filtered f2 WHERE f2.run_id = f.run_id
       ORDER BY f2.start_time ASC, f2.session_id LIMIT 1) AS sampleSessionId
    FROM filtered f
    JOIN trace_sessions ts ON ts.session_id = f.session_id
    WHERE f.run_id IS NOT NULL AND f.run_id != ''
    GROUP BY f.run_id
    ORDER BY durationMs DESC, MAX(f.start_time) DESC, f.run_id
    LIMIT ${MAX_INSIGHTS_RUN_ROWS}
  `).all(params) as Array<Record<string, unknown>>;

  const runToolRows = db.prepare(`
    ${cte}
    , run_tool_sessions AS (
      SELECT f.run_id, f.session_id, f.start_time, tt.tool_name,
             COUNT(*) AS calls,
             MIN(printf('%09d:%09d', tt.turn_number, tt.ordinal)) AS firstPosition
      FROM trace_tools tt
      JOIN filtered f ON f.session_id = tt.session_id
      WHERE f.run_id IS NOT NULL AND f.run_id != ''
        AND tt.tool_name IS NOT NULL AND tt.tool_name != ''
      GROUP BY f.run_id, f.session_id, tt.tool_name
    ), ranked_run_tool_sessions AS (
      SELECT rts.*,
             ROW_NUMBER() OVER (
               PARTITION BY rts.run_id, rts.tool_name
               ORDER BY rts.start_time DESC, rts.session_id
             ) AS firstRank
      FROM run_tool_sessions rts
    )
    SELECT
      rts.run_id,
      rts.tool_name,
      SUM(rts.calls) AS calls,
      MAX(rts.start_time) AS firstStartTime,
      MAX(CASE WHEN rts.firstRank = 1 THEN rts.firstPosition END) AS firstOrder
    FROM ranked_run_tool_sessions rts
    GROUP BY rts.run_id, rts.tool_name
    ORDER BY rts.run_id, calls DESC, firstStartTime DESC, firstOrder
  `).all(params) as Array<Record<string, unknown>>;

  const runSkillRows = db.prepare(`
    ${cte}
    , skill_source AS (
      SELECT
        f.run_id AS run_id,
        f.session_id AS session_id,
        f.start_time AS start_time,
        json_extract(ts.raw_json,'$.skillToolMetrics.skillId') AS skill_id,
        0 AS position
      FROM filtered f
      JOIN trace_sessions ts ON ts.session_id = f.session_id
      WHERE f.run_id IS NOT NULL AND f.run_id != ''

      UNION ALL

      SELECT
        f.run_id AS run_id,
        f.session_id AS session_id,
        f.start_time AS start_time,
        json_extract(step.value, '$.selectedSkillId') AS skill_id,
        CAST(step.key AS INTEGER) + 1 AS position
      FROM filtered f
      JOIN trace_sessions ts ON ts.session_id = f.session_id
      JOIN json_each(ts.raw_json, '$.planDecomposition.steps') step
      WHERE f.run_id IS NOT NULL AND f.run_id != ''
    ), skill_sessions AS (
      SELECT run_id, session_id, skill_id, MAX(start_time) AS start_time,
             MIN(position) AS firstPosition
      FROM skill_source
      WHERE skill_id IS NOT NULL AND skill_id != ''
      GROUP BY run_id, session_id, skill_id
    )
    SELECT
      run_id,
      skill_id,
      COUNT(*) AS calls
    FROM skill_sessions
    GROUP BY run_id, skill_id
    ORDER BY run_id, calls DESC, MAX(start_time) DESC, MIN(firstPosition)
  `).all(params) as Array<Record<string, unknown>>;

  const topByRun = (
    rows: Array<Record<string, unknown>>,
    valueKey: string,
  ): Map<string, string[]> => {
    const result = new Map<string, string[]>();
    for (const row of rows) {
      const runId = asString(row.run_id);
      const value = asString(row[valueKey]);
      if (!runId || !value) continue;
      const values = result.get(runId) ?? [];
      if (values.length >= 3) continue;
      values.push(value);
      result.set(runId, values);
    }
    return result;
  };
  const topToolsByRun = topByRun(runToolRows, "tool_name");
  const topSkillsByRun = topByRun(runSkillRows, "skill_id");

  // ── 10. Facets ──────────────────────────────────────────────────────────
  const toStr = (rows: Array<Record<string, unknown>>, key: string) =>
    rows.map((r) => asString(r[key])).filter(Boolean);

  const facetRuns = toStr(
    db.prepare(
      `${cte} SELECT DISTINCT run_id FROM filtered WHERE run_id IS NOT NULL AND run_id != '' ORDER BY run_id LIMIT ${MAX_INSIGHTS_FACET_IDS}`,
    ).all(params) as Array<Record<string, unknown>>,
    "run_id",
  );
  const facetSessions = toStr(
    db.prepare(
      `${cte} SELECT session_id FROM filtered ORDER BY session_id LIMIT ${MAX_INSIGHTS_FACET_IDS}`,
    ).all(params) as Array<Record<string, unknown>>,
    "session_id",
  );
  const facetDomains = toStr(
    db.prepare(
      `${cte} SELECT DISTINCT domain FROM filtered WHERE domain IS NOT NULL AND domain != '' ORDER BY domain`,
    ).all(params) as Array<Record<string, unknown>>,
    "domain",
  );
  const facetModels = modelSessionAggs
    .filter((row) => asNumber(row.calls) > 0)
    .map((row) => asString(row.model)).sort();

  // ── Compute estimated costs per model (O(M) instead of O(N turns)) ──────
  let estimatedInputCost = 0;
  let estimatedCachedInputCost = 0;
  let estimatedOutputCost = 0;
  let unpricedRequests = 0;

  for (const row of modelAggs) {
    const model = asString(row.model);
    const providerId =
      asProviderId(row.provider) ?? inferProviderIdFromModel(model);
    const pricingModel = pricingModelForNormalizedId(providerId, model);
    const breakdown = providerId
      ? estimateCostBreakdownUsd(providerId, pricingModel, {
          prompt_tokens: asNumber(row.promptTokens),
          completion_tokens: asNumber(row.completionTokens),
          total_tokens: asNumber(row.totalTokens),
          cached_tokens: asNumber(row.cachedTokens),
        })
      : null;
    if (breakdown) {
      estimatedInputCost += breakdown.inputCostUsd;
      estimatedCachedInputCost += breakdown.cachedInputCostUsd;
      estimatedOutputCost += breakdown.outputCostUsd;
    } else {
      unpricedRequests += asNumber(row.pricedRequestCandidates);
    }
  }

  const estimatedRequestCost =
    estimatedInputCost + estimatedCachedInputCost + estimatedOutputCost;

  // ── Assemble summary ────────────────────────────────────────────────────
  const totalSessions = asNumber(sr.totalSessions);
  const totalRuns = asNumber(sr.totalRuns);
  const completedSessions = asNumber(sr.completedSessions);
  const failedSessions = asNumber(sr.failedSessions);
  const totalTurns = asNumber(sr.totalTurns);
  const llmRequests = asNumber(tr.llmRequests);
  const promptTokens = asNumber(tr.promptTokens);
  const cachedTokens = asNumber(tr.cachedTokens);
  const completionTokens = asNumber(tr.completionTokens);
  const totalTokens = asNumber(tr.totalTokens);
  const requestCost = asNumber(tr.requestCost);
  const totalLlmDurationMs = asNumber(tr.totalLlmDurationMs);
  const toolCalls = asNumber(toolr.toolCalls);
  const toolFailures = asNumber(toolr.toolFailures);

  const summary: TraceInsightsSummary = {
    totalSessions,
    totalRuns,
    completedSessions,
    failedSessions,
    successRate: totalSessions > 0 ? completedSessions / totalSessions : 0,
    failureRate: totalSessions > 0 ? failedSessions / totalSessions : 0,
    totalTurns,
    averageTurns: totalSessions > 0 ? totalTurns / totalSessions : 0,
    totalCost: asNumber(sr.totalCost),
    averageDurationMs: asNumber(sr.averageDurationMs),
    toolCalls,
    toolFailures,
    toolFailureRate: toolCalls > 0 ? toolFailures / toolCalls : 0,
    llmRequests,
    promptTokens,
    completionTokens,
    cachedTokens,
    nonCachedInputTokens: Math.max(0, promptTokens - cachedTokens),
    totalTokens,
    requestCost,
    estimatedInputCost,
    estimatedCachedInputCost,
    estimatedOutputCost,
    estimatedRequestCost,
    outputTokenShare: totalTokens > 0 ? completionTokens / totalTokens : 0,
    outputCostShare:
      estimatedRequestCost > 0 ? estimatedOutputCost / estimatedRequestCost : 0,
    unpricedRequests,
    averagePromptTokens: asNumber(tr.averagePromptTokens),
    averageCompletionTokens: asNumber(tr.averageCompletionTokens),
    averageTotalTokens: asNumber(tr.averageTotalTokens),
    totalLlmDurationMs,
    averageLlmDurationMs: asNumber(tr.averageLlmDurationMs),
    partialHandoffCount: asNumber(sr.partialHandoffCount),
    maxTurnsWithHandoffCount: asNumber(sr.maxTurnsWithHandoffCount),
    maxTurnsWithoutUsefulProgressCount: asNumber(
      sr.maxTurnsWithoutUsefulProgressCount,
    ),
    escalatedSessions: asNumber(escr.escalatedSessions),
    escalations: asNumber(escr.escalations),
    escalationRescued: asNumber(escr.escalationRescued),
    escalationFailedFast: asNumber(escr.escalationFailedFast),
    escalationBudgetExhausted: asNumber(escr.escalationBudgetExhausted),
    escalationFireRate:
      totalSessions > 0 ? asNumber(escr.escalatedSessions) / totalSessions : 0,
    escalationRescueRate: (() => {
      const resolved =
        asNumber(escr.escalationRescued) +
        asNumber(escr.escalationFailedFast) +
        asNumber(escr.escalationBudgetExhausted);
      return resolved > 0 ? asNumber(escr.escalationRescued) / resolved : 0;
    })(),
  };

  // ── Model rows ──────────────────────────────────────────────────────────
  const models: TraceInsightsMetricRow[] = modelAggs.map((row) => {
    const model = asString(row.model);
    const sessionRow = modelSessionById.get(model);
    const calls = asNumber(sessionRow?.calls);
    const successes = asNumber(sessionRow?.successes);
    const failures = asNumber(sessionRow?.failures);
    const mRequests = asNumber(row.requests);
    const mPrompt = asNumber(row.promptTokens);
    const mCached = asNumber(row.cachedTokens);
    const mCompletion = asNumber(row.completionTokens);
    const mTotal = asNumber(row.totalTokens);
    const mReqCost = asNumber(row.requestCost);
    const providerId =
      asProviderId(row.provider) ?? inferProviderIdFromModel(model);
    const pricingModel = pricingModelForNormalizedId(providerId, model);
    const bd = providerId
      ? estimateCostBreakdownUsd(providerId, pricingModel, {
          prompt_tokens: mPrompt,
          completion_tokens: mCompletion,
          total_tokens: mTotal,
          cached_tokens: mCached,
        })
      : null;
    const mEstInput = bd?.inputCostUsd ?? 0;
    const mEstCached = bd?.cachedInputCostUsd ?? 0;
    const mEstOutput = bd?.outputCostUsd ?? 0;
    const mEstReq = mEstInput + mEstCached + mEstOutput;
    return {
      id: model,
      label: model,
      sessions: asNumber(row.sessions),
      runs: asNumber(row.runs),
      calls: calls || undefined,
      requests: mRequests || undefined,
      successes: successes || undefined,
      failures: failures || undefined,
      failureRate: calls > 0 ? failures / calls : undefined,
      averageDurationMs: calls > 0 && asNumber(row.durationMs) > 0
        ? asNumber(row.durationMs) / calls : undefined,
      totalTurns: asNumber(sessionRow?.totalTurns) || undefined,
      totalCost: asNumber(sessionRow?.totalCost) || undefined,
      promptTokens: mPrompt || undefined,
      cachedTokens: mCached || undefined,
      completionTokens: mCompletion || undefined,
      totalTokens: mTotal || undefined,
      requestCost: mReqCost || undefined,
      estimatedInputCost: mEstInput || undefined,
      estimatedCachedInputCost: mEstCached || undefined,
      estimatedOutputCost: mEstOutput || undefined,
      estimatedRequestCost: mEstReq || undefined,
      outputTokenShare: mTotal > 0 ? mCompletion / mTotal : undefined,
      outputCostShare: mEstReq > 0 ? mEstOutput / mEstReq : undefined,
      unpricedRequests: bd ? undefined : asNumber(row.pricedRequestCandidates) || undefined,
      sampleSessionId: asString(row.sampleSessionId) || undefined,
      sampleRunId: asString(row.sampleRunId) || undefined,
    };
  });
  const modelOrder = new Map(modelAggs.map((row) => [asString(row.model), row]));
  models.sort((a, b) =>
    (b.failures ?? 0) - (a.failures ?? 0) ||
    (b.calls ?? 0) - (a.calls ?? 0) ||
    b.sessions - a.sessions ||
    asNumber(modelOrder.get(b.id)?.firstStartTime) -
      asNumber(modelOrder.get(a.id)?.firstStartTime) ||
    asNumber(modelOrder.get(a.id)?.firstPosition) -
      asNumber(modelOrder.get(b.id)?.firstPosition));

  // ── Tool rows ───────────────────────────────────────────────────────────
  const tools: TraceInsightsMetricRow[] = toolAggs.map((row) => {
    const calls = asNumber(row.calls);
    const failures = asNumber(row.failures);
    const successes = asNumber(row.successes);
    const durationMs = asNumber(row.durationMs);
    const totalTurns = asNumber(row.totalTurns);
    const totalCost = asNumber(row.totalCost);
    return {
      id: asString(row.tool_name),
      label: asString(row.tool_name),
      sessions: asNumber(row.sessions),
      runs: asNumber(row.runs),
      calls,
      successes: successes || undefined,
      failures: failures || undefined,
      failureRate: calls > 0 ? failures / calls : undefined,
      averageDurationMs: calls > 0 && durationMs > 0 ? durationMs / calls : undefined,
      totalTurns: totalTurns || undefined,
      totalCost: totalCost || undefined,
      sampleSessionId: asString(row.sampleSessionId) || undefined,
      sampleRunId: asString(row.sampleRunId) || undefined,
      sampleError: row.sampleError == null ? undefined : asString(row.sampleError),
    };
  });

  // ── Failure rows ────────────────────────────────────────────────────────
  const failures: TraceInsightsMetricRow[] = failureAggs.map((row) => ({
    id: asString(row.failureLabel),
    label: asString(row.failureLabel),
    sessions: asNumber(row.sessions),
    runs: asNumber(row.runs),
    calls: asNumber(row.sessions),
    failures: asNumber(row.sessions),
    failureRate: 1,
    totalTurns: asNumber(row.totalTurns) || undefined,
    totalCost: asNumber(row.totalCost) || undefined,
    sampleSessionId: asString(row.sampleSessionId) || undefined,
    sampleRunId: asString(row.sampleRunId) || undefined,
  }));

  // ── Skill rows ──────────────────────────────────────────────────────────
  const skills: TraceInsightsMetricRow[] = skillAggs.map((row) => {
    const calls = asNumber(row.sessions);
    const successes = asNumber(row.successes);
    const failures = asNumber(row.failures);
    return {
      id: asString(row.skillId),
      label: asString(row.skillId),
      sessions: calls,
      runs: asNumber(row.runs),
      calls,
      successes: successes || undefined,
      failures: failures || undefined,
      failureRate: calls > 0 ? failures / calls : undefined,
      totalTurns: asNumber(row.totalTurns) || undefined,
      totalCost: asNumber(row.totalCost) || undefined,
      sampleSessionId: asString(row.sampleSessionId) || undefined,
      sampleRunId: asString(row.sampleRunId) || undefined,
    };
  });

  // ── Event rows ──────────────────────────────────────────────────────────
  const events: TraceInsightsMetricRow[] = eventAggs.map((row) => ({
    id: asString(row.type),
    label: asString(row.type),
    sessions: asNumber(row.sessions),
    runs: asNumber(row.runs),
    calls: asNumber(row.calls),
    failureRate: 0,
    totalTurns: asNumber(row.totalTurns) || undefined,
    totalCost: asNumber(row.totalCost) || undefined,
    sampleSessionId: asString(row.sampleSessionId) || undefined,
    sampleRunId: asString(row.sampleRunId) || undefined,
  }));

  // ── Run rows ────────────────────────────────────────────────────────────
  const runs: TraceInsightsRunRow[] = runAggs.map((row) => ({
    runId: asString(row.run_id),
    query: truncateText(asString(row.query)),
    outcome: asString(row.outcome),
    sessions: asNumber(row.sessions),
    failedSessions: asNumber(row.failedSessions),
    totalTurns: asNumber(row.totalTurns),
    totalCost: asNumber(row.totalCost),
    durationMs: asNumber(row.durationMs),
    topTools: topToolsByRun.get(asString(row.run_id)) ?? [],
    topSkills: topSkillsByRun.get(asString(row.run_id)) ?? [],
    sampleSessionId: asString(row.sampleSessionId),
  }));

  // Authoritative run outcomes override the per-session rollup, and failed
  // classifications no session already labels join the failure rows.
  const runOutcomes = new Map(
    runOutcomeRows.map((row) => [asString(row.runId), row]),
  );
  for (const run of runs) {
    const row = runOutcomes.get(run.runId);
    if (!row) continue;
    run.outcome =
      asNumber(row.success) === 1 ? "completed" : asString(row.classification);
  }
  for (const row of runOutcomeRows) {
    if (asNumber(row.success) === 1 || asNumber(row.alreadyLabeled) > 0) {
      continue;
    }
    const label = asString(row.classification);
    if (!label) continue;
    const existing = failures.find((item) => item.id === label);
    if (existing) {
      existing.sessions += asNumber(row.sessions);
      existing.runs += 1;
      existing.calls = (existing.calls ?? 0) + 1;
      existing.failures = (existing.failures ?? 0) + 1;
      existing.totalTurns =
        (existing.totalTurns ?? 0) + asNumber(row.totalTurns) || undefined;
      existing.totalCost =
        (existing.totalCost ?? 0) + asNumber(row.totalCost) || undefined;
    } else {
      failures.push({
        id: label,
        label,
        sessions: asNumber(row.sessions),
        runs: 1,
        calls: 1,
        failures: 1,
        failureRate: 1,
        totalTurns: asNumber(row.totalTurns) || undefined,
        totalCost: asNumber(row.totalCost) || undefined,
        sampleSessionId: asString(row.sampleSessionId) || undefined,
        sampleRunId: asString(row.runId) || undefined,
      });
    }
  }
  failures.sort((a, b) =>
    (b.failures ?? 0) - (a.failures ?? 0) ||
    (b.calls ?? 0) - (a.calls ?? 0) ||
    b.sessions - a.sessions);

  // ── Facets ──────────────────────────────────────────────────────────────
  const sortedIds = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
  const facets: TraceInsightsFacets = {
    runs: facetRuns,
    sessions: facetSessions,
    domains: facetDomains,
    models: facetModels,
    skills: sortedIds(skillAggs.map((r) => asString(r.skillId))),
    tools: sortedIds(toolAggs.map((r) => asString(r.tool_name))),
    failures: sortedIds(failures.map((r) => r.id)),
    eventTypes: sortedIds(eventAggs.map((r) => asString(r.type))),
  };

  return { summary, facets, tools, skills, models, failures, events, runs };
}

/** Empty response used when no sessions match the active filters. */
function buildEmptyInsightsResponse(): TraceInsightsResponse {
  return {
    summary: {
      totalSessions: 0, totalRuns: 0, completedSessions: 0, failedSessions: 0,
      successRate: 0, failureRate: 0, totalTurns: 0, averageTurns: 0, totalCost: 0,
      averageDurationMs: 0, toolCalls: 0, toolFailures: 0, toolFailureRate: 0,
      llmRequests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0,
      nonCachedInputTokens: 0, totalTokens: 0, requestCost: 0, estimatedInputCost: 0,
      estimatedCachedInputCost: 0, estimatedOutputCost: 0, estimatedRequestCost: 0,
      outputTokenShare: 0, outputCostShare: 0, unpricedRequests: 0,
      averagePromptTokens: 0, averageCompletionTokens: 0, averageTotalTokens: 0,
      totalLlmDurationMs: 0, averageLlmDurationMs: 0,
      partialHandoffCount: 0, maxTurnsWithHandoffCount: 0, maxTurnsWithoutUsefulProgressCount: 0,
      escalatedSessions: 0, escalations: 0, escalationRescued: 0,
      escalationFailedFast: 0, escalationBudgetExhausted: 0,
      escalationFireRate: 0, escalationRescueRate: 0,
    },
    facets: { runs: [], sessions: [], domains: [], models: [], skills: [], tools: [], failures: [], eventTypes: [] },
    tools: [], skills: [], models: [], failures: [], events: [], runs: [],
  };
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
    return buildInsightsSql(db, filters);
  } finally {
    db.close();
  }
}

export interface TraceSessionSearchPage {
  items: TraceSessionLike[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/** Indexed, cursor-based session search used by the Viewer list. */
export function searchTraceSessionsFromSqlite(
  projectRoot: string,
  filters: TraceInsightsFilters,
  options: { limit: number; cursor?: string; path?: string },
): TraceSessionSearchPage | null {
  const pathToDb = dbPath(projectRoot, options.path);
  const db = openReadonly(pathToDb);
  if (!db) return null;
  try {
    const { whereSql, params } = buildSessionCteFilter(filters);
    const baseCondition = whereSql.replace(/^WHERE\s+/i, "");
    const cursor = options.cursor ?? "";
    const separator = cursor.indexOf("|");
    const cursorStart = separator > 0 ? Number(cursor.slice(0, separator)) : NaN;
    const cursorSession = separator > 0 ? cursor.slice(separator + 1) : "";
    const cursorCondition = Number.isFinite(cursorStart)
      ? "(s.start_time < @_cursorStart OR (s.start_time = @_cursorStart AND s.session_id > @_cursorSession))"
      : "";
    const pageWhere = [baseCondition, cursorCondition]
      .filter(Boolean)
      .join(" AND ");
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(options.limit)));
    const queryParams = {
      ...params,
      _cursorStart: Number.isFinite(cursorStart) ? cursorStart : 0,
      _cursorSession: cursorSession,
      _pageLimit: boundedLimit + 1,
    };
    const rows = db
      .prepare(
        `SELECT session_id, raw_json, run_id, source, start_time, end_time,
          outcome, query, start_url, turn_count, total_cost
        FROM trace_sessions s
        ${pageWhere ? `WHERE ${pageWhere}` : ""}
        ORDER BY start_time DESC, session_id ASC
        LIMIT @_pageLimit`,
      )
      .all(queryParams) as Array<Record<string, unknown>>;
    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS count FROM trace_sessions s ${whereSql}`,
      )
      .get(params) as { count?: unknown };
    const hasMore = rows.length > boundedLimit;
    const pageRows = rows.slice(0, boundedLimit);
    const items = pageRows.map((row) => ({
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
      ...parseJson<Record<string, unknown>>(row.raw_json, {}),
    })) as TraceSessionLike[];
    const last = items.at(-1);
    return {
      items,
      total: asNumber(totalRow.count),
      hasMore,
      nextCursor:
        hasMore && last
          ? `${last.startTime ?? 0}|${last.sessionId ?? ""}`
          : null,
    };
  } finally {
    db.close();
  }
}

/** Build the Analytics time series in one indexed SQL query. */
export function buildTraceTrendsFromSqlite(
  projectRoot: string,
  filters: TraceInsightsFilters,
  limit = 30,
  path?: string,
): TraceTrendPoint[] | null {
  const pathToDb = dbPath(projectRoot, path);
  const db = openReadonly(pathToDb);
  if (!db) return null;
  try {
    const { whereSql, params } = buildSessionCteFilter({
      ...filters,
      day: undefined,
    });
    const boundedLimit = Math.max(1, Math.min(365, Math.floor(limit)));
    const rows = db
      .prepare(
        `WITH filtered AS (
          SELECT s.* FROM trace_sessions s ${whereSql}
        ), recent_days AS (
          SELECT
            day,
            COUNT(*) AS total_sessions,
            SUM(CASE WHEN outcome IN ('completed', 'success') THEN 1 ELSE 0 END)
              AS completed_sessions,
            SUM(COALESCE(total_cost, 0)) AS total_cost,
            AVG(COALESCE(turn_count, 0)) AS average_turns
          FROM filtered
          WHERE day IS NOT NULL AND day != ''
          GROUP BY day
          ORDER BY day DESC
          LIMIT @_trendLimit
        )
        SELECT * FROM recent_days ORDER BY day ASC`,
      )
      .all({ ...params, _trendLimit: boundedLimit }) as Array<
      Record<string, unknown>
    >;
    return rows.map((row) => {
      const totalSessions = asNumber(row.total_sessions);
      const completedSessions = asNumber(row.completed_sessions);
      return {
        day: asString(row.day),
        totalSessions,
        completedSessions,
        successRate:
          totalSessions > 0 ? completedSessions / totalSessions : 0,
        recordedCost: asNumber(row.total_cost),
        averageTurns: asNumber(row.average_turns),
      };
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
