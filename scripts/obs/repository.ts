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
  hasSpineSessionRecord,
  hasSpineRunRecord,
} from "./span-store";
import { orderTraceEntries, preferSpineSessions } from "./session-read-policy";
import { readLegacyJsonlSessions } from "./legacy-sessions";

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

export function createTraceRepository(
  projectRoot: string,
  options: { spineReads?: boolean } = {},
): TraceRepository {
  const traceDir = join(projectRoot, "traces");
  const spanDir = join(traceDir, "spans");
  const runDir = join(traceDir, "runs");
  const spineReadsEnabled =
    options.spineReads ?? process.env.OBS_DISABLE_SPINE_READS !== "1";
  const loadSessions = (): TraceSessionLike[] => {
    const spine = spineReadsEnabled
      ? (readSpineSessions(spanDir) as unknown as TraceSessionLike[])
      : [];
    const fromSqlite = readTraceSessionsFromSqlite(projectRoot) ?? [];
    const { indexed, orphans } = readLegacyJsonlSessions(traceDir);
    return preferSpineSessions(
      spine,
      preferSpineSessions(fromSqlite, preferSpineSessions(indexed, orphans)),
    );
  };
  const loadEntries = (sessionId: string): TraceEntryLike[] => {
    if (spineReadsEnabled) {
      const spine = readSessionEntries(sessionId, spanDir);
      if (spine.length > 0 || hasSpineSessionRecord(sessionId, spanDir))
        return spine as unknown as TraceEntryLike[];
    }
    const fromSqlite = readTraceEntriesFromSqlite(projectRoot, sessionId);
    if (fromSqlite && fromSqlite.length > 0) return fromSqlite;
    return orderTraceEntries(
      readJsonl(join(traceDir, `${sessionId}.jsonl`)).map((record) =>
        normalizeAgentTurnRecord(record as Record<string, unknown>),
      ),
    );
  };
  const loadRunEvents = (runId: string): TraceEntryLike[] => {
    if (spineReadsEnabled) {
      const spineRunDir = join(spanDir, "runs");
      const spine = readSpineRunEvents(runId, spineRunDir);
      if (spine.length > 0 || hasSpineRunRecord(runId, spineRunDir))
        return spine as unknown as TraceEntryLike[];
    }
    const fromSqlite = readRunTraceEventsFromSqlite(projectRoot, runId);
    if (fromSqlite && fromSqlite.length > 0) return fromSqlite;
    return readJsonl(join(runDir, `${runId}.jsonl`)).map((record) =>
      normalizeRunEventRecord(record as Record<string, unknown>),
    );
  };
  const loadInsights = (
    filters: TraceInsightsFilters,
  ): TraceInsightsResponse => {
    const fromSqlite = buildTraceInsightsFromSqlite(projectRoot, filters);
    if (fromSqlite) return fromSqlite;
    // Read turns on demand so a large corpus does not live in memory at once.
    const sessions = loadSessions().filter(
      (session) =>
        !filters.sessionId || session.sessionId?.startsWith(filters.sessionId),
    );
    const entriesBySession = { get: (id: string) => loadEntries(id) };
    const runEventsByRun = { get: (id: string) => loadRunEvents(id) };
    return buildTraceInsights({
      sessions,
      entriesBySession,
      runEventsByRun,
      filters,
    });
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
