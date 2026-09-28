/** DuckDB-backed Parquet materialization for RFC LP-7 Stage B2. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { PROJECT_ROOT } from "./paths";
import { verifyParquetSnapshot } from "./verify-parquet";
import { turnUsageSelectSql } from "./turn-usage-sql";

function sqlString(value: string): string {
  return `'${value.replaceAll("\\", "/").replaceAll("'", "''")}'`;
}

async function withDuck<T>(run: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
  // The native binding is loaded only for explicit analytics work.
  const { DuckDBConnection } = await import("@duckdb/node-api");
  const connection = await DuckDBConnection.create();
  try {
    return await run(connection);
  } finally {
    connection.closeSync();
  }
}

async function countParquet(connection: DuckDBConnection, dir: string): Promise<number> {
  const reader = await connection.runAndReadAll(
    `SELECT count(*) AS count FROM read_parquet(${sqlString(join(dir, "*", "*.parquet"))})`,
  );
  return Number(reader.getRowObjectsJson()[0]?.count ?? 0);
}

export interface ParquetSnapshot {
  outputDir: string;
  sessions: number;
  turnEntries: number;
  turnSpans: number;
  runEvents: number;
  toolCalls: number;
  turnUsage: number;
  normalizedSessionFiles: number;
  normalizedTurnFiles: number;
  normalizedRunFiles: number;
}

export interface ParquetSnapshotManifest {
  formatVersion: 2 | 3 | 4 | 5;
  startedAtMs: number;
  verifiedAtMs: number;
  sessions: number;
  turnEntries: number;
  turnSpans: number;
  runEvents?: number;
  toolCalls?: number;
  turnUsage?: number;
}

export function readParquetSnapshotManifest(snapshotDir: string): ParquetSnapshotManifest {
  const path = join(resolve(snapshotDir), "snapshot.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as ParquetSnapshotManifest;
  if (![2, 3, 4, 5].includes(manifest.formatVersion) || !Number.isSafeInteger(manifest.startedAtMs) ||
      manifest.startedAtMs <= 0 || !Number.isSafeInteger(manifest.verifiedAtMs) ||
      manifest.verifiedAtMs < manifest.startedAtMs ||
      ![manifest.sessions, manifest.turnEntries, manifest.turnSpans].every(
        (count) => Number.isSafeInteger(count) && count >= 0) ||
      (manifest.formatVersion >= 3 &&
        (!Number.isSafeInteger(manifest.runEvents) || (manifest.runEvents ?? -1) < 0)) ||
      (manifest.formatVersion >= 4 &&
        (!Number.isSafeInteger(manifest.toolCalls) || (manifest.toolCalls ?? -1) < 0)) ||
      (manifest.formatVersion >= 5 &&
        (!Number.isSafeInteger(manifest.turnUsage) || (manifest.turnUsage ?? -1) < 0)))
    throw new Error(`Invalid Parquet snapshot manifest: ${path}`);
  return manifest;
}

/** A snapshot is readable only after source-to-Parquet verification succeeds. */
export async function sealParquetSnapshot(
  spanDir: string,
  snapshotDir: string,
  startedAtMs: number,
  expected?: Pick<ParquetSnapshot,
    "sessions" | "turnEntries" | "turnSpans" | "runEvents" | "toolCalls" | "turnUsage">,
): Promise<ParquetSnapshotManifest> {
  if (!Number.isSafeInteger(startedAtMs) || startedAtMs <= 0)
    throw new Error("Invalid snapshot start time");
  const manifestPath = join(resolve(snapshotDir), "snapshot.json");
  if (existsSync(manifestPath)) {
    const existing = readParquetSnapshotManifest(snapshotDir);
    if (existing.startedAtMs !== startedAtMs)
      throw new Error("Parquet snapshot already sealed with a different start time");
    return existing;
  }
  const verified = await verifyParquetSnapshot(spanDir, snapshotDir);
  const counts = {
    sessions: verified.sessions,
    turnEntries: verified.turnFiles,
    turnSpans: verified.spans,
    runEvents: verified.runEvents,
    toolCalls: verified.toolCalls,
    turnUsage: verified.turnUsage,
  };
  if (expected && (expected.sessions !== counts.sessions ||
      expected.turnEntries !== counts.turnEntries ||
      expected.turnSpans !== counts.turnSpans ||
      expected.runEvents !== counts.runEvents ||
      expected.toolCalls !== counts.toolCalls ||
      expected.turnUsage !== counts.turnUsage))
    throw new Error("Parquet export counts changed before snapshot verification");
  const manifest: ParquetSnapshotManifest = {
    formatVersion: 5,
    startedAtMs,
    verifiedAtMs: Date.now(),
    ...counts,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifest;
}

// JS accepts escaped lone UTF-16 surrogates that DuckDB rejects as JSON.
// Normalize only the Parquet projection; canonical span files remain untouched.
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function repairJsonFile(source: string, output: string): string {
  const parsed = JSON.parse(readFileSync(source, "utf8"), (_key, value: unknown) =>
    typeof value === "string" ? value.replace(loneSurrogate, "\uFFFD") : value) as unknown;
  const repaired = join(output, "_repaired", basename(dirname(source)), basename(source));
  mkdirSync(dirname(repaired), { recursive: true });
  writeFileSync(repaired, JSON.stringify(parsed));
  return repaired;
}

async function invalidJsonFiles(connection: DuckDBConnection, source: string): Promise<string[]> {
  const invalid = await connection.runAndReadAll(
    `SELECT filename FROM read_text(${source}) WHERE NOT json_valid(content)`,
  );
  return invalid.getRowObjectsJson().map((row) => String(row.filename));
}

async function prepareTurnBatch(
  connection: DuckDBConnection,
  files: string[],
  output: string,
): Promise<{ paths: string[]; normalized: number }> {
  const list = files.map(sqlString).join(", ");
  const invalid = await invalidJsonFiles(connection, `[${list}]`);
  const byPath = new Map(files.map((file) => [resolve(file).toLowerCase(), file]));
  const replacements = new Map<string, string>();
  for (const filename of invalid) {
    const path = resolve(filename).toLowerCase();
    const source = byPath.get(path);
    if (!source) throw new Error(`Invalid turn file outside batch: ${filename}`);
    replacements.set(source, repairJsonFile(source, output));
  }
  const paths = files.map((file) => replacements.get(file) ?? file);
  if (replacements.size > 0) {
    const remaining = await invalidJsonFiles(connection, `[${paths.map(sqlString).join(", ")}]`);
    if (remaining.length > 0)
      throw new Error(`Unrepairable turn JSON: ${JSON.stringify(remaining)}`);
  }
  return { paths, normalized: replacements.size };
}

function turnFiles(spanDir: string): string[] {
  const files: string[] = [];
  for (const session of readdirSync(spanDir, { withFileTypes: true })) {
    if (!session.isDirectory() || session.name === "runs") continue;
    const dir = join(spanDir, session.name);
    for (const file of readdirSync(dir)) {
      if (/^T\d+\.json$/.test(file)) files.push(join(dir, file));
    }
  }
  return files;
}

function runFiles(spanDir: string): string[] {
  const dir = join(spanDir, "runs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".jsonl") && name !== "index.jsonl")
    .map((name) => join(dir, name));
}

/** Stage normalized run rows by day, then write one Parquet file per day. */
export async function exportRunEventProjection(
  spanDir: string,
  outputDir: string,
  onProgress?: (processed: number, total: number) => void,
): Promise<{ runEvents: number; normalizedRunFiles: number }> {
  const input = resolve(spanDir);
  const output = resolve(outputDir);
  const runOutput = join(output, "run_events");
  if (existsSync(runOutput))
    throw new Error(`Run-event projection already exists: ${runOutput}`);
  const runs = runFiles(input);
  if (runs.length === 0) return { runEvents: 0, normalizedRunFiles: 0 };
  const stageDir = join(output, "_run_stage");
  if (existsSync(stageDir)) throw new Error(`Run-event stage already exists: ${stageDir}`);
  mkdirSync(stageDir, { recursive: true });
  const days = new Map<string, string>();
  let normalizedRunFiles = 0;
  for (let index = 0; index < runs.length; index++) {
    const file = runs[index];
    const runId = basename(file, ".jsonl");
    let normalized = false;
    for (const [ordinal, line] of readFileSync(file, "utf8").split("\n").entries()) {
      if (!line.trim()) continue;
      const event = JSON.parse(line, (_key, value: unknown) => {
        if (typeof value !== "string") return value;
        const repaired = value.replace(loneSurrogate, "\uFFFD");
        if (repaired !== value) normalized = true;
        return repaired;
      }) as Record<string, unknown>;
      if (event.runId !== runId)
        throw new Error(`Run ID mismatch in ${file}:${ordinal}`);
      const timestamp = Date.parse(String(event.recordedAt ?? event.ts ?? ""));
      const day = Number.isFinite(timestamp)
        ? new Date(timestamp).toISOString().slice(0, 10) : "unknown";
      const stagePath = join(stageDir, `${day}.jsonl`);
      days.set(day, stagePath);
      appendFileSync(stagePath, `${JSON.stringify({
        run_id: runId, ordinal,
        type: typeof event.type === "string" ? event.type : null,
        role: typeof event.role === "string" ? event.role : null,
        raw_json: JSON.stringify(event),
      })}\n`);
    }
    if (normalized) normalizedRunFiles++;
    onProgress?.(index + 1, runs.length);
  }
  for (const [day, stagePath] of days) {
    const dayDir = join(runOutput, `day=${day}`);
    mkdirSync(dayDir, { recursive: true });
    await withDuck(async (connection) => {
      await connection.run("SET threads = 2");
      await connection.run("SET memory_limit = '2GB'");
      await connection.run(`
        COPY (
          SELECT run_id, ordinal, type, role, raw_json
          FROM read_json(${sqlString(stagePath)}, format='newline_delimited',
            columns={run_id:'VARCHAR', ordinal:'INTEGER', type:'VARCHAR',
              role:'VARCHAR', raw_json:'VARCHAR'})
        ) TO ${sqlString(join(dayDir, "part.parquet"))}
        (FORMAT parquet, COMPRESSION zstd)
      `);
    });
    unlinkSync(stagePath);
  }
  rmdirSync(stageDir);
  return {
    runEvents: existsSync(runOutput)
      ? await withDuck((connection) => countParquet(connection, runOutput)) : 0,
    normalizedRunFiles,
  };
}

/**
 * Build a new immutable snapshot. A new output directory is required so a
 * failed export cannot replace a previously verified Parquet dataset.
 */
export async function buildParquetSnapshot(
  spanDir: string,
  outputDir: string,
  onProgress?: (processed: number, total: number) => void,
): Promise<ParquetSnapshot> {
  const startedAtMs = Date.now();
  const input = resolve(spanDir);
  const output = resolve(outputDir);
  if (existsSync(output)) throw new Error(`Parquet output already exists: ${output}`);
  mkdirSync(output, { recursive: true });

  const result = await withDuck(async (connection) => {
    await connection.run("SET threads = 4");
    await connection.run("SET memory_limit = '4GB'");
    await connection.run("SET preserve_insertion_order = false");
    await connection.run("SET partitioned_write_max_open_files = 16");
    await connection.run(`SET temp_directory = ${sqlString(join(output, "_spill"))}`);
    const sessionGlob = sqlString(join(input, "*", "session.json"));
    const invalidSessions = await invalidJsonFiles(connection, sessionGlob);
    await connection.run(`
      COPY (
        SELECT json_extract_string(content, '$.sessionId') AS session_id,
          json_extract_string(content, '$.runId') AS run_id,
          TRY_CAST(json_extract_string(content, '$.startTime') AS BIGINT) AS start_time,
          COALESCE(strftime(to_timestamp(
            TRY_CAST(json_extract_string(content, '$.startTime') AS DOUBLE) / 1000
          ), '%Y-%m-%d'), 'unknown') AS day,
          content AS raw_json
        FROM read_text(${sessionGlob})
        WHERE json_valid(content) AND json_extract_string(content, '$.sessionId') IS NOT NULL
      ) TO ${sqlString(join(output, "sessions"))}
      (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (day))
    `);
    for (const source of invalidSessions) {
      const repaired = repairJsonFile(source, output);
      const remaining = await invalidJsonFiles(connection, sqlString(repaired));
      if (remaining.length > 0) throw new Error(`Unrepairable session JSON: ${source}`);
      await connection.run(`
        COPY (
          SELECT json_extract_string(content, '$.sessionId') AS session_id,
            json_extract_string(content, '$.runId') AS run_id,
            TRY_CAST(json_extract_string(content, '$.startTime') AS BIGINT) AS start_time,
            COALESCE(strftime(to_timestamp(
              TRY_CAST(json_extract_string(content, '$.startTime') AS DOUBLE) / 1000
            ), '%Y-%m-%d'), 'unknown') AS day,
            content AS raw_json
          FROM read_text(${sqlString(repaired)})
        ) TO ${sqlString(join(output, "sessions"))}
        (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (day), APPEND)
      `);
    }
    const files = turnFiles(input);
    let normalizedTurnFiles = 0;
    for (let index = 0; index < files.length; index += 256) {
      const prepared = await prepareTurnBatch(connection, files.slice(index, index + 256), output);
      normalizedTurnFiles += prepared.normalized;
      const batch = prepared.paths.map(sqlString).join(", ");
      // Insights needs fields from the full turn entry, not only its derived spans.
      await connection.run(`
        COPY (
          SELECT json_extract_string(content, '$.entry.sessionId') AS session_id,
            TRY_CAST(json_extract_string(content, '$.entry.turnNumber') AS INTEGER) AS turn_number,
            TRY_CAST(json_extract_string(content, '$.entry.timestamp') AS BIGINT) AS start_time,
            COALESCE(strftime(to_timestamp(
              TRY_CAST(json_extract_string(content, '$.entry.timestamp') AS DOUBLE) / 1000
            ), '%Y-%m-%d'), 'unknown') AS day,
            CAST(json_extract(content, '$.entry') AS VARCHAR) AS raw_json
          FROM read_text([${batch}])
          WHERE json_extract(content, '$.entry') IS NOT NULL
        ) TO ${sqlString(join(output, "turn_entries"))}
        (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (day), APPEND)
      `);
      await connection.run(`
        COPY (
          SELECT json_extract_string(source.content, '$.entry.sessionId') AS session_id,
            TRY_CAST(json_extract_string(source.content, '$.entry.turnNumber') AS INTEGER)
              AS turn_number,
            TRY_CAST(tool.key AS INTEGER) AS ordinal,
            json_extract_string(tool.value, '$.toolName') AS tool_name,
            CASE WHEN json_extract_string(tool.value, '$.success') = 'true'
              THEN 1 ELSE 0 END AS success,
            COALESCE(TRY_CAST(json_extract_string(tool.value, '$.durationMs') AS DOUBLE), 0)
              AS duration_ms,
            json_extract_string(tool.value, '$.error') AS error,
            json_extract_string(tool.value, '$.result') AS result,
            COALESCE(strftime(to_timestamp(
              TRY_CAST(json_extract_string(source.content, '$.entry.timestamp') AS DOUBLE)
                / 1000
            ), '%Y-%m-%d'), 'unknown') AS day,
            CAST(tool.value AS VARCHAR) AS raw_json
          FROM read_text([${batch}]) AS source,
            json_each(source.content, '$.entry.toolExecutions') AS tool
          WHERE json_valid(source.content)
            AND json_type(source.content, '$.entry.toolExecutions') = 'ARRAY'
        ) TO ${sqlString(join(output, "tool_calls"))}
        (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (day), APPEND)
      `);
      await connection.run(`
        COPY (
          SELECT json_extract_string(source.content, '$.entry.sessionId') AS session_id,
            TRY_CAST(json_extract_string(source.content, '$.entry.turnNumber') AS INTEGER) AS turn_number,
            json_extract_string(span.value, '$.traceId') AS trace_id,
            json_extract_string(span.value, '$.spanId') AS span_id,
            json_extract_string(span.value, '$.parentSpanId') AS parent_span_id,
            json_extract_string(span.value, '$.kind') AS kind,
            json_extract_string(span.value, '$.name') AS name,
            TRY_CAST(json_extract_string(span.value, '$.startTimeUnixMs') AS BIGINT) AS start_time,
            COALESCE(strftime(to_timestamp(
              TRY_CAST(json_extract_string(span.value, '$.startTimeUnixMs') AS DOUBLE) / 1000
            ), '%Y-%m-%d'), 'unknown') AS day,
            CAST(span.value AS VARCHAR) AS raw_json
          FROM read_text([${batch}]) AS source,
            json_each(source.content, '$.spans') AS span
          WHERE json_valid(source.content)
        ) TO ${sqlString(join(output, "turn_spans"))}
        (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (day), APPEND)
      `);
      onProgress?.(Math.min(index + 256, files.length), files.length);
    }
    if (files.length > 0) {
      const entriesPath = sqlString(join(output, "turn_entries", "*", "*.parquet"));
      await connection.run(`
        COPY (${turnUsageSelectSql(entriesPath)})
        TO ${sqlString(join(output, "turn_usage"))}
        (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (day))
      `);
    }
    return {
      outputDir: output,
      sessions: await countParquet(connection, join(output, "sessions")),
      turnEntries: files.length > 0
        ? await countParquet(connection, join(output, "turn_entries")) : 0,
      turnSpans: files.length > 0
        ? await countParquet(connection, join(output, "turn_spans")) : 0,
      toolCalls: existsSync(join(output, "tool_calls"))
        ? await countParquet(connection, join(output, "tool_calls")) : 0,
      turnUsage: existsSync(join(output, "turn_usage"))
        ? await countParquet(connection, join(output, "turn_usage")) : 0,
      normalizedSessionFiles: invalidSessions.length,
      normalizedTurnFiles,
    };
  });
  const runProjection = await exportRunEventProjection(input, output);
  const fullResult: ParquetSnapshot = { ...result, ...runProjection };
  await sealParquetSnapshot(input, output, startedAtMs, fullResult);
  return fullResult;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const spanDir = join(PROJECT_ROOT, "traces", "spans");
  const outputDir = join(PROJECT_ROOT, ".artifacts", "obs", "parquet",
    `snapshot-${new Date().toISOString().replaceAll(":", "-")}`);
  buildParquetSnapshot(spanDir, outputDir, (processed, total) => {
    if (processed === total || processed % 2560 === 0)
      console.log(`[obs] Parquet turn files: ${processed}/${total}`);
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
