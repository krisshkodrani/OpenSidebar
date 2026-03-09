import type { SliceCreator, TracesSlice, TraceFilters } from "./types";
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
};

export const createTracesSlice: SliceCreator<TracesSlice> = (set) => ({
  sessions: [],
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
  storyCache: {},
  storyLoading: false,
  storyError: null,

  setSessions: (sessions) =>
    set((s) => {
      s.sessions = sessions;
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
  setTracesLoading: (loading) =>
    set((s) => {
      s.tracesLoading = loading;
    }),
  setTracesError: (error) =>
    set((s) => {
      s.tracesError = error;
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
