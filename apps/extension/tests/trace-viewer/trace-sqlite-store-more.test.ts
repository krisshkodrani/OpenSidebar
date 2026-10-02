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
import { buildTraceInsights } from "../../../../scripts/trace-insights";
import {
  buildHarnessRatchetCandidates,
  buildTraceInsightsFromSqlite,
  insertRunTraceEventToSqlite,
  insertTraceTurnToSqlite,
  readRunRawJsonlFromSqlite,
  readRunTraceEventsFromSqlite,
  readTraceEntriesFromSqlite,
  readTraceRawJsonlFromSqlite,
  readTraceSessionsFromSqlite,
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

  test("keeps the full run count while limiting displayed runs", () => {
    const capRoot = join(root, "cap-fixture");
    mkdirSync(join(capRoot, "traces", "runs"), { recursive: true });
    writeJsonl(join(capRoot, "traces", "index.jsonl"),
      Array.from({ length: 205 }, (_, index) => ({
        sessionId: `cap-session-${index}`,
        runId: `cap-run-${index}`,
        startTime: Date.UTC(2026, 4, 11, 0, index),
        endTime: Date.UTC(2026, 4, 11, 0, index + 1),
        outcome: "completed",
      })));
    const capDbPath = join(capRoot, ".artifacts", "trace-index.sqlite");
    indexTracesToSqlite({ projectRoot: capRoot, dbPath: capDbPath });

    const sessions = readTraceSessionsFromSqlite(capRoot, capDbPath) ?? [];
    const js = buildTraceInsights({ sessions, entriesBySession: new Map() });
    const sqlite = buildTraceInsightsFromSqlite(capRoot, {}, capDbPath);
    expect(sqlite?.summary.totalRuns).toBe(205);
    expect(sqlite?.runs).toHaveLength(200);
    expect(normalizeInsightNumbers(sqlite)).toEqual(normalizeInsightNumbers(js));
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("keeps session cost separate from recorded request cost", () => {
    upsertTraceSessionToSqlite(root, {
      sessionId: "session-1",
      runId: "run-1",
      startTime: Date.UTC(2026, 4, 11),
      endTime: Date.UTC(2026, 4, 11, 0, 1),
      query: "Objective: test",
      startUrl: "https://example.com/a",
      outcome: "max_turns",
      turnCount: 1,
      metrics: { totalTokens: 15, totalCost: 0.025 },
    });

    const insights = buildTraceInsightsFromSqlite(root, {}, dbPath);
    expect(insights?.summary.totalCost).toBe(0.025);
    expect(insights?.summary.requestCost).toBe(0.01);
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("keeps every event type available as a filter facet", () => {
    upsertTraceSessionToSqlite(root, {
      sessionId: "session-1",
      runId: "run-1",
      startTime: Date.UTC(2026, 4, 11),
      outcome: "max_turns",
      events: Array.from({ length: 25 }, (_, index) => ({
        type: `custom_event_${index}`,
      })),
    });

    const facets = buildTraceInsightsFromSqlite(root, {}, dbPath)?.facets;
    expect(facets?.eventTypes).toEqual(expect.arrayContaining([
      "custom_event_0", "custom_event_24",
    ]));
    expect(facets?.eventTypes.length).toBeGreaterThan(20);
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

  test("counts session cost once for repeated tool calls and events", () => {
    upsertTraceSessionToSqlite(root, {
      sessionId: "session-2", runId: "run-2", startTime: Date.UTC(2026, 4, 11, 0, 2),
      query: "Q".repeat(520), outcome: "completed", turnCount: 3,
      metrics: { totalCost: 0.02 },
      events: [{ type: "session_event" }, { type: "session_event" }],
    });
    insertTraceTurnToSqlite(root, {
      sessionId: "session-2", runId: "run-2", turnNumber: 1,
      toolExecutions: [
        { toolName: "configure_servicenow_form", success: true, durationMs: 5 },
        { toolName: "configure_servicenow_form", success: true, durationMs: 15 },
        { toolName: "read_page", success: true, durationMs: 1 },
        { toolName: "click_element", success: true, durationMs: 1 },
      ],
    });

    const insights = buildTraceInsightsFromSqlite(root, {}, dbPath);
    const tool = insights?.tools.find(
      (row) => row.id === "configure_servicenow_form",
    );
    expect(tool).toMatchObject({
      sessions: 2, runs: 2, calls: 3, successes: 2, failures: 1,
      totalTurns: 4, totalCost: 0.03,
    });
    const event = insights?.events.find(
      (row) => row.id === "session_event",
    );
    expect(event).toMatchObject({
      sessions: 2, runs: 2, calls: 3,
      totalTurns: 4, totalCost: 0.03,
    });
    const run = insights?.runs.find((row) => row.runId === "run-2");
    expect(run?.query).toBe(`${"Q".repeat(497)}...`);
    expect(run?.topTools).toEqual([
      "configure_servicenow_form", "read_page", "click_element",
    ]);
  }, TRACE_SQLITE_TEST_TIMEOUT_MS);

});
