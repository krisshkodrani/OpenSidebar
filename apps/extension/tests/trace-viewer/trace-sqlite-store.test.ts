import {
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
import {
  buildHarnessRatchetCandidates,
  buildTraceInsightsFromSqlite,
  buildTraceTrendsFromSqlite,
  getTraceIndexStatus,
  insertRunTraceEventToSqlite,
  insertTraceTurnToSqlite,
  readRunRawJsonlFromSqlite,
  readRunTraceEventsFromSqlite,
  readTraceEntriesFromSqlite,
  readTraceRawJsonlFromSqlite,
  readTraceSessionsFromSqlite,
  searchTraceSessionsFromSqlite,
  upsertRunTraceManifestToSqlite,
  upsertTraceSessionToSqlite,
} from "../../../../scripts/trace-sqlite-store";

const TRACE_SQLITE_TEST_TIMEOUT_MS = 30_000;

function writeJsonl(path: string, records: unknown[]) {
  writeFileSync(
    path,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
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
  });

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
      sampleSessionId: "session-1",
    });
    expect(insights?.models[0]).toMatchObject({
      id: "model-a",
      sessions: 1,
      requests: 1,
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
    expect(insights?.runs[0].topSkills).toEqual(
      expect.arrayContaining(["service-form", "record-review"]),
    );
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

  test("searches sessions with indexed filters and cursor metadata", () => {
    const page = searchTraceSessionsFromSqlite(
      root,
      { outcome: "max_turns" },
      { limit: 10, path: dbPath },
    );

    expect(page).toMatchObject({ total: 1, hasMore: false, nextCursor: null });
    expect(page?.items.map((session) => session.sessionId)).toEqual([
      "session-1",
    ]);
  });

  test("builds the trend series in one grouped query", () => {
    expect(buildTraceTrendsFromSqlite(root, {}, 30, dbPath)).toEqual([
      expect.objectContaining({
        day: "2026-05-11",
        totalSessions: 1,
        completedSessions: 0,
        recordedCost: expect.any(Number),
        averageTurns: 1,
      }),
    ]);
  });

  test("matches event filters across turn, session, and run event sources", () => {
    upsertTraceSessionToSqlite(
      root,
      {
        sessionId: "session-2",
        runId: "run-1",
        startTime: Date.UTC(2026, 4, 11, 0, 2),
        endTime: Date.UTC(2026, 4, 11, 0, 3),
        query: "Second trace in same run",
        startUrl: "https://example.com/b",
        outcome: "completed",
        turnCount: 1,
        events: [
          { type: "session_event_two", timestamp: Date.UTC(2026, 4, 11, 0, 2) },
        ],
      },
      { dbPath },
    );
    insertTraceTurnToSqlite(
      root,
      {
        sessionId: "session-2",
        runId: "run-1",
        turnNumber: 1,
        llmRequest: { model: "model-b" },
        llmResponse: {
          durationMs: 50,
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        },
        events: [
          { type: "turn_event_two", timestamp: Date.UTC(2026, 4, 11, 0, 2) },
        ],
        toolExecutions: [{ toolName: "click", success: true }],
      },
      { dbPath },
    );

    const insights = buildTraceInsightsFromSqlite(root, {}, dbPath);

    expect(insights?.events.find((row) => row.id === "node.failed")).toMatchObject({
      calls: 1,
      runs: 1,
    });
    expect(
      buildTraceInsightsFromSqlite(root, { eventType: "turn_event_two" }, dbPath)
        ?.summary.totalSessions,
    ).toBe(1);
    expect(
      buildTraceInsightsFromSqlite(
        root,
        { eventType: "session_event_two" },
        dbPath,
      )?.summary.totalSessions,
    ).toBe(1);
    expect(
      buildTraceInsightsFromSqlite(root, { eventType: "node.failed" }, dbPath)
        ?.summary.totalSessions,
    ).toBe(2);
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("applies session filters before reading sqlite trace details", () => {
    upsertTraceSessionToSqlite(
      root,
      {
        sessionId: "session-2",
        runId: "run-2",
        startTime: Date.UTC(2026, 4, 12),
        endTime: Date.UTC(2026, 4, 12, 0, 1),
        query: "Filtered objective",
        startUrl: "https://example.com/b",
        outcome: "completed",
        turnCount: 1,
      },
      { dbPath },
    );
    insertTraceTurnToSqlite(
      root,
      {
        sessionId: "session-2",
        runId: "run-2",
        turnNumber: 1,
        llmRequest: { model: "model-b" },
        llmResponse: {
          durationMs: 50,
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        },
        toolExecutions: [{ toolName: "click", success: true }],
      },
      { dbPath },
    );

    const insights = buildTraceInsightsFromSqlite(
      root,
      { from: "2026-05-12", to: "2026-05-12" },
      dbPath,
    );

    expect(insights?.summary).toMatchObject({
      totalSessions: 1,
      completedSessions: 1,
      failedSessions: 0,
      toolCalls: 1,
      toolFailures: 0,
    });
    expect(insights?.facets.sessions).toEqual(["session-2"]);
    expect(insights?.tools[0]).toMatchObject({
      id: "click",
      sampleSessionId: "session-2",
    });
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("builds harness ratchet candidates", () => {
    const candidates = buildHarnessRatchetCandidates(root, dbPath);

    expect(candidates.map((candidate) => candidate.id)).toContain(
      "tool:configure_servicenow_form",
    );
    expect(candidates.map((candidate) => candidate.id)).toContain(
      "outcome:max_turns",
    );
    expect(candidates.map((candidate) => candidate.id)).toContain(
      "context:pressure",
    );
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("ingests live trace records and exposes raw JSONL from sqlite", () => {
    upsertTraceSessionToSqlite(
      root,
      {
        sessionId: "live-session",
        runId: "live-run",
        startTime: Date.UTC(2026, 4, 12),
        endTime: Date.UTC(2026, 4, 12, 0, 1),
        query: "Live objective",
        startUrl: "https://example.com/live",
        outcome: "completed",
        turnCount: 1,
      },
      { dbPath },
    );
    insertTraceTurnToSqlite(
      root,
      {
        sessionId: "live-session",
        runId: "live-run",
        turnNumber: 1,
        llmRequest: { model: "live-model", modelTier: "executor" },
        llmResponse: {
          durationMs: 50,
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        },
        toolExecutions: [{ toolName: "click", success: true }],
      },
      { dbPath },
    );
    upsertRunTraceManifestToSqlite(
      root,
      { runId: "live-run", query: "Live objective" },
      { dbPath },
    );
    insertRunTraceEventToSqlite(
      root,
      { runId: "live-run", type: "node.completed", role: "executor", turn: 1 },
      { dbPath },
    );

    expect(
      readTraceSessionsFromSqlite(root, dbPath)?.some(
        (session) => session.sessionId === "live-session",
      ),
    ).toBe(true);
    expect(readTraceEntriesFromSqlite(root, "live-session", dbPath)).toHaveLength(1);
    expect(readRunTraceEventsFromSqlite(root, "live-run", dbPath)).toHaveLength(1);
    expect(readTraceRawJsonlFromSqlite(root, "live-session", dbPath)).toHaveLength(2);
    expect(readRunRawJsonlFromSqlite(root, "live-run", dbPath)).toHaveLength(2);
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);
});
