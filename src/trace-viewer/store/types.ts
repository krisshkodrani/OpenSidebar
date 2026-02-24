import type { StateCreator } from "zustand";

// ── Viewer-only types ──────────────────────────────────────────

export interface DayBucket {
  day: string;
  count: number;
}

export interface CategoryBucket {
  name: string;
  count: number;
}

export interface SkillRecord {
  id: string;
  name: string;
  sourceQuery: string;
  enabled: boolean;
  pinned: boolean;
  uses: number;
  successfulRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  avgTokens: number;
  consecutiveReplayFailures: number;
  createdAt: number;
  updatedAt: number;
  matchTokens: string[];
  steps: SkillStep[];
  [key: string]: unknown;
}

export interface SkillStep {
  objective: string;
  successCriteria: string;
  allowedTools: string[];
  assumptions: string[];
}

export interface MemoryRecord {
  id: string;
  content: string;
  category: string;
  type: string;
  sourceUrl: string;
  createdAt: number;
  [key: string]: unknown;
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
}

// ── Slice Interfaces ───────────────────────────────────────────

export interface TracesSlice {
  sessions: Record<string, unknown>[];
  availableDays: DayBucket[];
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

export interface SkillsSlice {
  skills: SkillRecord[];
  currentSkillId: string | null;
  skillSearchQuery: string;
  skillStatusFilter: string;
  skillsLoading: boolean;
  setSkills: (skills: SkillRecord[]) => void;
  setCurrentSkillId: (id: string | null) => void;
  setSkillSearchQuery: (query: string) => void;
  setSkillStatusFilter: (filter: string) => void;
  setSkillsLoading: (loading: boolean) => void;
  updateSkillLocal: (id: string, updates: Partial<SkillRecord>) => void;
  removeSkillLocal: (id: string) => void;
}

export interface MemorySlice {
  memoryEntries: MemoryRecord[];
  memoryCategories: CategoryBucket[];
  currentMemoryEntryId: string | null;
  memorySearchQuery: string;
  memoryCategoryFilter: string;
  memoryLoading: boolean;
  setMemoryEntries: (entries: MemoryRecord[]) => void;
  setMemoryCategories: (categories: CategoryBucket[]) => void;
  setCurrentMemoryEntryId: (id: string | null) => void;
  setMemorySearchQuery: (query: string) => void;
  setMemoryCategoryFilter: (filter: string) => void;
  setMemoryLoading: (loading: boolean) => void;
  removeMemoryEntryLocal: (id: string) => void;
}

export interface UiSlice {
  activeTab: "traces" | "skills" | "memory";
  tabInitialized: Record<string, boolean>;
  setActiveTab: (tab: "traces" | "skills" | "memory") => void;
  markTabInitialized: (tab: string) => void;
}

// ── Combined Store ─────────────────────────────────────────────

export type Store = TracesSlice & SkillsSlice & MemorySlice & UiSlice;

export type SliceCreator<T> = StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  T
>;
