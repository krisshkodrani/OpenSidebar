import type {
  SliceCreator,
  TracesSlice,
  TraceFilters,
  RunGroup,
  ScrollPositions,
} from "./types";
import type { TraceSession } from "../../types/traces";
import { defaultTraceFilters } from "../utils";

const MAX_SCROLL_POSITIONS = 100;

const DEFAULT_FILTERS: TraceFilters = defaultTraceFilters();

const OUTCOME_PRIORITY: Record<string, number> = {
  completed: 0,
  stopped: 1,
  max_turns: 2,
  error: 3,
};

function computeRunGroups(sessions: TraceSession[]): RunGroup[] {
  const byRun = new Map<string, TraceSession[]>();

  for (const s of sessions) {
    const rid = s.runId;
    if (typeof rid === "string" && rid.length > 0) {
      let list = byRun.get(rid);
      if (!list) {
        list = [];
        byRun.set(rid, list);
      }
      list.push(s);
    }
  }

  const groups: RunGroup[] = [];
  for (const [runId, runSessions] of byRun) {
    runSessions.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));

    let totalTurns = 0;
    let totalCost = 0;
    let earliestStart = Infinity;
    let latestEnd = -Infinity;
    let worstOutcome = "completed";

    for (const s of runSessions) {
      totalTurns += s.turnCount || 0;
      totalCost += s.metrics?.totalCost ?? 0;
      if (s.startTime < earliestStart) earliestStart = s.startTime;
      if (s.endTime > latestEnd) latestEnd = s.endTime;
      if (
        (OUTCOME_PRIORITY[s.outcome] ?? 0) >
        (OUTCOME_PRIORITY[worstOutcome] ?? 0)
      ) {
        worstOutcome = s.outcome;
      }
    }

    const firstQuery = runSessions[0]?.query ?? "";

    groups.push({
      runId,
      shortId: runId.slice(0, 8),
      sessions: runSessions,
      totalTurns,
      totalCost,
      earliestStart,
      latestEnd,
      overallOutcome: worstOutcome,
      query: firstQuery,
      expanded: runSessions.length === 1,
    });
  }

  groups.sort((a, b) => b.earliestStart - a.earliestStart);
  return groups;
}

