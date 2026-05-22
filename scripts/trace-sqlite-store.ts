import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import {
  buildTraceInsights,
  type TraceInsightsFilters,
  type TraceInsightsResponse,
} from "./trace-insights";
import {
  isIsoDay,
  type TraceEntryLike,
  type TraceSessionLike,
} from "./log-server-helpers";

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

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
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

function openWritable(projectRoot: string, path?: string): Database.Database {
  const pathToDb = dbPath(projectRoot, path);
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
    db.close();
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
        model: asString(llmRequest?.model) || null,
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
    db.close();
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
    db.close();
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
    db.close();
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
    db.close();
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

export function buildTraceInsightsFromSqlite(
  projectRoot: string,
  filters: TraceInsightsFilters,
  path?: string,
): TraceInsightsResponse | null {
  const pathToDb = dbPath(projectRoot, path);
  const db = openReadonly(pathToDb);
  if (!db) return null;

  try {
    const sessionFilter = sessionInsightFilterSql(filters);
    const sessionRows = db
      .prepare(
        `SELECT session_id, raw_json, run_id, source, start_time, end_time,
          outcome, query, start_url, turn_count, total_cost
        FROM trace_sessions
        ${sessionFilter.whereSql}
        ORDER BY start_time DESC`,
      )
      .all(sessionFilter.params) as Array<Record<string, unknown>>;
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
    const entriesByKey = new Map<string, TraceEntryLike>();
    const modelsBySession = new Map<string, Set<string>>();
    const sessionIds = sessions
      .map((session) => asString(session.sessionId))
      .filter((sessionId) => sessionId.length > 0);
    for (const batch of chunks(sessionIds, 500)) {
      const placeholders = batch.map(() => "?").join(", ");
      for (const row of db
        .prepare(
          `SELECT session_id, turn_number, model, model_tier, provider,
            prompt_tokens, cached_tokens, completion_tokens, total_tokens, cost,
            duration_ms
          FROM trace_turns
          WHERE session_id IN (${placeholders})
          ORDER BY session_id, turn_number`,
        )
        .all(...batch) as Array<Record<string, unknown>>) {
        const sessionId = asString(row.session_id);
        const turnNumber = asNumber(row.turn_number);
        if (!sessionId || turnNumber <= 0) continue;
        const entry: TraceEntryLike = {
          sessionId,
          turnNumber,
          toolExecutions: [],
        };
        const model = asString(row.model);
        const modelTier = asString(row.model_tier);
        const provider = asString(row.provider);
        const promptTokens = asNumber(row.prompt_tokens);
        const cachedTokens = Math.max(
          0,
          Math.min(asNumber(row.cached_tokens), promptTokens),
        );
        const completionTokens = asNumber(row.completion_tokens);
        const totalTokens = asNumber(row.total_tokens);
        const cost = asNumber(row.cost);
        const durationMs = asNumber(row.duration_ms);
        if (model) {
          const models = modelsBySession.get(sessionId) ?? new Set<string>();
          models.add(model);
          modelsBySession.set(sessionId, models);
        }
        if (
          model ||
          modelTier ||
          provider ||
          promptTokens > 0 ||
          cachedTokens > 0 ||
          completionTokens > 0 ||
          totalTokens > 0 ||
          cost > 0 ||
          durationMs > 0
        ) {
          entry.llmRequest = {
            ...(model ? { model } : {}),
            ...(modelTier === "executor" || modelTier === "planner"
              ? { modelTier }
              : {}),
            ...(provider ? { provider } : {}),
          };
          entry.llmResponse = {
            durationMs,
            usage: {
              prompt_tokens: promptTokens,
              cached_tokens: cachedTokens,
              completion_tokens: completionTokens,
              total_tokens: totalTokens,
              cost,
            },
          };
        }
        entriesByKey.set(`${sessionId}:${turnNumber}`, entry);
        const entries = entriesBySession.get(sessionId) ?? [];
        entries.push(entry);
        entriesBySession.set(sessionId, entries);
      }

      for (const row of db
        .prepare(
          `SELECT session_id, turn_number, tool_name, success, duration_ms,
            error, result
          FROM trace_tools
          WHERE session_id IN (${placeholders})
          ORDER BY session_id, turn_number, ordinal`,
        )
        .all(...batch) as Array<Record<string, unknown>>) {
        const sessionId = asString(row.session_id);
        const turnNumber = asNumber(row.turn_number);
        if (!sessionId || turnNumber <= 0) continue;
        const key = `${sessionId}:${turnNumber}`;
        let entry = entriesByKey.get(key);
        if (!entry) {
          entry = {
            sessionId,
            turnNumber,
            toolExecutions: [],
          };
          entriesByKey.set(key, entry);
          const entries = entriesBySession.get(sessionId) ?? [];
          entries.push(entry);
          entriesBySession.set(sessionId, entries);
        }
        const executions = Array.isArray(entry.toolExecutions)
          ? entry.toolExecutions
          : [];
        executions.push({
          toolName: asString(row.tool_name),
          success: asNumber(row.success) === 1,
          durationMs: asNumber(row.duration_ms),
          error: asString(row.error),
          result: asString(row.result),
        });
        entry.toolExecutions = executions;
      }
    }

    for (const session of sessions) {
      const sessionId = asString(session.sessionId);
      const models = modelsBySession.get(sessionId);
      if (!models || models.size === 0) continue;
      session.models = Array.from(
        new Set([
          ...(Array.isArray(session.models)
            ? session.models.filter(
                (model): model is string =>
                  typeof model === "string" && model.length > 0,
              )
            : []),
          ...models,
        ]),
      );
    }

    const runEventsByRun = new Map<string, TraceEntryLike[]>();
    const runIds = Array.from(
      new Set(
        sessions
          .map((session) => asString(session.runId))
          .filter((runId) => runId.length > 0),
      ),
    );
    for (const batch of chunks(runIds, 500)) {
      const placeholders = batch.map(() => "?").join(", ");
      for (const row of db
        .prepare(
          `SELECT run_id, type, role, turn_number, ts
          FROM trace_run_events
          WHERE run_id IN (${placeholders})
          ORDER BY run_id, ordinal`,
        )
        .all(...batch) as Array<Record<string, unknown>>) {
        const runId = asString(row.run_id);
        if (!runId) continue;
        const entry: TraceEntryLike = {
          runId,
          type: asString(row.type),
          role: asString(row.role),
          turn: asNumber(row.turn_number),
          recordedAt: asString(row.ts),
        };
        const events = runEventsByRun.get(runId) ?? [];
        events.push(entry);
        runEventsByRun.set(runId, events);
      }
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
