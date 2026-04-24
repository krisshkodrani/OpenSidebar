import React, { useCallback, useEffect, useMemo } from "react";
import { useStore } from "./store";
import { useTraceData } from "./hooks/useTraceData";
import ViewerHeader from "./components/ViewerHeader";
import ViewerErrorBoundary from "./components/ViewerErrorBoundary";
import FleetOverview from "./components/traces/FleetOverview";
import FilterBar from "./components/traces/FilterBar";
import CompareTray from "./components/traces/CompareTray";
import SavedViewsBar from "./components/traces/SavedViewsBar";
import SessionsTableView from "./components/traces/SessionsTableView";
import RunsTableView from "./components/traces/RunsTableView";
import ErrorBanner from "./components/ErrorBanner";
import LoadingSpinner from "./components/LoadingSpinner";
import SessionCompareView from "./components/traces/SessionCompareView";
import TraceDetailHeader from "./components/traces/TraceDetailHeader";
import TraceListModeToggle from "./components/traces/TraceListModeToggle";
import TraceSubviewToggle from "./components/traces/TraceSubviewToggle";
import TurnSearchBar from "./components/traces/TurnSearchBar";
import TurnList from "./components/traces/TurnList";
import TurnTimeline from "./components/traces/TurnTimeline";
import PerceptionList from "./components/traces/PerceptionList";
import LogList from "./components/traces/LogList";
import StoryPanel from "./components/traces/StoryPanel";
import BackendPanel from "./components/BackendPanel";
import type { TopLevelView } from "./store/types";

// ── URL hash helpers ───────────────────────────────────────

function parseHash(): { session?: string; view?: string; turn?: number } {
  const hash = window.location.hash.slice(1);
  if (!hash) return {};
  const params = new URLSearchParams(hash);
  const turnStr = params.get("turn");
  return {
    session: params.get("session") || undefined,
    view: params.get("view") || undefined,
    turn: turnStr ? parseInt(turnStr, 10) : undefined,
  };
}

const VALID_SUBVIEWS = new Set(["turns", "perception", "logs", "story"]);
// ── App ────────────────────────────────────────────────────

export default function App() {
  const currentSessionId = useStore((s) => s.currentSessionId);
  const activeSubview = useStore((s) => s.activeSubview);
  const topLevelView = useStore((s) => s.topLevelView);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const setTopLevelView = useStore((s) => s.setTopLevelView);
  const navigateToTurn = useStore((s) => s.navigateToTurn);

  useEffect(() => {
    const { session, view, turn } = parseHash();
    if (view === "backend") {
      setTopLevelView("backend");
    } else {
      if (session) setCurrentSessionId(session);
      if (view && VALID_SUBVIEWS.has(view))
        setActiveSubview(view as "turns" | "perception" | "logs" | "story");
      if (turn && !isNaN(turn)) {
        setTimeout(() => navigateToTurn(turn), 500);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const parts: string[] = [];
    if (topLevelView === "backend") {
      parts.push("view=backend");
    } else {
      if (currentSessionId) parts.push(`session=${currentSessionId}`);
      if (activeSubview && activeSubview !== "turns")
        parts.push(`view=${activeSubview}`);
    }
    const newHash = parts.length > 0 ? `#${parts.join("&")}` : "";
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, "", newHash || window.location.pathname);
    }
  }, [currentSessionId, activeSubview, topLevelView]);

  return (
    <div className="viewer-shell flex flex-col h-screen text-trace-text font-sans overflow-hidden">
      <ViewerHeader />
      <TopLevelToggle />
      <ViewerErrorBoundary>
        {topLevelView === "backend" ? <BackendPanel /> : <ViewerBody />}
      </ViewerErrorBoundary>
    </div>
  );
}

// ── Top-level tab toggle ──────────────────────────────────

