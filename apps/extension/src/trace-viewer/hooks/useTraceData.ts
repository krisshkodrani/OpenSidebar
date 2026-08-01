import { useCallback, useEffect, useMemo, useRef } from "react";
import * as api from "../api";
import { useStore } from "../store";
import { isDefaultTraceWindow } from "../utils";

export function useTraceData() {
  const filters = useStore((s) => s.filters);
  const sessions = useStore((s) => s.sessions);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const activeSubview = useStore((s) => s.activeSubview);
  const sessionsNextCursor = useStore((s) => s.sessionsNextCursor);
  const sessionsHasMore = useStore((s) => s.sessionsHasMore);
  const setSessions = useStore((s) => s.setSessions);
  const appendSessions = useStore((s) => s.appendSessions);
  const setSessionsPage = useStore((s) => s.setSessionsPage);
  const setAvailableDays = useStore((s) => s.setAvailableDays);
  const setAvailableModels = useStore((s) => s.setAvailableModels);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setCurrentRunEvents = useStore((s) => s.setCurrentRunEvents);
  const setSessionLogs = useStore((s) => s.setSessionLogs);
  const setSessionLogsLoading = useStore((s) => s.setSessionLogsLoading);
  const setLogsWarning = useStore((s) => s.setLogsWarning);
  const setTracesLoading = useStore((s) => s.setTracesLoading);
  const setTracesError = useStore((s) => s.setTracesError);
  const detailRequestSeq = useRef(0);
  const didInitLoading = useRef(false);
  const didInitialRefresh = useRef(false);
  // Guards the one-shot auto-relax: if the default 7-day window returns nothing,
  // widen to all-time once so the viewer never opens to a confusing empty list.
  const didAutoRelax = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const logsAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
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
      const [page, daysData, modelsData] = await Promise.all([
        api.fetchTraceSessionsPage(filtersRef.current, { signal }),
        api.fetchTraceDays(signal),
        api.fetchTraceModels(signal),
      ]);
      if (signal.aborted) return;
      let sessionsData = page.items || [];
      if (
        currentSessionId &&
        !sessionsData.some((session) => session.sessionId === currentSessionId)
      ) {
        const linkedSession = await api.fetchTraceSessionSummary(
          currentSessionId,
          signal,
        );
        if (signal.aborted) return;
        if (linkedSession) sessionsData = [linkedSession, ...sessionsData];
      }
      setSessions(sessionsData);
      setSessionsPage(page);
      setAvailableDays(daysData || []);
      setAvailableModels(modelsData || []);

      // First load with the default window empty? Widen to all-time once. The
      // filter change re-triggers refreshSessions through the debounced effect.
      if (
        (sessionsData?.length ?? 0) === 0 &&
        !didAutoRelax.current &&
        isDefaultTraceWindow(filtersRef.current)
      ) {
        didAutoRelax.current = true;
        useStore.getState().setFilter("from", "");
        return;
      }

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
    setSessionsPage,
    setTracesError,
    setTracesLoading,
  ]);

  const loadMoreSessions = useCallback(async () => {
    if (!sessionsHasMore || !sessionsNextCursor) return;
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    try {
      const page = await api.fetchTraceSessionsPage(filtersRef.current, {
        cursor: sessionsNextCursor,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      appendSessions(page.items || []);
      setSessionsPage(page);
    } catch (err) {
      if (!controller.signal.aborted) setTracesError(String(err));
    }
  }, [
    appendSessions,
    sessionsHasMore,
    sessionsNextCursor,
    setSessionsPage,
    setTracesError,
  ]);

  // Debounce filter changes: refresh sessions 200ms after last filter change
  useEffect(() => {
    if (!didInitialRefresh.current) {
      didInitialRefresh.current = true;
      refreshSessions();
      // Load the fleet-wide adjudication verdicts once so table rows can badge
      // reviewed/unreviewed and the Attention inbox knows what's outstanding.
      void useStore.getState().loadAnnotations();
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
      logsAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
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
    ])
      .then(([entries, runEvents]) => {
        if (
          signal.aborted ||
          detailRequestSeq.current !== requestId ||
          useStore.getState().currentSessionId !== currentSessionId
        ) {
          return;
        }
        setCurrentEntries(entries || []);
        setCurrentRunEvents(runEvents || []);
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

  useEffect(() => {
    if (!currentSessionId || activeSubview !== "logs") return;
    logsAbortRef.current?.abort();
    const controller = new AbortController();
    logsAbortRef.current = controller;
    setSessionLogsLoading(true);
    setLogsWarning(null);
    api
      .fetchSessionLogs(currentSessionId, undefined, controller.signal)
      .then((logs) => {
        if (!controller.signal.aborted) setSessionLogs(logs || []);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setLogsWarning(`Failed to load logs: ${err}`);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSessionLogsLoading(false);
      });
    return () => {
      controller.abort();
      setSessionLogsLoading(false);
    };
  }, [
    activeSubview,
    currentSessionId,
    setLogsWarning,
    setSessionLogs,
    setSessionLogsLoading,
  ]);

  return {
    sessions,
    currentSessionId,
    refreshSessions,
    loadMoreSessions,
  };
}
