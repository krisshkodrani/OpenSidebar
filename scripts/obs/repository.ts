/** Shared read-only trace repository used by HTTP, MCP, and CLI surfaces. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildTraceInsightsFromSqlite,
  getTraceIndexStatus,
  readRunTraceEventsFromSqlite,
  readTraceEntriesFromSqlite,
  readTraceSessionsFromSqlite,
  searchTraceSessionsFromSqlite,
  type TraceIndexStatus,
  type TraceSessionSearchPage,
} from "../trace-sqlite-store";
import {
  matchesTraceFilters,
  normalizeAgentSessionRecord,
  normalizeAgentTurnRecord,
  normalizeRunEventRecord,
  type TraceEntryLike,
  type TraceSessionLike,
} from "../log-server-helpers";
import {
  buildTraceInsights,
  type TraceInsightsFilters,
  type TraceInsightsResponse,
} from "../trace-insights";
import {
  readSessionEntries,
  readSpineRunEvents,
  readSpineSessions,
} from "./span-store";
import { PROJECT_ROOT as DEFAULT_PROJECT_ROOT } from "./paths";

export interface TraceRepository {
  projectRoot: string;
  searchSessions?(
    filters: TraceInsightsFilters,
    options: { limit: number; cursor?: string },
  ): TraceSessionSearchPage;
  loadSessions(): TraceSessionLike[];
  loadEntries(sessionId: string): TraceEntryLike[];
  loadRunEvents(runId: string): TraceEntryLike[];
  loadInsights(filters: TraceInsightsFilters): TraceInsightsResponse;
  indexStatus(): TraceIndexStatus;
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

export function createTraceRepository(projectRoot: string): TraceRepository {
  const traceDir = join(projectRoot, "traces");
  const traceIndex = join(traceDir, "index.jsonl");
  const runTraceDir = join(traceDir, "runs");

  const loadSessions = (): TraceSessionLike[] => {
    // SQLite is the query projection and is intentionally first for lists.
    const sqlite = readTraceSessionsFromSqlite(projectRoot);
    if (sqlite && sqlite.length > 0) return sqlite;
    if (
      projectRoot === DEFAULT_PROJECT_ROOT &&
      process.env.OBS_SPINE_READS === "1"
    ) {
      const spine = readSpineSessions();
      if (spine.length > 0) return spine as unknown as TraceSessionLike[];
    }
    return readJsonl(traceIndex).map((record) =>
      normalizeAgentSessionRecord(record as Record<string, unknown>),
    );
  };

  const loadEntries = (sessionId: string): TraceEntryLike[] => {
    // Full-fidelity details come from the authoritative span spine first.
    if (
      projectRoot === DEFAULT_PROJECT_ROOT &&
      process.env.OBS_DISABLE_SPINE_READS !== "1"
    ) {
      const spine = readSessionEntries(sessionId);
      if (spine.length > 0) return spine as unknown as TraceEntryLike[];
    }
    const sqlite = readTraceEntriesFromSqlite(projectRoot, sessionId);
    if (sqlite && sqlite.length > 0) return sqlite;
    return readJsonl(join(traceDir, `${sessionId}.jsonl`)).map((record) =>
      normalizeAgentTurnRecord(record as Record<string, unknown>),
    );
  };

  const loadRunEvents = (runId: string): TraceEntryLike[] => {
    if (
      projectRoot === DEFAULT_PROJECT_ROOT &&
      process.env.OBS_DISABLE_SPINE_READS !== "1"
    ) {
      const spine = readSpineRunEvents(runId);
      if (spine.length > 0) return spine as unknown as TraceEntryLike[];
    }
    const sqlite = readRunTraceEventsFromSqlite(projectRoot, runId);
    if (sqlite && sqlite.length > 0) return sqlite;
    return readJsonl(join(runTraceDir, `${runId}.jsonl`)).map((record) =>
      normalizeRunEventRecord(record as Record<string, unknown>),
    );
  };

  const loadInsights = (
    filters: TraceInsightsFilters,
  ): TraceInsightsResponse => {
    const sqlite = buildTraceInsightsFromSqlite(projectRoot, filters);
    if (sqlite) return sqlite;
    const sessions = loadSessions();
    const entriesBySession = new Map<string, TraceEntryLike[]>();
    for (const session of sessions) {
      if (session.sessionId) {
        entriesBySession.set(session.sessionId, loadEntries(session.sessionId));
      }
    }
    return buildTraceInsights({ sessions, entriesBySession, filters });
  };

  const searchSessions = (
    filters: TraceInsightsFilters,
    options: { limit: number; cursor?: string },
  ): TraceSessionSearchPage => {
    const sqlite = searchTraceSessionsFromSqlite(projectRoot, filters, options);
    if (sqlite) return sqlite;
    const items = loadSessions()
      .filter((session) => matchesTraceFilters(session, filters))
      .sort((a, b) => {
        const byTime = (b.startTime ?? 0) - (a.startTime ?? 0);
        return byTime !== 0
          ? byTime
          : String(a.sessionId ?? "").localeCompare(String(b.sessionId ?? ""));
      });
    const boundedLimit = Math.max(1, Math.floor(options.limit));
    const cursorIndex = options.cursor
      ? items.findIndex(
          (session) =>
            `${session.startTime ?? 0}|${session.sessionId ?? ""}` ===
            options.cursor,
        )
      : -1;
    const offset = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageItems = items.slice(offset, offset + boundedLimit);
    const hasMore = offset + pageItems.length < items.length;
    const last = pageItems.at(-1);
    return {
      items: pageItems,
      total: items.length,
      hasMore,
      nextCursor:
        hasMore && last
          ? `${last.startTime ?? 0}|${last.sessionId ?? ""}`
          : null,
    };
  };

  return {
    projectRoot,
    searchSessions,
    loadSessions,
    loadEntries,
    loadRunEvents,
    loadInsights,
    indexStatus: () => getTraceIndexStatus(projectRoot),
  };
}
