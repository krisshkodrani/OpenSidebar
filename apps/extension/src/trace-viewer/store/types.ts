import type { StateCreator } from "zustand";
import type { TraceSession, TraceEntry } from "../../types/traces";

// ── Viewer-only types ──────────────────────────────────────────

export interface DayBucket {
  day: string;
  count: number;
}

export interface ModelBucket {
  model: string;
  count: number;
}

export interface SessionLogEntry {
  ts: string;
  lvl: string;
  src: string;
  cat: string;
  msg: string;
  rid?: string;
  sid?: string;
  data?: Record<string, unknown>;
}

export interface TraceFilters {
  outcome: string;
  day: string;
  from: string;
  to: string;
  domain: string;
  mode: string; // "all" | "agent" | "recording" | "manual"
  model: string; // "all" | specific model name
  tier: string; // "all" | "executor" | "planner"
  runId: string; // "" means no filter, otherwise prefix match
}

/** Aggregate stats for a group of sessions sharing the same runId */
export interface RunGroup {
  runId: string;
  shortId: string; // first 8 chars of runId
  sessions: TraceSession[];
  totalTurns: number;
  totalCost: number;
  earliestStart: number;
  latestEnd: number;
  overallOutcome: string;
  query: string;
  expanded: boolean;
}

export interface SavedTraceView {
  id: string;
  name: string;
  filters: TraceFilters;
}

// ── Slice Interfaces ───────────────────────────────────────────

export interface TracesSlice {
  sessions: TraceSession[];
  runGroups: RunGroup[];
  traceListMode: "sessions" | "runs";
  compareSessionIds: string[];
  compareViewActive: boolean;
  savedViews: SavedTraceView[];
  availableDays: DayBucket[];
  availableModels: ModelBucket[];
  filters: TraceFilters;
  currentSessionId: string | null;
  currentEntries: TraceEntry[];
  sessionLogs: SessionLogEntry[];
  sessionLogsLoading: boolean;
  logsWarning: string | null;
  searchQuery: string;
  activeSubview: "turns" | "perception" | "logs" | "story";
  tracesLoading: boolean;
  tracesError: string | null;
  setSessions: (sessions: TraceSession[]) => void;
  setAvailableDays: (days: DayBucket[]) => void;
  setAvailableModels: (models: ModelBucket[]) => void;
  setFilter: (key: keyof TraceFilters, value: string) => void;
  resetFilters: () => void;
  setCurrentSessionId: (id: string | null) => void;
  setCurrentEntries: (entries: TraceEntry[]) => void;
  setSessionLogs: (logs: SessionLogEntry[]) => void;
  setSessionLogsLoading: (loading: boolean) => void;
  setLogsWarning: (warning: string | null) => void;
  setSearchQuery: (query: string) => void;
  setActiveSubview: (view: "turns" | "perception" | "logs" | "story") => void;
  setTraceListMode: (mode: "sessions" | "runs") => void;
  toggleCompareSession: (sessionId: string) => void;
  clearCompareSessions: () => void;
  setCompareViewActive: (active: boolean) => void;
  saveCurrentView: () => void;
  applySavedView: (id: string) => void;
  deleteSavedView: (id: string) => void;
  /** Turn number to scroll to after a tab switch (cleared after scroll completes) */
  focusTurnNumber: number | null;
  /** Switch to Turns tab and scroll to a specific turn */
  navigateToTurn: (turnNumber: number) => void;
  /** Switch to Perception tab and scroll to a specific turn's perception */
  navigateToPerception: (turnNumber: number) => void;
  tableSort: { column: string; direction: "asc" | "desc" };
  setTableSort: (column: string, direction: "asc" | "desc") => void;
  storyCache: Record<string, string>;
  storyLoading: boolean;
  storyError: string | null;
  setStoryCache: (sessionId: string, content: string) => void;
  setStoryLoading: (loading: boolean) => void;
  setStoryError: (error: string | null) => void;
  setTracesLoading: (loading: boolean) => void;
  setTracesError: (error: string | null) => void;
  toggleRunGroup: (runId: string) => void;
  expandAllRunGroups: () => void;
  collapseAllRunGroups: () => void;
}

export type TopLevelView = "traces" | "backend";

// ── Combined Store ─────────────────────────────────────────────

export type Store = TracesSlice & {
  topLevelView: TopLevelView;
  setTopLevelView: (view: TopLevelView) => void;
};

export type SliceCreator<T> = StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  T
>;
