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
  getTraceIndexStatus,
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
            completion_tokens: 5,
            total_tokens: 15,
            cost: 0.01,
          },
        },
        perception: { mode: "degraded", screenshotStatus: "capture_failed" },
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
      runEvents: 1,
    });
  });

  test("builds trace insights from sqlite rows", () => {
    const insights = buildTraceInsightsFromSqlite(root, {}, dbPath);

    expect(insights?.summary).toMatchObject({
      totalSessions: 1,
      failedSessions: 1,
      llmRequests: 1,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      toolCalls: 1,
      toolFailures: 1,
    });
    expect(insights?.tools[0]).toMatchObject({
      id: "configure_servicenow_form",
      failures: 1,
      sampleSessionId: "session-1",
    });
  });

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
  });

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
  });
});
