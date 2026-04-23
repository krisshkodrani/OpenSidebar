import { useCallback, useEffect, useRef } from "react";
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
  const entriesLoading = useRef(false);

  const refreshSessions = useCallback(async () => {
    setTracesLoading(true);
    setTracesError(null);
    try {
      const [sessionsData, daysData, modelsData] = await Promise.all([
        api.fetchTraceSessions(filters),
        api.fetchTraceDays(),
        api.fetchTraceModels(),
      ]);
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
      setTracesError(String(err));
    } finally {
      setTracesLoading(false);
    }
  }, [
    currentSessionId,
    filters,
    setAvailableDays,
    setAvailableModels,
    setCurrentEntries,
    setCurrentRunEvents,
    setSessionLogs,
    setSessions,
    setTracesError,
    setTracesLoading,
  ]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!currentSessionId) return;
    if (entriesLoading.current) return;
    entriesLoading.current = true;

    setLogsWarning(null);
    const currentSession = sessions.find(
      (session) => session.sessionId === currentSessionId,
    );
    const runId =
      typeof currentSession?.runId === "string" && currentSession.runId.length > 0
        ? currentSession.runId
        : null;
    Promise.all([
      api.fetchTraceEntries(currentSessionId),
      runId ? api.fetchRunTraceEvents(runId).catch(() => []) : Promise.resolve([]),
      api.fetchSessionLogs(currentSessionId).catch((err) => {
        setLogsWarning(`Failed to load logs: ${err}`);
        return [] as never[];
      }),
    ])
      .then(([entries, runEvents, logs]) => {
        setCurrentEntries(entries || []);
        setCurrentRunEvents(runEvents || []);
        setSessionLogs(logs || []);
      })
      .catch((err) => {
        setTracesError(`Failed to load turns: ${err}`);
      })
      .finally(() => {
        entriesLoading.current = false;
      });
  }, [
    currentSessionId,
    sessions,
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
