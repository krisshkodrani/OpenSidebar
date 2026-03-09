import React, { useEffect, useCallback, useRef } from "react";
import { useStore } from "../../store";
import * as api from "../../api";
import PanelLayout from "../PanelLayout";
import EmptyState from "../EmptyState";
import ErrorBanner from "../ErrorBanner";
import LoadingSpinner from "../LoadingSpinner";
import TraceFilterPanel from "./TraceFilterPanel";
import TraceSessionList from "./TraceSessionList";
import TraceDetailHeader from "./TraceDetailHeader";
import TraceSubviewToggle from "./TraceSubviewToggle";
import TurnSearchBar from "./TurnSearchBar";
import TurnList from "./TurnList";
import TurnTimeline from "./TurnTimeline";
import PerceptionList from "./PerceptionList";
import LogList from "./LogList";
import StoryPanel from "./StoryPanel";
import CostDashboard from "./CostDashboard";

export default function TracesTab() {
  const sessions = useStore((s) => s.sessions);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const currentEntries = useStore((s) => s.currentEntries);
  const activeSubview = useStore((s) => s.activeSubview);
  const tracesError = useStore((s) => s.tracesError);
  const logsWarning = useStore((s) => s.logsWarning);
  const setSessions = useStore((s) => s.setSessions);
  const setAvailableDays = useStore((s) => s.setAvailableDays);
  const setAvailableModels = useStore((s) => s.setAvailableModels);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setSessionLogs = useStore((s) => s.setSessionLogs);
  const setLogsWarning = useStore((s) => s.setLogsWarning);
  const setTracesLoading = useStore((s) => s.setTracesLoading);
  const setTracesError = useStore((s) => s.setTracesError);
  const filters = useStore((s) => s.filters);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);

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

      // Check if current session still exists
      if (currentSessionId) {
        const stillExists = (sessionsData || []).some(
          (s) => s.sessionId === currentSessionId,
        );
        if (!stillExists) {
          setCurrentSessionId(null);
          setCurrentEntries([]);
          setSessionLogs([]);
        }
      }
    } catch (err) {
      setTracesError(String(err));
    } finally {
      setTracesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, currentSessionId]);

  // Initial load
  useEffect(() => {
    refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load entries and logs when session changes
  useEffect(() => {
    if (!currentSessionId) return;
    if (entriesLoading.current) return;
    entriesLoading.current = true;

    // Fetch trace entries and session logs in parallel
    setLogsWarning(null);
    Promise.all([
      api.fetchTraceEntries(currentSessionId),
      api.fetchSessionLogs(currentSessionId).catch((err) => {
        setLogsWarning(`Failed to load logs: ${err}`);
        return [] as never[];
      }),
    ])
      .then(([entries, logs]) => {
        setCurrentEntries(entries || []);
        setSessionLogs(logs || []);
      })
      .catch((err) => {
        setTracesError(`Failed to load turns: ${err}`);
      })
      .finally(() => {
        entriesLoading.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  const currentSession = sessions.find(
    (s) => s.sessionId === currentSessionId,
  );

  return (
    <PanelLayout
      left={
        <>
          <TraceFilterPanel onFiltersChanged={refreshSessions} />
          <div className="border-b border-trace-border" />
          {tracesError ? (
            <ErrorBanner
              message={`Failed to load sessions: ${tracesError}`}
              hint
              onRetry={refreshSessions}
            />
          ) : (
            <>
              <CostDashboard sessions={sessions} />
              <TraceSessionList />
            </>
          )}
        </>
      }
      right={
        currentSessionId && currentSession ? (
          <>
            <TraceDetailHeader session={currentSession} />
            <TraceSubviewToggle />
            {activeSubview === "turns" ? (
              <>
                <TurnSearchBar />
                {currentEntries.length === 0 && !tracesError ? (
                  <div className="flex-1 px-5 py-4">
                    <LoadingSpinner message="Loading turns..." />
                  </div>
                ) : (
                  <div className="flex-1 overflow-hidden flex flex-col px-5 py-4">
                    <TurnTimeline entries={currentEntries} />
                    <div className="flex-1 min-h-0">
                      <TurnList />
                    </div>
                  </div>
                )}
              </>
            ) : activeSubview === "perception" ? (
              <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
                <PerceptionList />
              </div>
            ) : activeSubview === "story" ? (
              <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
                <StoryPanel />
              </div>
            ) : (
              <div className="flex-1 overflow-hidden flex flex-col">
                {logsWarning && (
                  <div className="px-5 pt-3">
                    <div className="text-xs text-yellow-400/80 bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
                      {logsWarning}
                    </div>
                  </div>
                )}
                <LogList />
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="&#9776;" message="Select a session to view turns" />
        )
      }
    />
  );
}
