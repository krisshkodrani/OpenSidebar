/** Read full-fidelity session and turn data from a verified Parquet snapshot. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { TraceEntryLike, TraceSessionLike } from "../log-server-helpers";
import { readParquetSnapshotManifest } from "./duck";

function sqlString(value: string): string {
  return `'${value.replaceAll("\\", "/").replaceAll("'", "''")}'`;
}

export interface ParquetSessionData {
  sessions: TraceSessionLike[];
  entriesBySession: Map<string, TraceEntryLike[]>;
}

/** Ordered run events from a v3 snapshot, with a newer spine file taking precedence. */
export async function readParquetRunEvents(
  snapshotDir: string,
  runId: string,
  spanDir?: string,
): Promise<TraceEntryLike[]> {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId))
    throw new Error("A safe run ID is required for Parquet event reads");
  const manifest = readParquetSnapshotManifest(snapshotDir);
  if (manifest.formatVersion < 3)
    throw new Error("Run events are not available in this Parquet snapshot");
  const livePath = spanDir ? join(resolve(spanDir), "runs", `${runId}.jsonl`) : "";
  if (livePath && existsSync(livePath) && statSync(livePath).mtimeMs >= manifest.startedAtMs) {
    const lines = readFileSync(livePath, "utf8").split("\n").filter((line) => line.trim());
    if (lines.length > 5_000)
      throw new Error(`Live run exceeds the 5,000-event read limit: ${runId}`);
    return lines.map((line) => {
      const event = JSON.parse(line) as TraceEntryLike;
      if (event.runId !== runId)
        throw new Error(`Live run ID mismatch: ${livePath}`);
      return event;
    });
  }
  if (!manifest.runEvents) return [];
  const { DuckDBConnection } = await import("@duckdb/node-api");
  const connection = await DuckDBConnection.create();
  try {
    const path = sqlString(join(resolve(snapshotDir), "run_events", "*", "*.parquet"));
    const filter = ` WHERE run_id = ${sqlString(runId)}`;
    const count = await connection.runAndReadAll(
      `SELECT count(*) AS count FROM read_parquet(${path})${filter}`,
    );
    if (Number(count.getRowObjectsJson()[0]?.count) > 5_000)
      throw new Error(`Parquet run exceeds the 5,000-event read limit: ${runId}`);
    const rows = await connection.runAndReadAll(
      `SELECT raw_json FROM read_parquet(${path})${filter} ORDER BY ordinal`,
    );
    return rows.getRowObjectsJson().map((row) =>
      JSON.parse(String(row.raw_json)) as TraceEntryLike);
  } finally {
    connection.closeSync();
  }
}

/** Bounded read for a single session; corpus aggregates must stay in DuckDB. */
export async function readParquetSessionData(
  snapshotDir: string,
  sessionId: string,
  spanDir?: string,
): Promise<ParquetSessionData> {
  if (!sessionId || sessionId === "." || sessionId === ".." || /[\\/]/.test(sessionId))
    throw new Error("A safe session ID is required for Parquet turn reads");
  const manifest = readParquetSnapshotManifest(snapshotDir);
  const { DuckDBConnection } = await import("@duckdb/node-api");
  const connection = await DuckDBConnection.create();
  try {
    const filter = ` WHERE session_id = ${sqlString(sessionId)}`;
    const sessionsPath = sqlString(join(resolve(snapshotDir), "sessions", "*", "*.parquet"));
    const entriesPath = sqlString(join(resolve(snapshotDir), "turn_entries", "*", "*.parquet"));
    const sessionRows = await connection.runAndReadAll(
      `SELECT raw_json FROM read_parquet(${sessionsPath})${filter}`,
    );
    const sessions = sessionRows.getRowObjectsJson().map((row) =>
      JSON.parse(String(row.raw_json)) as TraceSessionLike);
    const sessionIds = new Set(sessions.map((session) => session.sessionId));
    const entryCount = await connection.runAndReadAll(
      `SELECT count(*) AS count FROM read_parquet(${entriesPath})${filter}`,
    );
    if (Number(entryCount.getRowObjectsJson()[0]?.count) > 5_000)
      throw new Error(`Parquet session exceeds the 5,000-turn read limit: ${sessionId}`);
    const entryRows = await connection.runAndReadAll(
      `SELECT session_id, raw_json FROM read_parquet(${entriesPath})${filter}
       ORDER BY session_id, turn_number`,
    );
    const entriesBySession = new Map<string, TraceEntryLike[]>();
    for (const row of entryRows.getRowObjectsJson()) {
      const id = String(row.session_id);
      if (!sessionIds.has(id)) continue;
      const entries = entriesBySession.get(id) ?? [];
      entries.push(JSON.parse(String(row.raw_json)) as TraceEntryLike);
      entriesBySession.set(id, entries);
    }
    if (spanDir) {
      const liveDir = join(resolve(spanDir), sessionId);
      const header = join(liveDir, "session.json");
      if (existsSync(header) && statSync(header).mtimeMs >= manifest.startedAtMs) {
        const liveSession = JSON.parse(readFileSync(header, "utf8")) as TraceSessionLike;
        if (liveSession.sessionId !== sessionId)
          throw new Error(`Live session ID mismatch: ${header}`);
        sessions.splice(0, sessions.length, liveSession);
      }
      if (existsSync(liveDir)) {
        const byTurn = new Map<number, TraceEntryLike>(
          (entriesBySession.get(sessionId) ?? []).map((entry) => [Number(entry.turnNumber), entry]),
        );
        for (const name of readdirSync(liveDir)) {
          if (!/^T\d+\.json$/.test(name)) continue;
          const path = join(liveDir, name);
          if (statSync(path).mtimeMs < manifest.startedAtMs) continue;
          const record = JSON.parse(readFileSync(path, "utf8")) as { entry: TraceEntryLike };
          if (record.entry.sessionId !== sessionId || !Number.isInteger(record.entry.turnNumber))
            throw new Error(`Invalid live turn entry: ${path}`);
          byTurn.set(Number(record.entry.turnNumber), record.entry);
        }
        if (byTurn.size > 5_000)
          throw new Error(`Live session exceeds the 5,000-turn read limit: ${sessionId}`);
        entriesBySession.set(sessionId, [...byTurn.values()].sort((a, b) =>
          Number(a.turnNumber) - Number(b.turnNumber)));
      }
    }
    return { sessions, entriesBySession };
  } finally {
    connection.closeSync();
  }
}
