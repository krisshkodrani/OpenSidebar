import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { normalizeTraceModelId } from "./log-server-helpers";

const DEFAULT_DB_PATH = ".artifacts/trace-index.sqlite";

export interface TraceSqliteIndexOptions {
  projectRoot: string;
  dbPath?: string;
}

export interface TraceSqliteIndexResult {
  dbPath: string;
  sessions: number;
  indexedSessions: number;
  archivedSessions: number;
  orphanTraceFiles: number;
  turns: number;
  tools: number;
  runEvents: number;
  screenshots: number;
}

interface JsonlLine<T> {
  raw: string;
  record: T | null;
}

function readJsonl<T>(path: string): JsonlLine<T>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((raw) => {
      try {
        return { raw, record: JSON.parse(raw) as T };
      } catch {
        return { raw, record: null };
      }
    });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function json(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
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

  const sessionColumns = new Set(
    db
      .prepare("PRAGMA table_info(trace_sessions)")
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  );
  if (!sessionColumns.has("archive_state")) {
    db.exec(
      "ALTER TABLE trace_sessions ADD COLUMN archive_state TEXT NOT NULL DEFAULT 'hot'",
    );
  }

  const artifactColumns = new Set(
    db
      .prepare("PRAGMA table_info(trace_artifacts)")
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  );
  if (!artifactColumns.has("archive_state")) {
    db.exec(
      "ALTER TABLE trace_artifacts ADD COLUMN archive_state TEXT NOT NULL DEFAULT 'hot'",
    );
  }

  const turnColumns = new Set(
    db
      .prepare("PRAGMA table_info(trace_turns)")
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  );
  if (!turnColumns.has("cached_tokens")) {
    db.exec(
      "ALTER TABLE trace_turns ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0",
    );
  }
}