export const createTracesSlice: SliceCreator<TracesSlice> = (set) => ({
  sessions: [],
  runGroups: [],
  activeTopLevelView: "sessions",
  traceListMode: "sessions",
  availableDays: [],
  availableModels: [],
  filters: { ...DEFAULT_FILTERS },
  currentSessionId: null,
  currentEntries: [],
  currentRunEvents: [],
  sessionLogs: [],
  sessionLogsLoading: false,
  logsWarning: null,
  searchQuery: "",
  activeSubview: "story" as const,
  scrollPositions: {} as ScrollPositions,
  scrollPositionOrder: [],
  saveScrollPosition: (view, position) =>
    set((s) => {
      const key = s.currentSessionId ? `${s.currentSessionId}:${view}` : view;
      s.scrollPositions[key] = position;
      const existingIndex = s.scrollPositionOrder.indexOf(key);
      if (existingIndex >= 0) {
        s.scrollPositionOrder.splice(existingIndex, 1);
      }
      s.scrollPositionOrder.push(key);
      while (s.scrollPositionOrder.length > MAX_SCROLL_POSITIONS) {
        const oldestKey = s.scrollPositionOrder.shift();
        if (oldestKey) delete s.scrollPositions[oldestKey];
      }
    }),
  tracesLoading: false,
  tracesError: null,
  tableSort: { column: "startTime", direction: "desc" },
  setTableSort: (column, direction) =>
    set((s) => {
      s.tableSort = { column, direction };
    }),

  setSessions: (sessions) =>
    set((s) => {
      s.sessions = sessions;
      // Preserve expanded state from previous groups
      const prevExpanded = new Set(
        s.runGroups.filter((g) => g.expanded).map((g) => g.runId),
      );
      const groups = computeRunGroups(sessions);
      for (const g of groups) {
        if (prevExpanded.has(g.runId)) g.expanded = true;
      }
      s.runGroups = groups;
      if (
        s.traceListMode === "runs" &&
        groups.length === 0 &&
        sessions.length > 0
      ) {
        s.traceListMode = "sessions";
      }
    }),
  setAvailableDays: (days) =>
    set((s) => {
      s.availableDays = days;
    }),
  setAvailableModels: (models) =>
    set((s) => {
      s.availableModels = models;
    }),
  setFilter: (key, value) =>
    set((s) => {
      s.filters[key] = value;
    }),
  resetFilters: () =>
    set((s) => {
      // Recompute the window fresh so a long-open viewer resets to "today",
      // not the day it was first loaded.
      s.filters = defaultTraceFilters();
    }),
  setCurrentSessionId: (id) =>
    set((s) => {
      if (s.currentSessionId !== id) {
        s.focusTurnRequest = null;
        s.focusTurnNumber = null;
      }
      s.currentSessionId = id;
    }),
  setCurrentEntries: (entries) =>
    set((s) => {
      s.currentEntries = entries;
    }),
  setCurrentRunEvents: (events) =>
    set((s) => {
      s.currentRunEvents = events;
    }),
  setSessionLogs: (logs) =>
    set((s) => {
      s.sessionLogs = logs;
    }),
  setSessionLogsLoading: (loading) =>
    set((s) => {
      s.sessionLogsLoading = loading;
    }),
  setLogsWarning: (warning) =>
    set((s) => {
      s.logsWarning = warning;
    }),
  setSearchQuery: (query) =>
    set((s) => {
      s.searchQuery = query;
    }),
  setActiveTopLevelView: (view) =>
    set((s) => {
      s.activeTopLevelView = view;
    }),
  setActiveSubview: (view) =>
    set((s) => {
      s.activeSubview = view;
    }),
  setTraceListMode: (mode) =>
    set((s) => {
      s.traceListMode = mode;
    }),
  focusTurnNumber: null,
  focusTurnRequest: null,
  nextFocusRequestId: 0,
  clearFocusTurnRequest: (requestId) =>
    set((s) => {
      if (
        requestId == null ||
        !s.focusTurnRequest ||
        s.focusTurnRequest.id === requestId
      ) {
        s.focusTurnRequest = null;
        s.focusTurnNumber = null;
      }
    }),
  navigateToTurn: (turnNumber) =>
    set((s) => {
      s.activeSubview = "turns";
      s.nextFocusRequestId += 1;
      s.focusTurnRequest = {
        id: s.nextFocusRequestId,
        turnNumber,
      };
      s.focusTurnNumber = turnNumber;
    }),
  navigateToPerception: (turnNumber) =>
    set((s) => {
      s.activeSubview = "perception";
      s.nextFocusRequestId += 1;
      s.focusTurnRequest = {
        id: s.nextFocusRequestId,
        turnNumber,
      };
      s.focusTurnNumber = turnNumber;
    }),
  setTracesLoading: (loading) =>
    set((s) => {
      s.tracesLoading = loading;
    }),
  setTracesError: (error) =>
    set((s) => {
      s.tracesError = error;
    }),
  toggleRunGroup: (runId) =>
    set((s) => {
      const group = s.runGroups.find((g) => g.runId === runId);
      if (group) group.expanded = !group.expanded;
    }),
  expandAllRunGroups: () =>
    set((s) => {
      for (const g of s.runGroups) g.expanded = true;
    }),
  collapseAllRunGroups: () =>
    set((s) => {
      for (const g of s.runGroups) g.expanded = false;
    }),

  viewerTheme: "system" as const,
  setViewerTheme: (theme) =>
    set((s) => {
      s.viewerTheme = theme;
    }),
});
