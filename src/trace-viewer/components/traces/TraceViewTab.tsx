import React from "react";
import { useStore } from "../../store";
import { useTraceData } from "../../hooks/useTraceData";
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

export default function TraceViewTab() {
  const runGroups = useStore((s) => s.runGroups);
  const currentEntries = useStore((s) => s.currentEntries);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const activeSubview = useStore((s) => s.activeSubview);
  const tracesError = useStore((s) => s.tracesError);
  const logsWarning = useStore((s) => s.logsWarning);
  const { sessions, refreshSessions } = useTraceData();

  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);

  return (
    <PanelLayout
      left={
        <>
          <div className="px-4 pt-4 pb-3 border-b border-trace-border/70 bg-black/10">
            <div className="text-[11px] uppercase tracking-[0.24em] text-trace-accent-light/75">
              Trace Navigator
            </div>
            <div className="mt-1 text-sm text-trace-subtle">
              Select a session, then move between turns, perception, logs, and story.
            </div>
          </div>
          <TraceFilterPanel onFiltersChanged={refreshSessions} />
          <div className="border-b border-trace-border/70" />
          {tracesError ? (
            <ErrorBanner
              message={`Failed to load sessions: ${tracesError}`}
              hint="Ensure the log server is running (npm run logs)"
              onRetry={refreshSessions}
            />
          ) : (
            <>
              <CostDashboard
                sessions={sessions}
                runGroups={runGroups}
                onDeleted={refreshSessions}
              />
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
          <EmptyState
            icon="&#9776;"
            message="Select a session to open the trace inspector."
          />
        )
      }
    />
  );
}
