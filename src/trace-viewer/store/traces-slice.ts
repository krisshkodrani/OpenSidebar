import type { SliceCreator, TracesSlice, TraceFilters } from "./types";

const DEFAULT_FILTERS: TraceFilters = {
  outcome: "all",
  day: "all",
  from: "",
  to: "",
  domain: "",
  sessionPrefix: "",
};

export const createTracesSlice: SliceCreator<TracesSlice> = (set) => ({
  sessions: [],
  availableDays: [],
  filters: { ...DEFAULT_FILTERS },
  currentSessionId: null,
  currentEntries: [],
  sessionLogs: [],
  sessionLogsLoading: false,
  searchQuery: "",
  activeSubview: "turns",
  tracesLoading: false,
  tracesError: null,
  storyCache: {},
  storyLoading: false,
  storyError: null,

  setSessions: (sessions) => set((s) => { s.sessions = sessions; }),
  setAvailableDays: (days) => set((s) => { s.availableDays = days; }),
  setFilter: (key, value) => set((s) => { s.filters[key] = value; }),
  resetFilters: () => set((s) => { s.filters = { ...DEFAULT_FILTERS }; }),
  setCurrentSessionId: (id) => set((s) => { s.currentSessionId = id; }),
  setCurrentEntries: (entries) => set((s) => { s.currentEntries = entries; }),
  setSessionLogs: (logs) => set((s) => { s.sessionLogs = logs; }),
  setSessionLogsLoading: (loading) => set((s) => { s.sessionLogsLoading = loading; }),
  setSearchQuery: (query) => set((s) => { s.searchQuery = query; }),
  setActiveSubview: (view) => set((s) => { s.activeSubview = view; }),
  setTracesLoading: (loading) => set((s) => { s.tracesLoading = loading; }),
  setTracesError: (error) => set((s) => { s.tracesError = error; }),
  setStoryCache: (sessionId, content) => set((s) => { s.storyCache[sessionId] = content; }),
  setStoryLoading: (loading) => set((s) => { s.storyLoading = loading; }),
  setStoryError: (error) => set((s) => { s.storyError = error; }),
});
