import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  compareRuns,
  createDiskStore,
  findFailures,
  getRun,
  getSpan,
  getTrace,
  getTrajectory,
  investigateTrace,
  listToolUsage,
  queryInsights,
  searchTraces,
  type ObsStore,
} from "./core";
import type { TraceEntryLike, TraceSessionLike } from "../log-server-helpers";
import type { TraceInsightsResponse } from "../trace-insights";

// ---- Fixtures ---------------------------------------------------------------

const sessions = [
  {
    sessionId: "s1",
    startTime: 2000,
    endTime: 2500,
    query: "buy milk",
    startUrl: "https://shop.example.com/cart",
    outcome: "completed",
    runId: "r1",
    turnCount: 1,
    models: ["model-a"],
  },
  {
    sessionId: "s2",
    startTime: 1000,
    endTime: 1500,
    query: "find docs",
    startUrl: "https://docs.example.org/page",
    outcome: "error",
    runId: "r1",
    turnCount: 2,
    models: ["model-b"],
  },
] as unknown as TraceSessionLike[];

const entriesById: Record<string, TraceEntryLike[]> = {
  s1: [
    {
      sessionId: "s1",
      turnNumber: 1,
      timestamp: 2000,
      snapshot: {
        url: "https://shop.example.com/cart",
        title: "Cart",
        elementCount: 5,
        visibleContentLength: 100,
        scrollY: 0,
      },
      elements: [],
      llmRequest: {
        model: "model-a",
        modelTier: "executor",
        messageCount: 2,
        toolCount: 1,
        compressionLevel: "NONE",
      },
      llmResponse: {
        content: "done",
        toolCalls: [],
        finishReason: "stop",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        durationMs: 100,
      },
      toolExecutions: [
        {
          toolCallId: "t1",
          toolName: "read_page",
          args: {},
          result: "ok",
          success: true,
          durationMs: 20,
          riskLevel: "LOW",
        },
      ],
      events: [],
      progressState: { stagnantTurns: 0, signal: null },
    },
  ] as unknown as TraceEntryLike[],
};

const runEvents: Record<string, TraceEntryLike[]> = {
  r1: [
    { runId: "r1", sessionId: "s1", type: "node_started", ts: "t" },
    { runId: "r1", sessionId: "s2", type: "node_completed", ts: "t" },
  ] as unknown as TraceEntryLike[],
};

const insights = {
  summary: { totalSessions: 2, failedSessions: 1 },
  facets: {},
  tools: [{ key: "read_page", total: 1, failures: 0 }],
  skills: [],
  models: [],
  failures: [{ key: "error", total: 1 }],
  events: [],
  runs: [],
} as unknown as TraceInsightsResponse;

function makeStore(over: Partial<ObsStore> = {}): ObsStore {
  return {
    projectRoot: "/fake",
    loadSessions: () => sessions,
    loadEntries: (id) => entriesById[id] ?? [],
    loadRunEvents: (rid) => runEvents[rid] ?? [],
    loadInsights: () => insights,
    indexStatus: () =>
      ({ available: true, source: "sqlite", sessions: 2 }) as never,
    ...over,
  };
}