function TopLevelToggle() {
  const topLevelView = useStore((s) => s.topLevelView);
  const setTopLevelView = useStore((s) => s.setTopLevelView);

  const tabs: { key: TopLevelView; label: string }[] = [
    { key: "traces", label: "Sessions" },
    { key: "backend", label: "Memory & Tasks" },
  ];

  return (
    <div className="flex gap-0.5 px-5 bg-trace-panel border-b border-trace-border shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setTopLevelView(tab.key)}
          className={`px-4 py-2 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
            topLevelView === tab.key
              ? "text-trace-accent-light border-trace-accent"
              : "text-trace-muted border-transparent hover:text-trace-subtle"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Viewer body ────────────────────────────────────────────

function ViewerBody() {
  const currentSessionId = useStore((s) => s.currentSessionId);
  const currentEntries = useStore((s) => s.currentEntries);
  const activeSubview = useStore((s) => s.activeSubview);
  const traceListMode = useStore((s) => s.traceListMode);
  const compareViewActive = useStore((s) => s.compareViewActive);
  const compareSessionIds = useStore((s) => s.compareSessionIds);
  const tracesError = useStore((s) => s.tracesError);
  const logsWarning = useStore((s) => s.logsWarning);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const setCompareViewActive = useStore((s) => s.setCompareViewActive);
  const { sessions, refreshSessions } = useTraceData();

  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);

  const selectSession = useCallback(
    (sessionId: string) => {
      if (currentSessionId === sessionId) return;
      setCurrentSessionId(sessionId);
      setCurrentEntries([]);
      setSearchQuery("");
      setActiveSubview("turns");
      setCompareViewActive(false);
    },
    [
      currentSessionId,
      setCurrentSessionId,
      setCurrentEntries,
      setSearchQuery,
      setActiveSubview,
      setCompareViewActive,
    ],
  );

  const deselectSession = useCallback(() => {
    setCurrentSessionId(null);
    setCurrentEntries([]);
    setSearchQuery("");
  }, [setCurrentSessionId, setCurrentEntries, setSearchQuery]);

  const currentIdx = useMemo(
    () => sessions.findIndex((s) => s.sessionId === currentSessionId),
    [sessions, currentSessionId],
  );
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx >= 0 && currentIdx < sessions.length - 1;

  const navigateSession = useCallback(
    (delta: -1 | 1) => {
      const nextIdx = currentIdx + delta;
      if (nextIdx < 0 || nextIdx >= sessions.length) return;
      selectSession(sessions[nextIdx].sessionId);
    },
    [currentIdx, sessions, selectSession],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Escape" && currentSessionId) {
        e.preventDefault();
        deselectSession();
      } else if (e.key === "[" && hasPrev) {
        e.preventDefault();
        navigateSession(-1);
      } else if (e.key === "]" && hasNext) {
        e.preventDefault();
        navigateSession(1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentSessionId, hasPrev, hasNext, navigateSession, deselectSession]);

  // ── Session selected: drill-in detail ──
  if (currentSessionId && currentSession) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 pt-3 pb-1 shrink-0">
          <button
            onClick={deselectSession}
            className="text-[11px] text-trace-muted hover:text-trace-accent-light transition-colors"
          >
            &larr; All Sessions
          </button>
          <span className="text-trace-muted text-[10px]">&middot;</span>
          <span className="text-[10px] text-trace-muted">
            {currentIdx + 1} / {sessions.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigateSession(-1)}
              disabled={!hasPrev}
              className="w-6 h-6 flex items-center justify-center rounded border border-trace-border text-trace-muted hover:text-trace-accent-light hover:border-trace-accent/40 disabled:opacity-30 disabled:hover:text-trace-muted disabled:hover:border-trace-border transition-colors text-xs"
              title="Previous session ( [ )"
            >
              &#8249;
            </button>
            <button
              onClick={() => navigateSession(1)}
              disabled={!hasNext}
              className="w-6 h-6 flex items-center justify-center rounded border border-trace-border text-trace-muted hover:text-trace-accent-light hover:border-trace-accent/40 disabled:opacity-30 disabled:hover:text-trace-muted disabled:hover:border-trace-border transition-colors text-xs"
              title="Next session ( ] )"
            >
              &#8250;
            </button>
          </div>
          <span className="ml-auto text-[9px] text-trace-muted font-mono">
            Esc &middot; [ ] &middot; j k
          </span>
        </div>

        <TraceDetailHeader session={currentSession as any} />
        <TraceSubviewToggle />

        {activeSubview === "turns" ? (
          <>
            <TurnSearchBar />
            {(currentEntries as any[]).length === 0 && !tracesError ? (
              <div className="flex-1 px-5 py-4">
                <LoadingSpinner message="Loading turns..." />
              </div>
            ) : (
              <div className="flex-1 overflow-hidden flex flex-col px-5 py-4">
                <TurnTimeline entries={currentEntries as any[]} />
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
      </div>
    );
  }

  // ── No session: filter bar + sessions table ──
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <FilterBar onFiltersChanged={refreshSessions} />
      <SavedViewsBar onFiltersChanged={refreshSessions} />
      <TraceListModeToggle />
      <FleetOverview onFiltersChanged={refreshSessions} />
      <CompareTray />
      {tracesError ? (
        <div className="px-5 py-4">
          <ErrorBanner
            message={`Failed to load sessions: ${tracesError}`}
            hint="Ensure the log server is running (npm run logs)"
            onRetry={refreshSessions}
          />
        </div>
      ) : compareViewActive && compareSessionIds.length === 2 ? (
        <SessionCompareView sessions={sessions} />
      ) : (
        traceListMode === "runs" ? (
          <RunsTableView onSelectSession={selectSession} />
        ) : (
          <SessionsTableView onSelect={selectSession} />
        )
      )}
    </div>
  );
}
