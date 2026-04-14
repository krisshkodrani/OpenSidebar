import type { SliceCreator, TracesSlice, TraceFilters, RunGroup } from "./types";
import type { TraceSession } from "../../types/traces";
import { isoDayOffset } from "../utils";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DEFAULT_FILTERS: TraceFilters = {
  outcome: "all",
  day: "all",
  from: isoDayOffset(6),
  to: todayIso(),
  domain: "",
  mode: "all",
  model: "all",
  tier: "all",
  runId: "",
};

const OUTCOME_PRIORITY: Record<string, number> = {
  completed: 0,
  stopped: 1,
  max_turns: 2,
  error: 3,
};

function computeRunGroups(sessions: TraceSession[]): RunGroup[] {
  const byRun = new Map<string, TraceSession[]>();

  for (const s of sessions) {
    const rid = (s as any).runId;
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
  availableDays: [],
  availableModels: [],
  filters: { ...DEFAULT_FILTERS },
  currentSessionId: null,
  currentEntries: [],
  sessionLogs: [],
  sessionLogsLoading: false,
  logsWarning: null,
  searchQuery: "",
  activeSubview: "turns",
  tracesLoading: false,
  tracesError: null,
  tableSort: { column: "startTime", direction: "desc" },
  setTableSort: (column, direction) =>
    set((s) => {
      s.tableSort = { column, direction };
    }),
  storyCache: {},
  storyLoading: false,
  storyError: null,

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
      s.filters = { ...DEFAULT_FILTERS, from: isoDayOffset(6), to: todayIso() };
    }),
  setCurrentSessionId: (id) =>
    set((s) => {
      s.currentSessionId = id;
    }),
  setCurrentEntries: (entries) =>
    set((s) => {
      s.currentEntries = entries;
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
  setActiveSubview: (view) =>
    set((s) => {
      s.activeSubview = view;
    }),
  focusTurnNumber: null,
  navigateToTurn: (turnNumber) =>
    set((s) => {
      s.activeSubview = "turns";
      s.focusTurnNumber = turnNumber;
    }),
  navigateToPerception: (turnNumber) =>
    set((s) => {
      s.activeSubview = "perception";
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
  setStoryCache: (sessionId, content) =>
    set((s) => {
      s.storyCache[sessionId] = content;
    }),
  setStoryLoading: (loading) =>
    set((s) => {
      s.storyLoading = loading;
    }),
  setStoryError: (error) =>
    set((s) => {
      s.storyError = error;
    }),
});
