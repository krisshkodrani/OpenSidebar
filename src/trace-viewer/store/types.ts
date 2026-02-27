import type { StateCreator } from "zustand";

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
  sessionPrefix: string;
  mode: string;   // "all" | "agent" | "recording" | "manual"
  model: string;  // "all" | specific model name
}

// ── Slice Interfaces ───────────────────────────────────────────

export interface TracesSlice {
  sessions: Record<string, unknown>[];
  availableDays: DayBucket[];
  availableModels: ModelBucket[];
  filters: TraceFilters;
  currentSessionId: string | null;
  currentEntries: Record<string, unknown>[];
  sessionLogs: SessionLogEntry[];
  sessionLogsLoading: boolean;
  searchQuery: string;
  activeSubview: "turns" | "perception" | "logs" | "story";
  tracesLoading: boolean;
  tracesError: string | null;
  setSessions: (sessions: Record<string, unknown>[]) => void;
  setAvailableDays: (days: DayBucket[]) => void;
  setAvailableModels: (models: ModelBucket[]) => void;
  setFilter: (key: keyof TraceFilters, value: string) => void;
  resetFilters: () => void;
  setCurrentSessionId: (id: string | null) => void;
  setCurrentEntries: (entries: Record<string, unknown>[]) => void;
  setSessionLogs: (logs: SessionLogEntry[]) => void;
  setSessionLogsLoading: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
  setActiveSubview: (view: "turns" | "perception" | "logs" | "story") => void;
  storyCache: Record<string, string>;
  storyLoading: boolean;
  storyError: string | null;
  setStoryCache: (sessionId: string, content: string) => void;
  setStoryLoading: (loading: boolean) => void;
  setStoryError: (error: string | null) => void;
  setTracesLoading: (loading: boolean) => void;
  setTracesError: (error: string | null) => void;
}

export interface UiSlice {
  activeTab: "traces";
  tabInitialized: Record<string, boolean>;
  setActiveTab: (tab: "traces") => void;
  markTabInitialized: (tab: string) => void;
}

// ── Combined Store ─────────────────────────────────────────────

export type Store = TracesSlice & UiSlice;

export type SliceCreator<T> = StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  T
>;