describe("disk store read cutover", () => {
  it("prefers spine records and preserves unmigrated JSONL sessions", () => {
    const root = mkdtempSync(join(tmpdir(), "obs-disk-store-"));
    try {
      const traces = join(root, "traces");
      const spans = join(traces, "spans");
      mkdirSync(join(spans, "s1"), { recursive: true });
      mkdirSync(join(spans, "runs"), { recursive: true });
      writeFileSync(join(spans, "s1", "session.json"), JSON.stringify({
        sessionId: "s1", runId: "r1", query: "spine session", outcome: "completed",
      }));
      writeFileSync(join(spans, "s1", "T1.json"), JSON.stringify({
        v: 1, entry: { sessionId: "s1", turnNumber: 1, marker: "spine turn" }, spans: [],
      }));
      writeFileSync(join(spans, "runs", "r1.jsonl"),
        `${JSON.stringify({ runId: "r1", type: "spine_event" })}\n`);
      mkdirSync(join(spans, "s4"), { recursive: true });
      writeFileSync(join(spans, "s4", "session.json"),
        JSON.stringify({ sessionId: "s4", query: "empty spine session" }));
      writeFileSync(join(spans, "runs", "r2.manifest.json"),
        JSON.stringify({ runId: "r2", query: "empty spine run" }));
      writeFileSync(join(traces, "index.jsonl"), [
        { sessionId: "s1", runId: "r1", query: "legacy session" },
        { sessionId: "s2", query: "unmigrated session" },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n");
      writeFileSync(join(traces, "s1.jsonl"),
        `${JSON.stringify({ sessionId: "s1", turnNumber: 1, marker: "legacy turn" })}\n`);
      writeFileSync(join(traces, "s3.jsonl"),
        `${JSON.stringify({ sessionId: "s3", turnNumber: 1, marker: "orphan turn" })}\n`);
      writeFileSync(join(traces, "s4.jsonl"),
        `${JSON.stringify({ sessionId: "s4", turnNumber: 1, marker: "stale legacy turn" })}\n`);
      mkdirSync(join(traces, "runs"), { recursive: true });
      writeFileSync(join(traces, "runs", "r1.jsonl"),
        `${JSON.stringify({ runId: "r1", type: "legacy_event" })}\n`);
      writeFileSync(join(traces, "runs", "r2.jsonl"),
        `${JSON.stringify({ runId: "r2", type: "stale legacy event" })}\n`);

      const store = createDiskStore(root);
      expect(store.loadSessions().map((session) => session.query)).toEqual([
        "spine session", "empty spine session", "unmigrated session", undefined,
      ]);
      expect(store.loadSessions().find((session) => session.sessionId === "s3"))
        .toMatchObject({ source: "orphan_trace_file" });
      expect(store.loadEntries("s1")[0]).toMatchObject({ marker: "spine turn" });
      expect(store.loadRunEvents("r1")[0]).toMatchObject({ type: "spine_event" });
      expect(store.loadEntries("s4")).toEqual([]);
      expect(store.loadRunEvents("r2")).toEqual([]);
      expect(store.loadInsights({}).events.some((row) => row.id === "spine_event"))
        .toBe(true);

      const legacy = createDiskStore(root, { spineReads: false });
      expect(legacy.loadSessions()[0].query).toBe("legacy session");
      expect(legacy.loadSessions().map((session) => session.sessionId)).toContain("s3");
      expect(legacy.loadEntries("s1")[0]).toMatchObject({ marker: "legacy turn" });
      expect(legacy.loadRunEvents("r1")[0]).toMatchObject({ type: "legacy_event" });
      expect(legacy.loadEntries("s4")[0]).toMatchObject({ marker: "stale legacy turn" });
      expect(legacy.loadRunEvents("r2")[0]).toMatchObject({ type: "stale legacy event" });
      vi.stubEnv("OBS_DISABLE_SPINE_READS", "1");
      expect(createDiskStore(root).loadEntries("s1")[0])
        .toMatchObject({ marker: "legacy turn" });
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---- Tests ------------------------------------------------------------------

describe("searchTraces", () => {
  it("returns all sessions newest-first", () => {
    const result = searchTraces(makeStore());
    expect(result.map((r) => r.sessionId)).toEqual(["s1", "s2"]);
  });

  it("filters by outcome using the shared predicate", () => {
    const result = searchTraces(makeStore(), { outcome: "error" });
    expect(result.map((r) => r.sessionId)).toEqual(["s2"]);
  });

  it("respects the limit", () => {
    const result = searchTraces(makeStore(), { limit: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("uses the repository's indexed search when available", () => {
    const searchSessions = vi.fn(() => ({
      items: [sessions[1]],
      total: 1,
      hasMore: false,
      nextCursor: null,
    }));
    const result = searchTraces(makeStore({ searchSessions }), {
      outcome: "error",
      limit: 1,
    });
    expect(searchSessions).toHaveBeenCalledWith(
      { outcome: "error" },
      { limit: 1 },
    );
    expect(result.map((item) => item.sessionId)).toEqual(["s2"]);
  });
});

describe("getTrace", () => {
  it("returns the session summary and its entries", () => {
    const { session, entries } = getTrace(makeStore(), "s1");
    expect(session?.sessionId).toBe("s1");
    expect(entries).toHaveLength(1);
    expect(session?.viewerUrl).toContain("#session=s1");
  });

  it("returns null session for an unknown id", () => {
    const { session } = getTrace(makeStore(), "nope");
    expect(session).toBeNull();
  });
});

describe("investigateTrace", () => {
  it("returns a compact diagnosis with a Viewer link", () => {
    const result = investigateTrace(makeStore(), "s1");
    expect(result?.headline).toBeTruthy();
    expect(result?.viewerUrl).toContain("#session=s1");
    expect(result?.findings.length).toBeLessThanOrEqual(8);
  });

  it("returns null for an unknown session", () => {
    expect(investigateTrace(makeStore(), "missing")).toBeNull();
  });
});

describe("getRun", () => {
  it("derives session ids from events and run-linked sessions", () => {
    const { events, sessionIds } = getRun(makeStore(), "r1");
    expect(events).toHaveLength(2);
    expect(sessionIds.sort()).toEqual(["s1", "s2"]);
  });
});

describe("insights wrappers", () => {
  it("query_insights returns the store's insights", () => {
    expect(queryInsights(makeStore()).summary).toEqual(insights.summary);
  });
  it("find_failures returns the failure facet", () => {
    expect(findFailures(makeStore())).toEqual(insights.failures);
  });
  it("list_tool_usage returns the tools facet", () => {
    expect(listToolUsage(makeStore())).toEqual(insights.tools);
  });
});

describe("getTrajectory", () => {
  it("produces an OpenClaw-style scorecard from spans/turns", () => {
    const scorecard = getTrajectory(makeStore(), "s1");
    expect(scorecard).not.toBeNull();
    expect(scorecard?.sessionId).toBe("s1");
    expect(Array.isArray(scorecard?.dimensions)).toBe(true);
    expect(scorecard?.dimensions.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown session", () => {
    expect(getTrajectory(makeStore(), "nope")).toBeNull();
  });
});

describe("compareRuns", () => {
  it("returns a comparison for a known base session", () => {
    expect(compareRuns(makeStore(), "s1")).not.toBeNull();
  });
  it("returns null for an unknown base session", () => {
    expect(compareRuns(makeStore(), "nope")).toBeNull();
  });
});

describe("getSpan", () => {
  it("projects a single turn into an interim span shape", () => {
    const span = getSpan(makeStore(), "s1", 1);
    expect(span?.name).toBe("agent.turn");
    expect(span?.turnNumber).toBe(1);
    expect(span?.toolCount).toBe(1);
  });
  it("returns null for a missing turn", () => {
    expect(getSpan(makeStore(), "s1", 99)).toBeNull();
  });
});
