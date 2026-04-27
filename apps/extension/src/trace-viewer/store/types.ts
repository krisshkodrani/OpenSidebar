import type { StateCreator } from "zustand";
import type { TraceSession, TraceEntry } from "../../types/traces";
import type { RunTraceEvent } from "../../utils/run-trace";

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

// ── Slice Interfaces ───────────────────────────────────────────

export interface TracesSlice {
  sessions: TraceSession[];
  runGroups: RunGroup[];
  traceListMode: "sessions" | "runs";
  availableDays: DayBucket[];
  availableModels: ModelBucket[];
  filters: TraceFilters;
  currentSessionId: string | null;
  currentEntries: TraceEntry[];
  currentRunEvents: RunTraceEvent[];
  sessionLogs: SessionLogEntry[];
  sessionLogsLoading: boolean;
  logsWarning: string | null;
  searchQuery: string;
  activeSubview: Subview;
  setActiveSubview: (view: Subview) => void;
  scrollPositions: ScrollPositions;
  saveScrollPosition: (view: Subview, position: number) => void;
  tracesLoading: boolean;
  tracesError: string | null;
  setSessions: (sessions: TraceSession[]) => void;
  setAvailableDays: (days: DayBucket[]) => void;
  setAvailableModels: (models: ModelBucket[]) => void;
  setFilter: (key: keyof TraceFilters, value: string) => void;
  resetFilters: () => void;
  setCurrentSessionId: (id: string | null) => void;
  setCurrentEntries: (entries: TraceEntry[]) => void;
  setCurrentRunEvents: (events: RunTraceEvent[]) => void;
  setSessionLogs: (logs: SessionLogEntry[]) => void;
  setSessionLogsLoading: (loading: boolean) => void;
  setLogsWarning: (warning: string | null) => void;
  setSearchQuery: (query: string) => void;
  setTraceListMode: (mode: "sessions" | "runs") => void;
  /** Turn number to scroll to after a tab switch (cleared after scroll completes) */
  focusTurnNumber: number | null;
  /** Switch to Turns tab and scroll to a specific turn */
  navigateToTurn: (turnNumber: number) => void;
  /** Switch to Perception tab and scroll to a specific turn's perception */
  navigateToPerception: (turnNumber: number) => void;
  tableSort: { column: string; direction: "asc" | "desc" };
  setTableSort: (column: string, direction: "asc" | "desc") => void;
  setTracesLoading: (loading: boolean) => void;
  setTracesError: (error: string | null) => void;
  toggleRunGroup: (runId: string) => void;
  expandAllRunGroups: () => void;
  collapseAllRunGroups: () => void;
}

export type Subview =
  | "overview"
  | "plan"
  | "turns"
  | "perception"
  | "prompts"
  | "skills"
  | "logs";

export interface ScrollPositions {
  overview: number;
  plan: number;
  turns: number;
  perception: number;
  prompts: number;
  skills: number;
  logs: number;
}

// ── Combined Store ─────────────────────────────────────────────

export type Store = TracesSlice;

export type SliceCreator<T> = StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  T
>;
