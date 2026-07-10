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
  model: string; // "all" | specific model name
  skill: string; // "all" | specific skill ID
  runId: string; // "" means no filter, otherwise prefix match
  /** Client-side human-adjudication filter: all | unreviewed | reviewed | disagreed */
  adjudication: string;
}

// ── Human adjudication ─────────────────────────────────────────

export type AnnotationVerdict = "agree" | "disagree" | "unsure";

/** A human's verdict on a run's outcome (mirrors the server record). */
export interface RunAnnotation {
  id: string;
  sessionId: string;
  runId?: string;
  annotatedAt: string;
  annotator?: string;
  verdict: AnnotationVerdict;
  correctedOutcome?: string;
  note?: string;
  criteriaOverrides?: Array<{
    nodeId: string;
    criterionId: string;
    pass: boolean;
    note?: string;
  }>;
  computed?: {
    outcome?: string;
    trajectoryVerdict?: string;
    judgeDecision?: string;
    judgeConfidence?: number;
  };
  exported?: { goldenFile?: string; fixtureDownloaded?: boolean };
}

/** The dedup key for an annotation: its run when present, else its session. */
export function annotationKeyFor(a: {
  runId?: string;
  sessionId?: string;
}): string {
  return a.runId && a.runId.length > 0
    ? `run:${a.runId}`
    : `session:${a.sessionId ?? ""}`;
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

export interface FocusTurnRequest {
  id: number;
  turnNumber: number;
}

// ── Slice Interfaces ───────────────────────────────────────────

export interface TracesSlice {
  sessions: TraceSession[];
  runGroups: RunGroup[];
  activeTopLevelView: TopLevelView;
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
  scrollPositionOrder: string[];
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
  setActiveTopLevelView: (view: TopLevelView) => void;
  setTraceListMode: (mode: "sessions" | "runs") => void;
  /** Turn number to scroll to after a tab switch (cleared after scroll completes) */
  focusTurnNumber: number | null;
  focusTurnRequest: FocusTurnRequest | null;
  nextFocusRequestId: number;
  clearFocusTurnRequest: (requestId?: number) => void;
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
  /** Viewer theme: light | dark | system */
  viewerTheme: "light" | "dark" | "system";
  setViewerTheme: (theme: "light" | "dark" | "system") => void;
}

export type Subview =
  | "story"
  | "overview"
  | "plan"
  | "turns"
  | "trajectory"
  | "perception"
  | "prompts"
  | "skills"
  | "logs";

export type TopLevelView = "sessions" | "runs" | "insights" | "metrics";

export interface ScrollPositions {
  [key: string]: number;
}

export interface NewAnnotationInput {
  sessionId: string;
  runId?: string;
  annotator?: string;
  verdict: AnnotationVerdict;
  correctedOutcome?: string;
  note?: string;
  criteriaOverrides?: RunAnnotation["criteriaOverrides"];
  computed?: RunAnnotation["computed"];
}

export interface AnnotationsSlice {
  /** Latest annotation per run/session, keyed by annotationKeyFor(). */
  annotations: Record<string, RunAnnotation>;
  annotationsLoading: boolean;
  annotationsError: string | null;
  loadAnnotations: () => Promise<void>;
  /** Persist a verdict; on success updates the map and returns the record. */
  submitAnnotation: (input: NewAnnotationInput) => Promise<RunAnnotation | null>;
  /** Mark an annotation exported (after a golden/fixture export succeeds). */
  markAnnotationExported: (
    key: string,
    exported: RunAnnotation["exported"],
  ) => void;
}

// ── Combined Store ─────────────────────────────────────────────

export type Store = TracesSlice & AnnotationsSlice;

export type SliceCreator<T> = StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  T
>;
