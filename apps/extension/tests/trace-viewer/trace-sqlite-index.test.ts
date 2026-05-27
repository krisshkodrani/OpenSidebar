import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import "../setup";
import { indexTracesToSqlite } from "../../../../scripts/trace-sqlite-index";

const TRACE_SQLITE_TEST_TIMEOUT_MS = 30_000;

function writeJsonl(path: string, records: unknown[]) {
  writeFileSync(
    path,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
}

describe("trace sqlite index", () => {
  let root: string;
  let dbPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "opensidebar-trace-sqlite-"));
    dbPath = join(root, ".artifacts", "trace-index.sqlite");
    const traces = join(root, "traces");
    const runs = join(traces, "runs");
    const screenshots = join(traces, "screenshots");
    for (const dir of [traces, runs, screenshots]) {
      mkdirSync(dir, { recursive: true });
    }
    writeJsonl(join(traces, "index.jsonl"), [
      {
        sessionId: "session-1",
        runId: "run-1",
        startTime: Date.UTC(2026, 4, 11),
        endTime: Date.UTC(2026, 4, 11, 0, 1),
        query: "Objective: test",
        startUrl: "https://example.com/a",
        outcome: "completed",
        turnCount: 1,
        metrics: { totalTokens: 15, totalCost: 0.01 },
      },
    ]);
    writeJsonl(join(traces, "session-1.jsonl"), [
      {
        sessionId: "session-1",
        runId: "run-1",
        turnNumber: 1,
        snapshot: { url: "https://example.com/a", title: "A" },
        llmRequest: {
          model: "model-a",
          modelTier: "executor",
          contextMetrics: { utilization: 0.5, droppedMessageCount: 1 },
        },
        llmResponse: {
          actualProviderId: "provider-a",
          durationMs: 100,
          usage: {
            prompt_tokens: 10,
            cached_tokens: 4,
            completion_tokens: 5,
            total_tokens: 15,
            cost: 0.01,
          },
        },
        perception: {
          mode: "structured",
          source: "vl",
          screenshotStatus: "captured",
        },
        toolExecutions: [
          {
            toolName: "click",
            success: true,
            durationMs: 20,
            result: "clicked",
          },
        ],
      },
    ]);
    writeJsonl(join(traces, "orphan-session.jsonl"), [
      {
        sessionId: "orphan-session",
        turnNumber: 1,
        llmRequest: { model: "model-b" },
        llmResponse: { usage: { input_tokens: 3, output_tokens: 2 } },
        toolExecutions: [],
      },
    ]);
    writeJsonl(join(runs, "run-1.jsonl"), [
      { runId: "run-1", type: "node.completed", role: "planner", turn: 1 },
    ]);
    writeFileSync(join(screenshots, "session-1-T1.jpg"), "shot");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("indexes sessions, orphan trace files, turns, tools, run events, and screenshots", () => {
    const result = indexTracesToSqlite({ projectRoot: root, dbPath });

    expect(result).toMatchObject({
      sessions: 2,
      indexedSessions: 1,
      orphanTraceFiles: 1,
      turns: 2,
      tools: 1,
      runEvents: 1,
      screenshots: 1,
    });
    expect(existsSync(dbPath)).toBe(true);

    const db = new Database(dbPath, { readonly: true });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM trace_sessions").get(),
    ).toMatchObject({ count: 2 });
    expect(
      db.prepare("SELECT prompt_tokens, cached_tokens, completion_tokens, total_tokens FROM trace_turns WHERE session_id = ?").get("session-1"),
    ).toMatchObject({
      prompt_tokens: 10,
      cached_tokens: 4,
      completion_tokens: 5,
      total_tokens: 15,
    });
    expect(
      db.prepare("SELECT tool_name, success FROM trace_tools").get(),
    ).toMatchObject({ tool_name: "click", success: 1 });
    db.close();
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("indexes archived sessions and marks archive state", () => {
    const archiveRoot = join(root, ".artifacts", "trace-archive");
    const archiveTraces = join(archiveRoot, "2026-05", "traces");
    const archiveRuns = join(archiveRoot, "2026-05", "runs");
    const archiveScreenshots = join(archiveRoot, "2026-05", "screenshots");
    const archiveIndexes = join(archiveRoot, "indexes");
    for (const dir of [
      archiveTraces,
      archiveRuns,
      archiveScreenshots,
      archiveIndexes,
    ]) {
      mkdirSync(dir, { recursive: true });
    }
    writeJsonl(join(archiveIndexes, "sessions.jsonl"), [
      {
        sessionId: "archived-session",
        runId: "archived-run",
        startTime: Date.UTC(2026, 3, 30),
        endTime: Date.UTC(2026, 3, 30, 0, 1),
        startUrl: "https://archive.example/a",
        outcome: "max_turns",
        turnCount: 1,
      },
    ]);
    writeJsonl(join(archiveTraces, "archived-session.jsonl"), [
      {
        sessionId: "archived-session",
        runId: "archived-run",
        turnNumber: 1,
        llmRequest: { model: "model-archive" },
        llmResponse: { usage: { prompt_tokens: 8, completion_tokens: 4 } },
        toolExecutions: [
          {
            toolName: "configure_servicenow_form",
            success: false,
            error: "field rejected",
          },
        ],
      },
    ]);
    writeJsonl(join(archiveRuns, "archived-run.jsonl"), [
      { runId: "archived-run", type: "node.failed", role: "executor", turn: 1 },
    ]);
    writeFileSync(join(archiveScreenshots, "archived-session-T1.jpg"), "shot");

    const result = indexTracesToSqlite({ projectRoot: root, dbPath });

    expect(result.archivedSessions).toBe(1);
    expect(result.sessions).toBe(3);
    expect(result.turns).toBe(3);
    expect(result.tools).toBe(2);
    expect(result.runEvents).toBe(2);
    expect(result.screenshots).toBe(2);

    const db = new Database(dbPath, { readonly: true });
    expect(
      db
        .prepare("SELECT archive_state, outcome FROM trace_sessions WHERE session_id = ?")
        .get("archived-session"),
    ).toMatchObject({ archive_state: "archived", outcome: "max_turns" });
    expect(
      db
        .prepare("SELECT archive_state FROM trace_artifacts WHERE session_id = ?")
        .get("archived-session"),
    ).toMatchObject({ archive_state: "archived" });
    db.close();
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);
});
