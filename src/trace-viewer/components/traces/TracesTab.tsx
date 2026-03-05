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
  const setSessions = useStore((s) => s.setSessions);
  const setAvailableDays = useStore((s) => s.setAvailableDays);
  const setAvailableModels = useStore((s) => s.setAvailableModels);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setSessionLogs = useStore((s) => s.setSessionLogs);
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
    Promise.all([
      api.fetchTraceEntries(currentSessionId),
      api.fetchSessionLogs(currentSessionId).catch(() => []),
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
          {tracesError ? (
            <ErrorBanner
              message={`Failed to load sessions: ${tracesError}`}
              hint
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
                <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
                  {currentEntries.length === 0 && !tracesError ? (
                    <LoadingSpinner message="Loading turns..." />
                  ) : (
                    <>
                      <TurnTimeline entries={currentEntries} />
                      <TurnList />
                    </>
                  )}
                </div>
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