function dayKey(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export function indexTracesToSqlite(
  options: TraceSqliteIndexOptions,
): TraceSqliteIndexResult {
  const projectRoot = options.projectRoot;
  const dbPath = options.dbPath ?? join(projectRoot, DEFAULT_DB_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 3000");
  initSchema(db);

  const traceDir = join(projectRoot, "traces");
  const runDir = join(traceDir, "runs");
  const screenshotDir = join(traceDir, "screenshots");
  const indexPath = join(traceDir, "index.jsonl");
  const archiveRoot = join(projectRoot, ".artifacts", "trace-archive");
  const archiveSessionIndex = join(archiveRoot, "indexes", "sessions.jsonl");
  const archiveRunIndex = join(archiveRoot, "indexes", "runs.jsonl");
  const indexedAt = Date.now();
  const sessions = new Map<
    string,
    { record: Record<string, unknown>; archiveState: "hot" | "archived" }
  >();
  const traceFilesBySession = new Map<string, string>();
  const runFilesByRun = new Map<
    string,
    { path: string; archiveState: "hot" | "archived" }
  >();
  const screenshotFiles: Array<{
    path: string;
    archiveState: "hot" | "archived";
  }> = [];

  for (const line of readJsonl<Record<string, unknown>>(indexPath)) {
    const sessionId = asString(line.record?.sessionId);
    if (!sessionId || !line.record) continue;
    sessions.set(sessionId, { record: line.record, archiveState: "hot" });
  }

  for (const line of readJsonl<Record<string, unknown>>(archiveSessionIndex)) {
    const sessionId = asString(line.record?.sessionId);
    if (!sessionId || !line.record || sessions.has(sessionId)) continue;
    sessions.set(sessionId, { record: line.record, archiveState: "archived" });
  }

  const traceFiles = existsSync(traceDir)
    ? readdirSync(traceDir).filter(
        (file) => file.endsWith(".jsonl") && file !== "index.jsonl",
      )
    : [];
  let orphanTraceFiles = 0;
  for (const file of traceFiles) {
    const sessionId = file.replace(/\.jsonl$/, "");
    const fullPath = join(traceDir, file);
    traceFilesBySession.set(sessionId, fullPath);
    if (sessions.has(sessionId)) continue;
    orphanTraceFiles += 1;
    sessions.set(sessionId, {
      record: {
        sessionId,
        source: "orphan_trace_file",
      },
      archiveState: "hot",
    });
  }

  if (existsSync(archiveRoot)) {
    const buckets = readdirSync(archiveRoot).filter((name) =>
      existsSync(join(archiveRoot, name, "traces")),
    );
    for (const bucket of buckets) {
      const bucketTraceDir = join(archiveRoot, bucket, "traces");
      for (const file of readdirSync(bucketTraceDir)) {
        if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
        const sessionId = file.replace(/\.jsonl$/, "");
        traceFilesBySession.set(sessionId, join(bucketTraceDir, file));
        if (sessions.has(sessionId)) continue;
        orphanTraceFiles += 1;
        sessions.set(sessionId, {
          record: {
            sessionId,
            source: "archived_orphan_trace_file",
          },
          archiveState: "archived",
        });
      }
    }
  }

  if (existsSync(runDir)) {
    for (const file of readdirSync(runDir)) {
      if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
      runFilesByRun.set(file.replace(/\.jsonl$/, ""), {
        path: join(runDir, file),
        archiveState: "hot",
      });
    }
  }

  if (existsSync(archiveRoot)) {
    const buckets = readdirSync(archiveRoot).filter((name) =>
      existsSync(join(archiveRoot, name, "runs")),
    );
    for (const bucket of buckets) {
      const bucketRunDir = join(archiveRoot, bucket, "runs");
      for (const file of readdirSync(bucketRunDir)) {
        if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
        const runId = file.replace(/\.jsonl$/, "");
        if (!runFilesByRun.has(runId)) {
          runFilesByRun.set(runId, {
            path: join(bucketRunDir, file),
            archiveState: "archived",
          });
        }
      }
    }
  }

  if (existsSync(archiveRunIndex)) {
    for (const line of readJsonl<Record<string, unknown>>(archiveRunIndex)) {
      const runId = asString(line.record?.runId);
      if (!runId || runFilesByRun.has(runId)) continue;
      runFilesByRun.set(runId, {
        path: join(archiveRoot, "runs", `${runId}.jsonl`),
        archiveState: "archived",
      });
    }
  }

  const upsertSession = db.prepare(`
    INSERT INTO trace_sessions (
      session_id, run_id, source, start_time, end_time, day, domain, outcome,
      query, start_url, turn_count, total_tokens, total_cost, raw_json,
      trace_file, indexed_at, archive_state
    ) VALUES (
      @session_id, @run_id, @source, @start_time, @end_time, @day, @domain,
      @outcome, @query, @start_url, @turn_count, @total_tokens, @total_cost,
      @raw_json, @trace_file, @indexed_at, @archive_state
    )
    ON CONFLICT(session_id) DO UPDATE SET
      run_id=excluded.run_id,
      source=excluded.source,
      archive_state=excluded.archive_state,
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
      trace_file=excluded.trace_file,
      indexed_at=excluded.indexed_at
  `);
  const insertTurn = db.prepare(`
    INSERT OR REPLACE INTO trace_turns (
      session_id, turn_number, run_id, model, model_tier, provider,
      prompt_tokens, cached_tokens, completion_tokens, total_tokens, cost, duration_ms,
      context_utilization, dropped_messages, perception_mode, perception_source,
      screenshot_status, url, title, raw_json
    ) VALUES (
      @session_id, @turn_number, @run_id, @model, @model_tier, @provider,
      @prompt_tokens, @cached_tokens, @completion_tokens, @total_tokens, @cost,
      @duration_ms,
      @context_utilization, @dropped_messages, @perception_mode,
      @perception_source, @screenshot_status, @url, @title, @raw_json
    )
  `);
  const insertTool = db.prepare(`
    INSERT OR REPLACE INTO trace_tools (
      session_id, turn_number, ordinal, tool_name, success, duration_ms, error, result
    ) VALUES (
      @session_id, @turn_number, @ordinal, @tool_name, @success, @duration_ms, @error, @result
    )
  `);
  const insertRunEvent = db.prepare(`
    INSERT OR REPLACE INTO trace_run_events (
      run_id, ordinal, type, role, turn_number, ts, raw_json
    ) VALUES (
      @run_id, @ordinal, @type, @role, @turn_number, @ts, @raw_json
    )
  `);
  const upsertRunManifest = db.prepare(`
    INSERT INTO trace_run_manifests (run_id, raw_json, indexed_at)
    VALUES (@run_id, @raw_json, @indexed_at)
    ON CONFLICT(run_id) DO UPDATE SET
      raw_json=excluded.raw_json,
      indexed_at=excluded.indexed_at
  `);
  const insertArtifact = db.prepare(`
    INSERT OR REPLACE INTO trace_artifacts (
      path, kind, archive_state, session_id, run_id, size_bytes, mtime_ms
    ) VALUES (
      @path, @kind, @archive_state, @session_id, @run_id, @size_bytes, @mtime_ms
    )
  `);
  const setMeta = db.prepare(`
    INSERT OR REPLACE INTO trace_index_meta (key, value) VALUES (?, ?)
  `);

  const tx = db.transaction(() => {
    db.exec(
      "DELETE FROM trace_sessions; DELETE FROM trace_turns; DELETE FROM trace_tools; DELETE FROM trace_run_events; DELETE FROM trace_run_manifests; DELETE FROM trace_artifacts;",
    );

    for (const [sessionId, indexedSession] of sessions) {
      const session = indexedSession.record;
      const traceFile =
        traceFilesBySession.get(sessionId) ?? join(traceDir, `${sessionId}.jsonl`);
      const startTime = asNumber(session.startTime);
      const metrics =
        session.metrics && typeof session.metrics === "object"
          ? (session.metrics as Record<string, unknown>)
          : null;
      upsertSession.run({
        session_id: sessionId,
        run_id: asString(session.runId) || null,
        source: asString(session.source) || "index",
        start_time: startTime || null,
        end_time: asNumber(session.endTime) || null,
        day: dayKey(startTime),
        domain: domain(session.startUrl),
        outcome: asString(session.outcome) || null,
        query: asString(session.query) || null,
        start_url: asString(session.startUrl) || null,
        turn_count: asNumber(session.turnCount) || null,
        total_tokens: asNumber(metrics?.totalTokens) || null,
        total_cost: asNumber(metrics?.totalCost) || null,
        raw_json: json(session),
        trace_file: existsSync(traceFile) ? traceFile : null,
        indexed_at: indexedAt,
        archive_state: indexedSession.archiveState,
      });

      for (const line of readJsonl<Record<string, unknown>>(traceFile)) {
        const entry = line.record;
        if (!entry) continue;
        const turnNumber = asNumber(entry.turnNumber);
        if (!turnNumber) continue;
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
        insertTurn.run({
          session_id: sessionId,
          turn_number: turnNumber,
          run_id: asString(entry.runId) || asString(session.runId) || null,
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
          raw_json: line.raw,
        });

        const executions = Array.isArray(entry.toolExecutions)
          ? entry.toolExecutions
          : [];
        executions.forEach((execution, ordinal) => {
          if (!execution || typeof execution !== "object") return;
          const tool = execution as Record<string, unknown>;
          insertTool.run({
            session_id: sessionId,
            turn_number: turnNumber,
            ordinal,
            tool_name: asString(tool.toolName) || null,
            success: tool.success === true ? 1 : 0,
            duration_ms: asNumber(tool.durationMs),
            error: asString(tool.error) || null,
            result: asString(tool.result) || null,
          });
        });
      }
    }

    for (const [runId, runFile] of runFilesByRun) {
      readJsonl<Record<string, unknown>>(runFile.path).forEach((line, ordinal) => {
        if (!line.record) return;
        insertRunEvent.run({
          run_id: runId,
          ordinal,
          type: asString(line.record.type) || null,
          role: asString(line.record.role) || null,
          turn_number: asNumber(line.record.turn) || null,
          ts: asString(line.record.ts) || asString(line.record.recordedAt) || null,
          raw_json: line.raw,
        });
      });
    }

    for (const line of [
      ...readJsonl<Record<string, unknown>>(join(runDir, "index.jsonl")),
      ...readJsonl<Record<string, unknown>>(archiveRunIndex),
    ]) {
      const runId = asString(line.record?.runId);
      if (!runId || !line.raw) continue;
      upsertRunManifest.run({
        run_id: runId,
        raw_json: line.raw,
        indexed_at: indexedAt,
      });
    }

    if (existsSync(screenshotDir)) {
      for (const file of readdirSync(screenshotDir)) {
        screenshotFiles.push({
          path: join(screenshotDir, file),
          archiveState: "hot",
        });
      }
    }
    if (existsSync(archiveRoot)) {
      const buckets = readdirSync(archiveRoot).filter((name) =>
        existsSync(join(archiveRoot, name, "screenshots")),
      );
      for (const bucket of buckets) {
        const bucketScreenshotDir = join(archiveRoot, bucket, "screenshots");
        for (const file of readdirSync(bucketScreenshotDir)) {
          screenshotFiles.push({
            path: join(bucketScreenshotDir, file),
            archiveState: "archived",
          });
        }
      }
    }

    for (const screenshot of screenshotFiles) {
      const stat = statSync(screenshot.path);
      const file = screenshot.path.split(/[\\/]/).pop() ?? "";
      const match = file.match(/^(.+)-T\d+(?:-pan\d+)?\.jpg$/);
      insertArtifact.run({
        path: screenshot.path,
        kind: "screenshot",
        archive_state: screenshot.archiveState,
        session_id: match?.[1] ?? null,
        run_id: null,
        size_bytes: stat.size,
        mtime_ms: stat.mtimeMs,
      });
    }

    setMeta.run("indexed_at", String(indexedAt));
    setMeta.run("schema_version", "2026-05-11");
  });

  tx();
  const persistedCount = (table: string) =>
    asNumber(
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count?: unknown;
      }).count,
    );
  const persistedTurns = persistedCount("trace_turns");
  const persistedTools = persistedCount("trace_tools");
  const persistedRunEvents = persistedCount("trace_run_events");
  const persistedScreenshots = persistedCount("trace_artifacts");
  db.close();

  return {
    dbPath,
    sessions: sessions.size,
    indexedSessions: readJsonl(indexPath).filter((line) => line.record).length,
    archivedSessions: Array.from(sessions.values()).filter(
      (session) => session.archiveState === "archived",
    ).length,
    orphanTraceFiles,
    turns: persistedTurns,
    tools: persistedTools,
    runEvents: persistedRunEvents,
    screenshots: persistedScreenshots,
  };
}

function parseArgs(argv: string[]): TraceSqliteIndexOptions {
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const options: TraceSqliteIndexOptions = { projectRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      const value = argv[++index];
      if (!value) throw new Error("--db requires a path");
      options.dbPath = value;
    } else if (arg === "--project-root") {
      const value = argv[++index];
      if (!value) throw new Error("--project-root requires a path");
      options.projectRoot = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: tsx scripts/trace-sqlite-index.ts [--db .artifacts/trace-index.sqlite] [--project-root <path>]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function main(): void {
  const result = indexTracesToSqlite(parseArgs(process.argv.slice(2)));
  console.log(`SQLite trace index: ${result.dbPath}`);
  console.log(`Sessions: ${result.sessions} (${result.indexedSessions} indexed, ${result.archivedSessions} archived, ${result.orphanTraceFiles} orphan files)`);
  console.log(`Turns: ${result.turns}`);
  console.log(`Tools: ${result.tools}`);
  console.log(`Run events: ${result.runEvents}`);
  console.log(`Screenshots: ${result.screenshots}`);
}

if (
  process.argv[1]?.replace(/\\/g, "/").endsWith(
    "scripts/trace-sqlite-index.ts",
  )
) {
  main();
}
