import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DuckDBConnection } from "@duckdb/node-api";
import { test, expect } from "vitest";
import { buildParquetSnapshot, readParquetSnapshotManifest, sealParquetSnapshot } from "./duck";
import { readParquetRunEvents, readParquetSessionData } from "./duck-read";

test("partitions canonical sessions, turn entries, and spans into Parquet", async () => {
  const root = mkdtempSync(join(tmpdir(), "opensidebar-duck-"));
  assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}`));
  try {
    const spanDir = join(root, "spans");
    const sessionDir = join(spanDir, "s1");
    mkdirSync(sessionDir, { recursive: true });
    const timestamp = Date.UTC(2026, 8, 24, 12);
    writeFileSync(join(sessionDir, "session.json"), JSON.stringify({
      sessionId: "s1", runId: "r1", startTime: timestamp, query: "\uD800",
    }));
    for (let turn = 1; turn <= 257; turn++) {
      const start = timestamp + (turn === 257 ? 86_400_000 : 0);
      writeFileSync(join(sessionDir, `T${turn}.json`), JSON.stringify({
        v: 1, entry: {
          sessionId: "s1", turnNumber: turn, timestamp: start,
          ...(turn === 1 ? {
            llmRequest: { model: "accounts/fireworks/routers/openai/gpt-oss-120b:nitro",
              modelTier: "executor" },
            llmResponse: { actualProviderId: "fireworks", durationMs: 9,
              usage: { prompt_tokens: 10, completion_tokens: 3,
                cached_tokens: 4, total_tokens: 13, cost: 0.02 } },
          } : {}),
          events: [{ type: "checkpoint", data: { turn } }],
          toolExecutions: turn === 1
            ? [{ toolName: "click", success: true, durationMs: 4 }]
            : turn === 257
              ? [{ toolName: "read", success: false, error: "\uD800" },
                { toolName: "read", success: true }] : [],
        },
        spans: [
          { traceId: "r1", spanId: `turn-${turn}`, kind: "agent.turn",
            name: turn === 257 ? "\uD800" : "agent.turn",
            startTimeUnixMs: start },
          { traceId: "r1", spanId: `chat-${turn}`, parentSpanId: `turn-${turn}`,
            kind: "gen_ai.chat", name: "gen_ai.chat", startTimeUnixMs: start },
        ],
      }));
    }
    const runsDir = join(spanDir, "runs");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, "r1.jsonl"), [
      JSON.stringify({ runId: "r1", type: "task_started",
        recordedAt: "2026-09-24T12:00:00.000Z" }),
      "",
      JSON.stringify({ runId: "r1", type: "task_completed",
        recordedAt: "2026-09-25T12:00:00.000Z", data: { text: "\uD800" } }),
      "",
    ].join("\n"));
    writeFileSync(join(runsDir, "empty.jsonl"), "");
    writeFileSync(join(runsDir, "index.jsonl"), `${JSON.stringify({
      runId: "r1", recordedAt: "2026-09-24T12:00:00.000Z",
    })}\n`);

    const output = join(root, "snapshot");
    const result = await buildParquetSnapshot(spanDir, output);
    expect(result).toMatchObject({
      sessions: 1, turnEntries: 257, turnSpans: 514, runEvents: 2,
      toolCalls: 3, turnUsage: 257,
      normalizedSessionFiles: 1, normalizedTurnFiles: 1,
      normalizedRunFiles: 1,
    });
    const manifest = readParquetSnapshotManifest(output);
    expect(manifest).toMatchObject({
      formatVersion: 5, sessions: 1, turnEntries: 257, turnSpans: 514,
      runEvents: 2, toolCalls: 3, turnUsage: 257,
    });
    await expect(sealParquetSnapshot(spanDir, output, manifest.startedAtMs))
      .resolves.toEqual(manifest);
    await expect(sealParquetSnapshot(spanDir, output, manifest.startedAtMs + 1))
      .rejects.toThrow("different start time");
    expect(existsSync(join(output, "sessions", "day=2026-09-24"))).toBe(true);
    expect(existsSync(join(output, "turn_spans", "day=2026-09-24"))).toBe(true);
    expect(existsSync(join(output, "turn_spans", "day=2026-09-25"))).toBe(true);
    expect(existsSync(join(output, "turn_entries", "day=2026-09-24"))).toBe(true);
    expect(existsSync(join(output, "turn_entries", "day=2026-09-25"))).toBe(true);
    expect(existsSync(join(output, "tool_calls", "day=2026-09-24"))).toBe(true);
    expect(existsSync(join(output, "tool_calls", "day=2026-09-25"))).toBe(true);
    expect(existsSync(join(output, "turn_usage", "day=2026-09-24"))).toBe(true);
    expect(existsSync(join(output, "turn_usage", "day=2026-09-25"))).toBe(true);
    expect(existsSync(join(output, "run_events", "day=2026-09-24"))).toBe(true);
    expect(existsSync(join(output, "run_events", "day=2026-09-25"))).toBe(true);
    const connection = await DuckDBConnection.create();
    try {
      const glob = join(output, "turn_entries", "*", "*.parquet")
        .replaceAll("\\", "/").replaceAll("'", "''");
      const rows = await connection.runAndReadAll(
        `SELECT raw_json FROM read_parquet('${glob}') WHERE turn_number = 257`,
      );
      expect(JSON.parse(String(rows.getRowObjectsJson()[0]?.raw_json))).toMatchObject({
        sessionId: "s1", turnNumber: 257,
        events: [{ type: "checkpoint", data: { turn: 257 } }],
      });
      const toolGlob = join(output, "tool_calls", "*", "*.parquet")
        .replaceAll("\\", "/").replaceAll("'", "''");
      const toolRows = await connection.runAndReadAll(
        `SELECT turn_number, ordinal, raw_json FROM read_parquet('${toolGlob}')
         ORDER BY turn_number, ordinal`,
      );
      expect(toolRows.getRowObjectsJson().map((row) => ({
        turn: Number(row.turn_number), ordinal: Number(row.ordinal),
        tool: JSON.parse(String(row.raw_json)),
      }))).toEqual([
        { turn: 1, ordinal: 0, tool: { toolName: "click", success: true, durationMs: 4 } },
        { turn: 257, ordinal: 0, tool: { toolName: "read", success: false,
          error: "\uFFFD" } },
        { turn: 257, ordinal: 1, tool: { toolName: "read", success: true } },
      ]);
      const usageGlob = join(output, "turn_usage", "*", "*.parquet")
        .replaceAll("\\", "/").replaceAll("'", "''");
      const usageRows = await connection.runAndReadAll(
        `SELECT model, provider, prompt_tokens, completion_tokens,
          cached_tokens, total_tokens, request_cost, duration_ms, model_tier
         FROM read_parquet('${usageGlob}') WHERE turn_number = 1`,
      );
      expect(usageRows.getRowObjectsJson()).toEqual([{
        model: "openai/gpt-oss-120b", provider: "fireworks",
        prompt_tokens: 10, completion_tokens: 3, cached_tokens: 4,
        total_tokens: 13, request_cost: 0.02, duration_ms: 9,
        model_tier: "executor",
      }]);
      const runsGlob = join(output, "run_events", "*", "*.parquet")
        .replaceAll("\\", "/").replaceAll("'", "''");
      const runRows = await connection.runAndReadAll(
        `SELECT ordinal, raw_json FROM read_parquet('${runsGlob}') ORDER BY ordinal`,
      );
      expect(runRows.getRowObjectsJson().map((row) => ({
        ordinal: Number(row.ordinal), event: JSON.parse(String(row.raw_json)),
      }))).toEqual([
        { ordinal: 0, event: { runId: "r1", type: "task_started",
          recordedAt: "2026-09-24T12:00:00.000Z" } },
        { ordinal: 2, event: { runId: "r1", type: "task_completed",
          recordedAt: "2026-09-25T12:00:00.000Z", data: { text: "\uFFFD" } } },
      ]);
    } finally {
      connection.closeSync();
    }
    const data = await readParquetSessionData(output, "s1");
    expect((await readParquetRunEvents(output, "r1")).map((event) => event.type))
      .toEqual(["task_started", "task_completed"]);
    expect(await readParquetRunEvents(output, "empty")).toEqual([]);
    await expect(readParquetRunEvents(output, "../r1")).rejects.toThrow("safe run ID");
    expect(data.sessions).toHaveLength(1);
    expect(data.entriesBySession.get("s1")).toHaveLength(257);
    expect(data.entriesBySession.get("s1")?.[256]).toMatchObject({
      turnNumber: 257,
      events: [{ type: "checkpoint", data: { turn: 257 } }],
    });
    await expect(readParquetSessionData(output, "")).rejects.toThrow("session ID is required");
    expect((await readParquetSessionData(output, "missing")).sessions).toEqual([]);
    const changed = JSON.parse(readFileSync(join(sessionDir, "T257.json"), "utf8"));
    changed.entry.events[0].data.turn = "updated";
    writeFileSync(join(sessionDir, "T257.json"), JSON.stringify(changed));
    writeFileSync(join(sessionDir, "T258.json"), JSON.stringify({
      entry: { sessionId: "s1", turnNumber: 258, events: [] }, spans: [],
    }));
    writeFileSync(join(sessionDir, "session.json"), JSON.stringify({
      sessionId: "s1", query: "updated session",
    }));
    const hotTime = new Date(manifest.startedAtMs + 1_000);
    for (const name of ["session.json", "T257.json", "T258.json"])
      utimesSync(join(sessionDir, name), hotTime, hotTime);
    writeFileSync(join(runsDir, "r1.jsonl"), `${JSON.stringify({
      runId: "r1", type: "live_event", recordedAt: "2026-09-25T12:00:00.000Z",
    })}\n`);
    utimesSync(join(runsDir, "r1.jsonl"), hotTime, hotTime);
    expect((await readParquetRunEvents(output, "r1", spanDir)).map((event) => event.type))
      .toEqual(["live_event"]);
    const live = await readParquetSessionData(output, "s1", spanDir);
    expect(live.sessions[0].query).toBe("updated session");
    expect(live.entriesBySession.get("s1")).toHaveLength(258);
    expect(live.entriesBySession.get("s1")?.[256]).toMatchObject({
      turnNumber: 257, events: [{ data: { turn: "updated" } }],
    });
    expect(live.entriesBySession.get("s1")?.[257]).toMatchObject({ turnNumber: 258 });
    await expect(buildParquetSnapshot(spanDir, output)).rejects.toThrow("already exists");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
