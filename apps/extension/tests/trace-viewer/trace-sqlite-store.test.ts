import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import "../setup";
import { indexTracesToSqlite } from "../../../../scripts/trace-sqlite-index";
import { buildTraceInsights } from "../../../../scripts/trace-insights";
import {
  buildTraceInsightsFromSqlite,
  getTraceIndexStatus,
  insertRunTraceEventToSqlite,
  insertTraceTurnToSqlite,
  readRunTraceEventsFromSqlite,
  readTraceEntriesFromSqlite,
  readTraceSessionsFromSqlite,
  upsertTraceSessionToSqlite,
} from "../../../../scripts/trace-sqlite-store";

const TRACE_SQLITE_TEST_TIMEOUT_MS = 30_000;

function writeJsonl(path: string, records: unknown[]) {
  writeFileSync(
    path,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
}

function normalizeInsightNumbers(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_, item) =>
    typeof item === "number" && !Number.isInteger(item)
      ? Number(item.toPrecision(12))
      : item,
  ));
}

describe("trace sqlite store", () => {
  let root: string;
  let dbPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "opensidebar-trace-store-"));
    dbPath = join(root, ".artifacts", "trace-index.sqlite");
    const traces = join(root, "traces");
    const runs = join(traces, "runs");
    mkdirSync(runs, { recursive: true });
    writeJsonl(join(traces, "index.jsonl"), [
      {
        sessionId: "session-1",
        runId: "run-1",
        startTime: Date.UTC(2026, 4, 11),
        endTime: Date.UTC(2026, 4, 11, 0, 1),
        query: "Objective: test",
        startUrl: "https://example.com/a",
        outcome: "max_turns",
        models: ["model-a"],
        turnCount: 1,
        metrics: { totalTokens: 15, totalCost: 0.01 },
        skillToolMetrics: { skillId: "service-form" },
        planDecomposition: {
          steps: [{ selectedSkillId: "record-review" }],
        },
        events: [
          { type: "session_event", timestamp: Date.UTC(2026, 4, 11) },
          { type: "stuck_signal", data: { type: "escalate", stagnantTurns: 3 } },
          { type: "escalation_outcome", data: { outcome: "failed_fast" } },
        ],
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
          contextMetrics: { utilization: 0.9, droppedMessageCount: 1 },
        },
        llmResponse: {
          durationMs: 100,
          usage: {
            prompt_tokens: 10,
            cached_tokens: 4,
            completion_tokens: 5,
            total_tokens: 15,
            cost: 0.01,
          },
        },
        perception: { mode: "degraded", screenshotStatus: "capture_failed" },
        events: [
          { type: "turn_event", timestamp: Date.UTC(2026, 4, 11) },
          { type: "escalation", data: { reason: "stuck", voluntary: true } },
          { type: "escalation_outcome", data: { outcome: "rescued" } },
        ],
        toolExecutions: [
          {
            toolName: "configure_servicenow_form",
            success: false,
            durationMs: 20,
            error: "field rejected",
          },
        ],
      },
    ]);
    writeJsonl(join(runs, "run-1.jsonl"), [
      { runId: "run-1", type: "node.failed", role: "executor", turn: 1 },
      {
        runId: "run-1",
        type: "task_completed",
        role: "system",
        data: {
          taskId: "task-1",
          completionStatus: "failed",
          success: false,
          classification: "verification_failed",
        },
      },
    ]);
    indexTracesToSqlite({ projectRoot: root, dbPath });
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("reports index status", () => {
    expect(getTraceIndexStatus(root, dbPath)).toMatchObject({
      available: true,
      source: "sqlite",
      sessions: 1,
      hotSessions: 1,
      archivedSessions: 0,
      turns: 1,
      tools: 1,
      runEvents: 2,
    });
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("rebuilds from spine records and prefers them over legacy JSONL", () => {
    const spineRoot = join(root, "spine-fixture");
    const spanDir = join(spineRoot, "traces", "spans", "spine-session");
    const spanRunDir = join(spineRoot, "traces", "spans", "runs");
    mkdirSync(spanDir, { recursive: true });
    mkdirSync(spanRunDir, { recursive: true });
    const session = {
      sessionId: "spine-session", runId: "spine-run",
      startTime: Date.UTC(2026, 4, 12),
      endTime: Date.UTC(2026, 4, 12, 0, 1),
      outcome: "completed", turnCount: 1,
      models: ["spine-model"], metrics: { totalCost: 0.02 },
    };
    const entry = {
      sessionId: "spine-session", runId: "spine-run", turnNumber: 1,
      llmRequest: { model: "spine-model" },
      llmResponse: { usage: {
        prompt_tokens: 3, completion_tokens: 2, total_tokens: 5,
      } },
      toolExecutions: [{ toolName: "read_page", success: true }],
    };
    writeFileSync(join(spanDir, "session.json"), JSON.stringify(session));
    writeFileSync(join(spanDir, "T1.json"), JSON.stringify({ v: 1, entry, spans: [] }));
    writeJsonl(join(spanRunDir, "spine-run.jsonl"), [
      { runId: "spine-run", type: "task_completed", data: {
        success: true, classification: "completed",
      } },
    ]);

    const spineDbPath = join(spineRoot, ".artifacts", "trace-index.sqlite");
    const indexed = indexTracesToSqlite({ projectRoot: spineRoot, dbPath: spineDbPath });
    expect(indexed).toMatchObject({ sessions: 1, turns: 1, tools: 1, runEvents: 1 });
    expect(readTraceSessionsFromSqlite(spineRoot, spineDbPath)?.[0]).toMatchObject(session);
    expect(readTraceEntriesFromSqlite(spineRoot, "spine-session", spineDbPath)).toEqual([entry]);
    expect(readRunTraceEventsFromSqlite(spineRoot, "spine-run", spineDbPath)).toHaveLength(1);

    const traceDir = join(spineRoot, "traces");
    mkdirSync(join(traceDir, "runs"), { recursive: true });
    writeJsonl(join(traceDir, "index.jsonl"), [
      { ...session, outcome: "failed", metrics: { totalCost: 9 } },
    ]);
    writeJsonl(join(traceDir, "spine-session.jsonl"), [
      { ...entry, llmRequest: { model: "legacy-model" } },
    ]);
    writeJsonl(join(traceDir, "runs", "spine-run.jsonl"), [
      { runId: "spine-run", type: "legacy_failure" },
    ]);

    indexTracesToSqlite({ projectRoot: spineRoot, dbPath: spineDbPath });
    expect(readTraceSessionsFromSqlite(spineRoot, spineDbPath)?.[0]).toMatchObject(session);
    expect(readTraceEntriesFromSqlite(spineRoot, "spine-session", spineDbPath)).toEqual([entry]);
    expect(readRunTraceEventsFromSqlite(spineRoot, "spine-run", spineDbPath)?.[0]).toMatchObject({
      type: "task_completed",
    });
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("preserves index-only orphan turns and tools during an in-place rebuild", () => {
    const entry = {
      sessionId: "orphan-session", runId: "orphan-run", turnNumber: 1,
      toolExecutions: [{ toolName: "read_page", success: true }],
    };
    insertTraceTurnToSqlite(root, entry, { dbPath });

    indexTracesToSqlite({ projectRoot: root, dbPath });
    expect(readTraceEntriesFromSqlite(root, "orphan-session", dbPath)).toEqual([entry]);
    const db = new Database(dbPath, { readonly: true });
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM trace_tools WHERE session_id = ?")
        .get("orphan-session")).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("builds trace insights from sqlite rows", () => {
    const insights = buildTraceInsightsFromSqlite(root, {}, dbPath);

    expect(insights?.summary).toMatchObject({
      totalSessions: 1,
      failedSessions: 1,
      llmRequests: 1,
      promptTokens: 10,
      cachedTokens: 4,
      nonCachedInputTokens: 6,
      completionTokens: 5,
      totalTokens: 15,
      toolCalls: 1,
      toolFailures: 1,
      maxTurnsWithoutUsefulProgressCount: 1,
      escalatedSessions: 1,
      escalations: 2,
      escalationRescued: 1,
      escalationFailedFast: 1,
      escalationBudgetExhausted: 0,
      escalationFireRate: 1,
      escalationRescueRate: 0.5,
    });
    expect(insights?.tools[0]).toMatchObject({
      id: "configure_servicenow_form",
      failures: 1,
      averageDurationMs: 20,
      totalTurns: 1,
      totalCost: 0.01,
      sampleSessionId: "session-1",
      sampleRunId: "run-1",
    });
    expect(insights?.models[0]).toMatchObject({
      id: "model-a",
      sessions: 1,
      calls: 1,
      failures: 1,
      requests: 1,
      averageDurationMs: 100,
      totalTurns: 1,
      totalCost: 0.01,
    });
    expect(insights?.runs[0]).toMatchObject({
      runId: "run-1",
      // The authoritative task_completed classification overrides the
      // session-derived rollup (issue #45).
      outcome: "verification_failed",
      topTools: ["configure_servicenow_form"],
    });
    expect(
      insights?.failures.find((row) => row.id === "verification_failed"),
    ).toMatchObject({ runs: 1, sampleRunId: "run-1" });
    expect(insights?.facets.failures).toContain("verification_failed");
    for (const values of Object.values(insights?.facets ?? {})) {
      expect(values).toEqual([...new Set(values)].sort());
    }
    expect(insights?.runs[0].topSkills).toEqual(
      expect.arrayContaining(["service-form", "record-review"]),
    );
    expect(insights?.facets.skills).toEqual(
      expect.arrayContaining(["service-form", "record-review"]),
    );
    expect(insights?.skills.find((row) => row.id === "record-review")).toMatchObject({
      sessions: 1, runs: 1, calls: 1, failures: 1,
      totalTurns: 1, totalCost: 0.01, sampleRunId: "run-1",
    });
    expect(insights?.events.find((row) => row.id === "node.failed")).toMatchObject({
      calls: 1,
      runs: 1,
    });
    expect(insights?.events.find((row) => row.id === "turn_event")).toMatchObject({
      calls: 1,
      sessions: 1,
    });
    expect(
      insights?.events.find((row) => row.id === "session_event"),
    ).toMatchObject({
      calls: 1,
      sessions: 1,
    });
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("matches JS insights for the indexed session and run fixture", () => {
    const sessions = readTraceSessionsFromSqlite(root) ?? [];
    const entriesBySession = new Map(sessions.map((session) => [
      session.sessionId!, readTraceEntriesFromSqlite(root, session.sessionId!) ?? [],
    ]));
    const runEventsByRun = new Map([["run-1", readRunTraceEventsFromSqlite(root, "run-1") ?? []]]);
    const filters = { sessionId: "session-1" };
    const js = buildTraceInsights({ sessions, entriesBySession, runEventsByRun, filters });
    const sqlite = buildTraceInsightsFromSqlite(root, filters, dbPath);
    expect(normalizeInsightNumbers(sqlite)).toEqual(normalizeInsightNumbers(js));
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("normalizes legacy indexed model IDs during aggregate reads", () => {
    const db = new Database(dbPath);
    try {
      db.prepare("UPDATE trace_turns SET model = ? WHERE session_id = ?")
        .run("accounts/fireworks/routers/model-a:nitro", "session-1");
    } finally {
      db.close();
    }
    const sessions = readTraceSessionsFromSqlite(root) ?? [];
    const entriesBySession = new Map(sessions.map((session) => [
      session.sessionId!, readTraceEntriesFromSqlite(root, session.sessionId!) ?? [],
    ]));
    const runEventsByRun = new Map([["run-1", readRunTraceEventsFromSqlite(root, "run-1") ?? []]]);
    const js = buildTraceInsights({ sessions, entriesBySession, runEventsByRun });
    const sqlite = buildTraceInsightsFromSqlite(root, {}, dbPath);
    expect(normalizeInsightNumbers(sqlite)).toEqual(normalizeInsightNumbers(js));
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("matches JS insights when a run classification extends an existing failure", () => {
    for (const [sessionId, minute] of [["session-2", 2], ["session-3", 3]] as const) {
      upsertTraceSessionToSqlite(root, {
        sessionId,
        runId: "run-2",
        startTime: Date.UTC(2026, 4, 11, 0, minute),
        endTime: Date.UTC(2026, 4, 11, 0, minute + 1),
        query: "Second objective",
        outcome: "completed",
        turnCount: minute,
        metrics: { totalCost: minute / 100 },
        skillToolMetrics: { skillId: "service-form" },
      }, { dbPath });
    }
    insertRunTraceEventToSqlite(root, {
      runId: "run-2", type: "task_completed", role: "system",
      data: { success: false, classification: "max_turns" },
    }, { dbPath });

    const sessions = readTraceSessionsFromSqlite(root) ?? [];
    const entriesBySession = new Map(sessions.map((session) => [
      session.sessionId!, readTraceEntriesFromSqlite(root, session.sessionId!) ?? [],
    ]));
    const runEventsByRun = new Map(["run-1", "run-2"].map((runId) => [
      runId, readRunTraceEventsFromSqlite(root, runId) ?? [],
    ]));
    const js = buildTraceInsights({ sessions, entriesBySession, runEventsByRun });
    const sqlite = buildTraceInsightsFromSqlite(root, {}, dbPath);
    expect(normalizeInsightNumbers(sqlite)).toEqual(normalizeInsightNumbers(js));
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("keeps a failure sample run when its latest session has no run", () => {
    upsertTraceSessionToSqlite(root, {
      sessionId: "session-2",
      startTime: Date.UTC(2026, 4, 11, 0, 2),
      outcome: "max_turns",
      turnCount: 1,
    }, { dbPath });

    const sessions = readTraceSessionsFromSqlite(root, dbPath) ?? [];
    const entriesBySession = new Map(sessions.map((session) => [
      session.sessionId!, readTraceEntriesFromSqlite(root, session.sessionId!, dbPath) ?? [],
    ]));
    const runEventsByRun = new Map([["run-1", readRunTraceEventsFromSqlite(root, "run-1", dbPath) ?? []]]);
    const js = buildTraceInsights({ sessions, entriesBySession, runEventsByRun });
    const sqlite = buildTraceInsightsFromSqlite(root, {}, dbPath);
    expect(sqlite?.failures.find((row) => row.id === "max_turns")).toMatchObject({
      sampleSessionId: "session-2",
      sampleRunId: "run-1",
    });
    expect(normalizeInsightNumbers(sqlite)).toEqual(normalizeInsightNumbers(js));
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("matches JS model metrics and filters when session and turn models differ", () => {
    upsertTraceSessionToSqlite(root, {
      sessionId: "session-2", runId: "run-2",
      startTime: Date.UTC(2026, 4, 11, 0, 2),
      endTime: Date.UTC(2026, 4, 11, 0, 3),
      outcome: "completed", turnCount: 2,
      models: ["metadata-only"],
      metrics: { totalCost: 0.02, modelBreakdown: { "breakdown-only": {} } },
    }, { dbPath });
    insertTraceTurnToSqlite(root, {
      sessionId: "session-2", runId: "run-2", turnNumber: 1,
      llmRequest: { model: "turn-only" },
      llmResponse: { durationMs: 20, usage: {
        prompt_tokens: 2, completion_tokens: 1, total_tokens: 3,
      } },
    }, { dbPath });

    const sessions = readTraceSessionsFromSqlite(root) ?? [];
    const entriesBySession = new Map(sessions.map((session) => [
      session.sessionId!, readTraceEntriesFromSqlite(root, session.sessionId!) ?? [],
    ]));
    const runEventsByRun = new Map([["run-1", readRunTraceEventsFromSqlite(root, "run-1") ?? []]]);
    for (const filters of [{}, { model: "metadata-only" }, { model: "turn-only" }]) {
      const js = buildTraceInsights({ sessions, entriesBySession, runEventsByRun, filters });
      const sqlite = buildTraceInsightsFromSqlite(root, filters, dbPath);
      expect(normalizeInsightNumbers(sqlite)).toEqual(normalizeInsightNumbers(js));
    }
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("matches JS unknown outcomes and selects the latest run query", () => {
    upsertTraceSessionToSqlite(root, {
      sessionId: "session-2", runId: "run-1",
      startTime: Date.UTC(2026, 4, 11, 0, 2),
      endTime: Date.UTC(2026, 4, 11, 0, 3),
      query: "Newer run query", outcome: "completed", turnCount: 2,
    }, { dbPath });
    upsertTraceSessionToSqlite(root, {
      sessionId: "session-3", startTime: Date.UTC(2026, 4, 11, 0, 4),
      query: "Unfinished session", turnCount: 0,
      failureCode: "none", failureCategory: "none",
    }, { dbPath });

    const sessions = readTraceSessionsFromSqlite(root) ?? [];
    const entriesBySession = new Map(sessions.map((session) => [
      session.sessionId!, readTraceEntriesFromSqlite(root, session.sessionId!) ?? [],
    ]));
    const runEventsByRun = new Map([["run-1", readRunTraceEventsFromSqlite(root, "run-1") ?? []]]);
    const js = buildTraceInsights({ sessions, entriesBySession, runEventsByRun });
    const sqlite = buildTraceInsightsFromSqlite(root, {}, dbPath);
    expect(normalizeInsightNumbers(sqlite)).toEqual(normalizeInsightNumbers(js));
    expect(sqlite?.facets.failures).toContain("unknown_failure");
    expect(sqlite?.runs[0]?.query).toBe("Newer run query");
    const filters = { failure: "unknown_failure" };
    expect(normalizeInsightNumbers(buildTraceInsightsFromSqlite(root, filters, dbPath)))
      .toEqual(normalizeInsightNumbers(buildTraceInsights({
        sessions, entriesBySession, runEventsByRun, filters,
      })));
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

});
