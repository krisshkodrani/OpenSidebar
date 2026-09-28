/** Verify a Parquet snapshot against the canonical span files. */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DuckDBConnection } from "@duckdb/node-api";
import { PROJECT_ROOT } from "./paths";
import { turnUsageSelectSql } from "./turn-usage-sql";

function sqlString(value: string): string {
  return `'${value.replaceAll("\\", "/").replaceAll("'", "''")}'`;
}

export async function verifyParquetSnapshot(spanDir: string, snapshotDir: string) {
  const expectedSessions = new Set<string>();
  const expectedSpans = new Map<string, number>();
  const expectedTurns = new Map<string, { count: number; path: string }>();
  const expectedToolCalls = new Map<string, string>();
  const expectedRunEvents = new Map<string, { type: string; digest: string }>();
  let sessionFiles = 0;
  let turnFiles = 0;
  for (const session of readdirSync(spanDir, { withFileTypes: true })) {
    if (!session.isDirectory() || session.name === "runs") continue;
    const dir = join(spanDir, session.name);
    const files = readdirSync(dir);
    if (files.includes("session.json")) {
      const record = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as { sessionId?: string };
      assert.ok(typeof record.sessionId === "string", `Missing session ID: ${dir}`);
      expectedSessions.add(record.sessionId);
      sessionFiles++;
    }
    for (const file of files) {
      if (!/^T\d+\.json$/.test(file)) continue;
      const record = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        entry?: { sessionId?: string; turnNumber?: number }; spans?: unknown[];
      };
      const sessionId = record.entry?.sessionId;
      assert.ok(typeof sessionId === "string", `Missing turn session ID: ${join(dir, file)}`);
      assert.ok(Number.isInteger(record.entry?.turnNumber), `Missing turn number: ${join(dir, file)}`);
      assert.ok(Array.isArray(record.spans), `Missing spans: ${join(dir, file)}`);
      expectedSpans.set(sessionId, (expectedSpans.get(sessionId) ?? 0) + record.spans.length);
      expectedTurns.set(`${sessionId}:${record.entry?.turnNumber}`, {
        count: record.spans.length, path: join(dir, file),
      });
      const executions = (record.entry as { toolExecutions?: unknown })?.toolExecutions;
      if (Array.isArray(executions)) {
        executions.forEach((execution, ordinal) => {
          const normalized = JSON.parse(JSON.stringify(execution), (_key, value: unknown) =>
            typeof value === "string" ? value.replace(
              /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
              "\uFFFD") : value) as unknown;
          expectedToolCalls.set(`${sessionId}:${record.entry?.turnNumber}:${ordinal}`,
            createHash("sha256").update(JSON.stringify(normalized)).digest("hex"));
        });
      }
      turnFiles++;
    }
  }
  const orphanTurns = [...expectedSpans.keys()].filter((id) => !expectedSessions.has(id));
  assert.equal(orphanTurns.length, 0,
    `Canonical turns without session headers: ${JSON.stringify(orphanTurns.slice(0, 20))}`);
  const runsDir = join(spanDir, "runs");
  if (existsSync(runsDir)) {
    for (const name of readdirSync(runsDir).filter((file) =>
      file.endsWith(".jsonl") && file !== "index.jsonl")) {
      const runId = name.slice(0, -".jsonl".length);
      const lines = readFileSync(join(runsDir, name), "utf8").split("\n");
      lines.forEach((line, ordinal) => {
        if (!line.trim()) return;
        const event = JSON.parse(line, (_key, value: unknown) =>
          typeof value === "string" ? value.replace(
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
            "\uFFFD") : value) as { runId?: string; type?: string };
        assert.equal(event.runId, runId, `Run ID mismatch: ${name}:${ordinal}`);
        expectedRunEvents.set(`${runId}:${ordinal}`, {
          type: event.type ?? "",
          digest: createHash("sha256").update(JSON.stringify(event)).digest("hex"),
        });
      });
    }
  }

  const connection = await DuckDBConnection.create();
  try {
    const sessionRows = await connection.runAndReadAll(
      `SELECT session_id FROM read_parquet(${sqlString(join(resolve(snapshotDir), "sessions", "*", "*.parquet"))})`,
    );
    const sessionObjects = sessionRows.getRowObjectsJson();
    assert.equal(sessionObjects.length, sessionFiles, "Parquet session row count differs from the spine");
    const actualSessions = new Set(sessionObjects.map((row) => String(row.session_id)));
    assert.deepEqual(actualSessions, expectedSessions, "Parquet session IDs differ from the spine");

    const entryRows = await connection.runAndReadAll(
      `SELECT session_id, turn_number
       FROM read_parquet(${sqlString(join(resolve(snapshotDir), "turn_entries", "*", "*.parquet"))})`,
    );
    const actualEntries = entryRows.getRowObjectsJson();
    assert.equal(actualEntries.length, turnFiles, "Parquet turn entry count differs from the spine");
    const actualEntryKeys = new Set(actualEntries.map((row) => `${row.session_id}:${row.turn_number}`));
    assert.deepEqual(actualEntryKeys, new Set(expectedTurns.keys()),
      "Parquet turn entry keys differ from the spine");

    const spanRows = await connection.runAndReadAll(
      `SELECT session_id, count(*)::VARCHAR AS span_count
       FROM read_parquet(${sqlString(join(resolve(snapshotDir), "turn_spans", "*", "*.parquet"))})
       GROUP BY session_id`,
    );
    const actualSpans = new Map(spanRows.getRowObjectsJson().map((row) =>
      [String(row.session_id), Number(row.span_count)] as const));
    const allIds = new Set([...expectedSpans.keys(), ...actualSpans.keys()]);
    const mismatchedSessions = [...allIds].filter((sessionId) =>
      (actualSpans.get(sessionId) ?? 0) !== (expectedSpans.get(sessionId) ?? 0));
    const turnRows = await connection.runAndReadAll(
      `SELECT session_id, turn_number, count(*)::VARCHAR AS span_count
       FROM read_parquet(${sqlString(join(resolve(snapshotDir), "turn_spans", "*", "*.parquet"))})
       GROUP BY session_id, turn_number`,
    );
    const actualTurns = new Map<string, number>(turnRows.getRowObjectsJson().map((row) =>
      [`${row.session_id}:${row.turn_number}`, Number(row.span_count)] as const));
    const missing = [...expectedTurns].filter(([key, expected]) =>
      (actualTurns.get(key) ?? 0) !== expected.count);
    const unexpected = [...actualTurns].filter(([key]) => !expectedTurns.has(key));
    assert.equal(missing.length + unexpected.length, 0,
      `Parquet turn mismatches: ${missing.length} missing/unequal, ${unexpected.length} unexpected. `
      + JSON.stringify(missing.slice(0, 20)));
    assert.equal(mismatchedSessions.length, 0,
      `Parquet span count differs for ${mismatchedSessions.length} sessions`);
    const manifestPath = join(resolve(snapshotDir), "snapshot.json");
    const existingVersion = existsSync(manifestPath)
      ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { formatVersion?: number }).formatVersion
      : null;
    const verifyTools = existingVersion == null || existingVersion >= 4;
    const verifyUsage = existingVersion == null || existingVersion >= 5;
    const usageDir = join(resolve(snapshotDir), "turn_usage");
    if (verifyUsage) {
      assert.equal(existsSync(usageDir), turnFiles > 0,
        "Parquet turn-usage projection presence differs from the spine");
      if (turnFiles > 0) {
        const usagePath = sqlString(join(usageDir, "*", "*.parquet"));
        const entriesPath = sqlString(join(resolve(snapshotDir),
          "turn_entries", "*", "*.parquet"));
        const columns = `session_id, turn_number, day, model, provider,
          prompt_tokens, completion_tokens, cached_tokens, total_tokens,
          request_cost, duration_ms, model_tier`;
        const comparison = await connection.runAndReadAll(`
          WITH expected AS (${turnUsageSelectSql(entriesPath)}),
          actual AS (SELECT ${columns} FROM read_parquet(${usagePath}))
          SELECT (SELECT count(*) FROM actual) AS row_count,
            (SELECT count(*) FROM (SELECT ${columns} FROM expected
              EXCEPT ALL SELECT ${columns} FROM actual)) +
            (SELECT count(*) FROM (SELECT ${columns} FROM actual
              EXCEPT ALL SELECT ${columns} FROM expected)) AS mismatches
        `);
        const row = comparison.getRowObjectsJson()[0];
        assert.equal(Number(row?.row_count), turnFiles,
          "Parquet turn-usage row count differs from the spine");
        assert.equal(Number(row?.mismatches), 0,
          "Parquet turn-usage values differ from the turn-entry projection");
      }
    }
    const toolCallsDir = join(resolve(snapshotDir), "tool_calls");
    if (verifyTools) {
      const actualTools = existsSync(toolCallsDir) ? (await connection.runAndReadAll(
        `SELECT session_id, turn_number, ordinal, sha256(raw_json) AS digest
         FROM read_parquet(${sqlString(join(toolCallsDir, "*", "*.parquet"))})`,
      )).getRowObjectsJson() : [];
      assert.equal(actualTools.length, expectedToolCalls.size,
        "Parquet tool-call count differs from the spine");
      const actualToolMap = new Map(actualTools.map((row) =>
        [`${row.session_id}:${row.turn_number}:${row.ordinal}`, String(row.digest)] as const));
      assert.deepEqual(actualToolMap, expectedToolCalls,
        "Parquet tool-call order or content differs from the spine");
    }
    const runEventsDir = join(resolve(snapshotDir), "run_events");
    const actualRunEvents = existsSync(runEventsDir) ? (await connection.runAndReadAll(
      `SELECT run_id, ordinal, type, sha256(raw_json) AS digest
       FROM read_parquet(${sqlString(join(runEventsDir, "*", "*.parquet"))})`,
    )).getRowObjectsJson() : [];
    assert.equal(actualRunEvents.length, expectedRunEvents.size,
      "Parquet run event count differs from the spine");
    const actualRunMap = new Map(actualRunEvents.map((row) =>
      [`${row.run_id}:${row.ordinal}`, {
        type: String(row.type ?? ""), digest: String(row.digest),
      }] as const));
    assert.deepEqual(actualRunMap, expectedRunEvents,
      "Parquet run event order or content differs from the spine");
    return {
      sessions: expectedSessions.size,
      turnFiles,
      spans: [...expectedSpans.values()].reduce((sum, count) => sum + count, 0),
      runEvents: expectedRunEvents.size,
      toolCalls: verifyTools ? expectedToolCalls.size : 0,
      turnUsage: verifyUsage ? turnFiles : 0,
    };
  } finally {
    connection.closeSync();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const snapshot = process.argv[2];
  if (!snapshot) throw new Error("Usage: tsx scripts/obs/verify-parquet.ts <snapshot-dir>");
  verifyParquetSnapshot(join(PROJECT_ROOT, "traces", "spans"), snapshot)
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
