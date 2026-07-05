/**
 * Observability core — the shared query layer behind the trace MCP server
 * (RFC LP-7, Stage A). This module deliberately contains NO query/filter/SQL
 * logic of its own: it only wires together the functions the log-server HTTP
 * API already uses, so an agent (Claude Code) and the human viewer see identical
 * results. It also imports NO MCP SDK, so it is unit-testable in isolation.
 *
 * Data access is SQLite-first (the hot `.artifacts/trace-index.sqlite` index)
 * with a JSONL fallback that mirrors `scripts/log-server.ts` — so it works with
 * or without the log-server running, as long as traces exist on disk.
 *
 * The query functions take an `ObsStore` as their first argument so tests can
 * inject fixtures instead of touching disk.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import {
  buildTraceInsightsFromSqlite,
  getTraceIndexStatus,
  readRunTraceEventsFromSqlite,
  readTraceEntriesFromSqlite,
  readTraceSessionsFromSqlite,
  type TraceIndexStatus,
} from "../trace-sqlite-store";
import {
  matchesTraceFilters,
  normalizeAgentSessionRecord,
  normalizeAgentTurnRecord,
  normalizeRunEventRecord,
  type TraceEntryLike,
  type TraceSearchFiltersLike,
  type TraceSessionLike,
} from "../log-server-helpers";
import {
  buildTraceInsights,
  type TraceInsightsFilters,
  type TraceInsightsResponse,
} from "../trace-insights";
import { analyzeTraceSession } from "../../apps/extension/src/trace-viewer/analysis/analyze";
import { compareTraceSessions } from "../../apps/extension/src/trace-viewer/analysis/comparison";
import { buildTrajectoryScorecard } from "../../apps/extension/src/trace-viewer/analysis/trajectory";
import type {
  TraceEntry,
  TraceSession,
} from "../../apps/extension/src/types/traces";
import { buildRlTrajectory } from "./rl-trajectory";

// Project-root + on-disk layout (mirrors scripts/log-server.ts). scripts/obs ->
// repo root is two levels up.
export const PROJECT_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const TRACE_DIR = join(PROJECT_ROOT, "traces");
const TRACE_INDEX = join(TRACE_DIR, "index.jsonl");
const RUN_TRACE_DIR = join(TRACE_DIR, "runs");
const SCREENSHOT_DIR = join(TRACE_DIR, "screenshots");

/** The data-access surface. Default impl reads disk; tests inject fixtures. */
export interface ObsStore {
  projectRoot: string;
  loadSessions(): TraceSessionLike[];
  loadEntries(sessionId: string): TraceEntryLike[];
  loadRunEvents(runId: string): TraceEntryLike[];
  loadInsights(filters: TraceInsightsFilters): TraceInsightsResponse;
  indexStatus(): TraceIndexStatus;
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((value): value is unknown => value !== null);
}

/** Default store: SQLite-first, JSONL fallback (mirrors log-server reads). */
export function createDiskStore(projectRoot = PROJECT_ROOT): ObsStore {
  const loadSessions = (): TraceSessionLike[] => {
    const fromSqlite = readTraceSessionsFromSqlite(projectRoot);
    if (fromSqlite && fromSqlite.length > 0) return fromSqlite;
    return readJsonl(TRACE_INDEX).map((record) =>
      normalizeAgentSessionRecord(record as Record<string, unknown>),
    );
  };
  const loadEntries = (sessionId: string): TraceEntryLike[] => {
    const fromSqlite = readTraceEntriesFromSqlite(projectRoot, sessionId);
    if (fromSqlite && fromSqlite.length > 0) return fromSqlite;
    return readJsonl(join(TRACE_DIR, `${sessionId}.jsonl`)).map((record) =>
      normalizeAgentTurnRecord(record as Record<string, unknown>),
    );
  };
  const loadRunEvents = (runId: string): TraceEntryLike[] => {
    const fromSqlite = readRunTraceEventsFromSqlite(projectRoot, runId);
    if (fromSqlite && fromSqlite.length > 0) return fromSqlite;
    return readJsonl(join(RUN_TRACE_DIR, `${runId}.jsonl`)).map((record) =>
      normalizeRunEventRecord(record as Record<string, unknown>),
    );
  };
  const loadInsights = (filters: TraceInsightsFilters): TraceInsightsResponse => {
    const fromSqlite = buildTraceInsightsFromSqlite(projectRoot, filters);
    if (fromSqlite) return fromSqlite;
    // JSONL fallback: assemble the inputs buildTraceInsights expects.
    const sessions = loadSessions();
    const entriesBySession = new Map<string, TraceEntryLike[]>();
    for (const session of sessions) {
      if (session.sessionId) {
        entriesBySession.set(session.sessionId, loadEntries(session.sessionId));
      }
    }
    return buildTraceInsights({ sessions, entriesBySession, filters });
  };
  return {
    projectRoot,
    loadSessions,
    loadEntries,
    loadRunEvents,
    loadInsights,
    indexStatus: () => getTraceIndexStatus(projectRoot),
  };
}

// ---- Query functions (the MCP tool bodies; all reuse existing logic) --------

export interface TraceSummary {
  sessionId: string;
  query?: string;
  outcome?: string;
  startTime?: number;
  startUrl?: string;
  runId?: string;
  turnCount?: number;
  models?: string[];
}

