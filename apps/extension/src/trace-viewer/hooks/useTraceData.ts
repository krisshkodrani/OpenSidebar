import { useCallback, useEffect, useMemo, useRef } from "react";
import * as api from "../api";
import { useStore } from "../store";

export function useTraceData() {
  const filters = useStore((s) => s.filters);
  const sessions = useStore((s) => s.sessions);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const setSessions = useStore((s) => s.setSessions);
  const setAvailableDays = useStore((s) => s.setAvailableDays);
  const setAvailableModels = useStore((s) => s.setAvailableModels);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setCurrentRunEvents = useStore((s) => s.setCurrentRunEvents);
  const setSessionLogs = useStore((s) => s.setSessionLogs);
  const setLogsWarning = useStore((s) => s.setLogsWarning);
  const setTracesLoading = useStore((s) => s.setTracesLoading);
  const setTracesError = useStore((s) => s.setTracesError);
  const detailRequestSeq = useRef(0);
  const didInitLoading = useRef(false);
  const didInitialRefresh = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef(filters);

  // The selected session's runId, derived separately so the detail-loading
  // effect can depend on it instead of the whole sessions array. A plain
  // session-list refresh that does not change the open trace's runId will not
  // blank-and-refetch the open trace.
  const currentRunId = useMemo(() => {
    const session = sessions.find((s) => s.sessionId === currentSessionId);
    return typeof session?.runId === "string" && session.runId.length > 0
      ? session.runId
      : null;
  }, [sessions, currentSessionId]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  // Set loading true on first render to avoid flash of "no sessions"
  if (!didInitLoading.current) {
    didInitLoading.current = true;
    setTracesLoading(true);
  }

  const refreshSessions = useCallback(async () => {
    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setTracesLoading(true);
    setTracesError(null);
    try {
      const [sessionsData, daysData, modelsData] = await Promise.all([
        api.fetchTraceSessions(filtersRef.current, signal),
        api.fetchTraceDays(signal),
        api.fetchTraceModels(signal),
      ]);
      if (signal.aborted) return;
      setSessions(sessionsData || []);
      setAvailableDays(daysData || []);
      setAvailableModels(modelsData || []);

      if (currentSessionId) {
        const stillExists = (sessionsData || []).some(
          (session) => session.sessionId === currentSessionId,
        );
        if (!stillExists) {
          useStore.getState().setCurrentSessionId(null);
          setCurrentEntries([]);
          setCurrentRunEvents([]);
          setSessionLogs([]);
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      setTracesError(String(err));
    } finally {
      if (!signal.aborted) {
        setTracesLoading(false);
      }
    }
  }, [
    currentSessionId,
    setAvailableDays,
    setAvailableModels,
    setCurrentEntries,
    setCurrentRunEvents,
    setSessionLogs,
    setSessions,
    setTracesError,
    setTracesLoading,
  ]);

  // Debounce filter changes: refresh sessions 200ms after last filter change
  useEffect(() => {
    if (!didInitialRefresh.current) {
      didInitialRefresh.current = true;
      refreshSessions();
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refreshSessions();
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, refreshSessions]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      detailAbortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!currentSessionId) return;
    const requestId = detailRequestSeq.current + 1;
    detailRequestSeq.current = requestId;
    detailAbortRef.current?.abort();
    const detailAbort = new AbortController();
    detailAbortRef.current = detailAbort;
    const { signal } = detailAbort;

    setLogsWarning(null);
    setCurrentEntries([]);
    setCurrentRunEvents([]);
    setSessionLogs([]);
    const runId = currentRunId;
    Promise.all([
      api.fetchTraceEntries(currentSessionId, signal),
      runId
        ? api.fetchRunTraceEvents(runId, signal).catch(() => [])
        : Promise.resolve([]),
      api.fetchSessionLogs(currentSessionId, undefined, signal).catch((err) => {
        if (
          signal.aborted ||
          detailRequestSeq.current !== requestId ||
          useStore.getState().currentSessionId !== currentSessionId
        ) {
          return [] as never[];
        }
        setLogsWarning(`Failed to load logs: ${err}`);
        return [] as never[];
      }),
    ])
      .then(([entries, runEvents, logs]) => {
        if (
          signal.aborted ||
          detailRequestSeq.current !== requestId ||
          useStore.getState().currentSessionId !== currentSessionId
        ) {
          return;
        }
        setCurrentEntries(entries || []);
        setCurrentRunEvents(runEvents || []);
        setSessionLogs(logs || []);
      })
      .catch((err) => {
        if (
          signal.aborted ||
          detailRequestSeq.current !== requestId ||
          useStore.getState().currentSessionId !== currentSessionId
        ) {
          return;
        }
        setTracesError(`Failed to load turns: ${err}`);
      });

    return () => {
      detailAbort.abort();
    };
  }, [
    currentSessionId,
    currentRunId,
    setCurrentEntries,
    setCurrentRunEvents,
    setLogsWarning,
    setSessionLogs,
    setTracesError,
  ]);

  return {
    sessions,
    currentSessionId,
    refreshSessions,
  };
}