function toSummary(session: TraceSessionLike): TraceSummary {
  return {
    sessionId: session.sessionId ?? "",
    query: session.query,
    outcome: session.outcome,
    startTime: session.startTime,
    startUrl: session.startUrl,
    runId: session.runId,
    turnCount: (session as { turnCount?: number }).turnCount,
    models: session.models,
  };
}

export interface SearchTracesArgs extends TraceSearchFiltersLike {
  limit?: number;
}

/** search_traces — filter sessions with the SAME predicate the HTTP API uses. */
export function searchTraces(
  store: ObsStore,
  args: SearchTracesArgs = {},
): TraceSummary[] {
  const { limit = 50, ...filters } = args;
  const sessions = store.loadSessions();
  const matched = sessions.filter((session) =>
    matchesTraceFilters(session, filters),
  );
  matched.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
  return matched.slice(0, Math.max(1, limit)).map(toSummary);
}

/** get_trace — one session's full turn list. */
export function getTrace(
  store: ObsStore,
  sessionId: string,
): { session: TraceSummary | null; entries: TraceEntryLike[] } {
  const session = store
    .loadSessions()
    .find((candidate) => candidate.sessionId === sessionId);
  return {
    session: session ? toSummary(session) : null,
    entries: store.loadEntries(sessionId),
  };
}

/** get_run — an orchestrator run's events plus the sessions it spans. */
export function getRun(
  store: ObsStore,
  runId: string,
): { runId: string; events: TraceEntryLike[]; sessionIds: string[] } {
  const events = store.loadRunEvents(runId);
  const ids = new Set<string>();
  for (const event of events) {
    const sid = (event as { sessionId?: string }).sessionId;
    if (sid) ids.add(sid);
  }
  for (const session of store.loadSessions()) {
    if (session.runId === runId && session.sessionId) ids.add(session.sessionId);
  }
  return { runId, events, sessionIds: [...ids] };
}

/** query_insights — the full aggregated `TraceInsightsResponse`. */
export function queryInsights(
  store: ObsStore,
  filters: TraceInsightsFilters = {},
): TraceInsightsResponse {
  return store.loadInsights(filters);
}

/** find_failures — the failure facet rows for the (optionally filtered) set. */
export function findFailures(
  store: ObsStore,
  filters: TraceInsightsFilters = {},
): TraceInsightsResponse["failures"] {
  return store.loadInsights(filters).failures;
}

/** list_tool_usage — per-tool call/failure rollup. */
export function listToolUsage(
  store: ObsStore,
  filters: TraceInsightsFilters = {},
): TraceInsightsResponse["tools"] {
  return store.loadInsights(filters).tools;
}

/** get_trajectory — the OpenClaw-style graded (state, action, reward) scorecard. */
export function getTrajectory(store: ObsStore, sessionId: string) {
  const session = store
    .loadSessions()
    .find((candidate) => candidate.sessionId === sessionId);
  if (!session) return null;
  const entries = store.loadEntries(sessionId);
  const typedSession = session as unknown as TraceSession;
  const typedEntries = entries as unknown as TraceEntry[];
  const investigation = analyzeTraceSession({
    session: typedSession,
    entries: typedEntries,
  });
  return buildTrajectoryScorecard({
    session: typedSession,
    entries: typedEntries,
    investigation,
  });
}

/** get_rl_trajectory — the OpenClaw (state, action, reward) projection. */
export function getRlTrajectory(store: ObsStore, sessionId: string) {
  const session = store
    .loadSessions()
    .find((candidate) => candidate.sessionId === sessionId);
  if (!session) return null;
  const entries = store.loadEntries(sessionId);
  return buildRlTrajectory(
    session as unknown as TraceSession,
    entries as unknown as TraceEntry[],
  );
}

/** compare_runs — related sessions for comparative debugging. */
export function compareRuns(store: ObsStore, sessionId: string) {
  const sessions = store.loadSessions();
  const base = sessions.find((candidate) => candidate.sessionId === sessionId);
  if (!base) return null;
  return compareTraceSessions(
    base as unknown as TraceSession,
    sessions as unknown as TraceSession[],
  );
}

/** get_blob — a turn screenshot, returned as a path + base64 (when present). */
export function getBlob(
  sessionId: string,
  turn: number,
): { path: string; exists: boolean; base64?: string } {
  const path = join(SCREENSHOT_DIR, `${sessionId}-T${turn}.jpg`);
  if (!existsSync(path)) return { path, exists: false };
  return { path, exists: true, base64: readFileSync(path).toString("base64") };
}

/**
 * get_span — interim turn-as-span view until the span spine lands (Stage B0).
 * Projects one turn into a minimal, forward-compatible span shape.
 */
export function getSpan(store: ObsStore, sessionId: string, turn: number) {
  const entry = store
    .loadEntries(sessionId)
    .find((candidate) => (candidate as { turnNumber?: number }).turnNumber === turn);
  if (!entry) return null;
  const e = entry as Record<string, unknown> & {
    turnNumber?: number;
    llmRequest?: { model?: string };
    toolExecutions?: unknown[];
  };
  return {
    name: "agent.turn",
    sessionId,
    turnNumber: e.turnNumber,
    model: e.llmRequest?.model,
    toolCount: Array.isArray(e.toolExecutions) ? e.toolExecutions.length : 0,
    note: "interim turn-as-span; full spans arrive with Stage B0",
    raw: entry,
  };
}

/** index_status — health/coverage of the SQLite trace index. */
export function indexStatus(store: ObsStore): TraceIndexStatus {
  return store.indexStatus();
}
