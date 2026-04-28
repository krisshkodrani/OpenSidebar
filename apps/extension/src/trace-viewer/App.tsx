import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "./store";
import { useTraceData } from "./hooks/useTraceData";
import ViewerHeader from "./components/ViewerHeader";
import ViewerErrorBoundary from "./components/ViewerErrorBoundary";
import Tooltip from "./components/Tooltip";
import FleetOverview from "./components/traces/FleetOverview";
import FleetInsights from "./components/traces/FleetInsights";
import FilterBar from "./components/traces/FilterBar";
import ErrorBanner from "./components/ErrorBanner";
import LoadingSpinner from "./components/LoadingSpinner";
import TraceDetailHeader from "./components/traces/TraceDetailHeader";
import TraceSubviewToggle from "./components/traces/TraceSubviewToggle";
import TurnSearchBar from "./components/traces/TurnSearchBar";
import TurnList from "./components/traces/TurnList";
import TurnTimeline from "./components/traces/TurnTimeline";
import PerceptionList from "./components/traces/PerceptionList";
import LogList from "./components/traces/LogList";
import OverviewTab from "./components/traces/OverviewTab";
import PlanTab from "./components/traces/PlanTab";
import SkillsTab from "./components/traces/SkillsTab";
import PromptsTab from "./components/traces/PromptsTab";
import UnifiedSessionsTableView from "./components/traces/UnifiedSessionsTableView";
import SkillDetail from "./components/traces/SkillDetail";
import type { Subview } from "./store/types";

// URL hash helpers

function parseHash(): {
  session?: string;
  view?: string;
  turn?: number;
  skill?: string;
} {
  const hash = window.location.hash.slice(1);
  if (!hash) return {};
  const params = new URLSearchParams(hash);
  const turnStr = params.get("turn");
  return {
    session: params.get("session") || undefined,
    view: params.get("view") || undefined,
    turn: turnStr ? parseInt(turnStr, 10) : undefined,
    skill: params.get("skill") || undefined,
  };
}

const VALID_SUBVIEWS = new Set([
  "overview",
  "plan",
  "turns",
  "perception",
  "prompts",
  "skills",
  "logs",
]);

// App

export default function App() {
  const currentSessionId = useStore((s) => s.currentSessionId);
  const activeSubview = useStore((s) => s.activeSubview);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const navigateToTurn = useStore((s) => s.navigateToTurn);
  const scrollPositions = useStore((s) => s.scrollPositions);
  const [currentSkillId, setCurrentSkillId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { session, view, turn, skill } = parseHash();
    if (skill) setCurrentSkillId(skill);
    if (session) setCurrentSessionId(session);
    if (view && VALID_SUBVIEWS.has(view)) setActiveSubview(view as Subview);
    if (turn && !isNaN(turn)) {
      requestAnimationFrame(() => navigateToTurn(turn));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const { skill } = parseHash();
      setCurrentSkillId(skill || null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const parts: string[] = [];
    if (currentSkillId) {
      parts.push(`skill=${currentSkillId}`);
    } else {
      if (currentSessionId) parts.push(`session=${currentSessionId}`);
      if (activeSubview && activeSubview !== "overview")
        parts.push(`view=${activeSubview}`);
    }
    const newHash = parts.length > 0 ? `#${parts.join("&")}` : "";
    if (window.location.hash !== newHash) {
      window.history.replaceState(
        null,
        "",
        newHash || window.location.pathname,
      );
    }
  }, [currentSessionId, activeSubview, currentSkillId]);

  const navigateToSkill = useCallback((skillId: string) => {
    setCurrentSkillId(skillId);
  }, []);

  const closeSkill = useCallback(() => {
    setCurrentSkillId(null);
  }, []);

  // Restore scroll position when switching tabs
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollPositions[activeSubview] || 0;
    }
  }, [activeSubview, scrollPositions]);

  return (
    <div className="viewer-shell flex flex-col h-screen text-trace-text font-sans overflow-hidden">
      <ViewerHeader />
      <ViewerErrorBoundary>
        {currentSkillId ? (
          <SkillDetail skillId={currentSkillId} onBack={closeSkill} />
        ) : (
          <ViewerBody
            scrollContainerRef={scrollContainerRef}
            navigateToSkill={navigateToSkill}
          />
        )}
      </ViewerErrorBoundary>
    </div>
  );
}

// Viewer body

function ViewerBody({
  scrollContainerRef,
  navigateToSkill,
}: {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  navigateToSkill: (skillId: string) => void;
}) {
  const currentSessionId = useStore((s) => s.currentSessionId);
  const currentEntries = useStore((s) => s.currentEntries);
  const activeSubview = useStore((s) => s.activeSubview);
  const tracesError = useStore((s) => s.tracesError);
  const logsWarning = useStore((s) => s.logsWarning);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const saveScrollPosition = useStore((s) => s.saveScrollPosition);
  const { sessions, refreshSessions } = useTraceData();

  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);

  const selectSession = useCallback(
    (sessionId: string) => {
      if (currentSessionId === sessionId) return;
      setCurrentSessionId(sessionId);
      setCurrentEntries([]);
      setSearchQuery("");
      setActiveSubview("overview");
    },
    [
      currentSessionId,
      setCurrentSessionId,
      setCurrentEntries,
      setSearchQuery,
      setActiveSubview,
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
      } else if (currentSessionId) {
        if (e.key === "1") {
          e.preventDefault();
          setActiveSubview("overview");
        } else if (e.key === "2") {
          e.preventDefault();
          setActiveSubview("plan");
        } else if (e.key === "3") {
          e.preventDefault();
          setActiveSubview("turns");
        } else if (e.key === "4") {
          e.preventDefault();
          setActiveSubview("perception");
        } else if (e.key === "5") {
          e.preventDefault();
          setActiveSubview("prompts");
        } else if (e.key === "6") {
          e.preventDefault();
          setActiveSubview("skills");
        } else if (e.key === "7") {
          e.preventDefault();
          setActiveSubview("logs");
        } else if (e.key === "p" || e.key === "P") {
          e.preventDefault();
          setActiveSubview("plan");
        } else if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          setActiveSubview("turns");
        } else if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          setActiveSubview("skills");
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    currentSessionId,
    hasPrev,
    hasNext,
    navigateSession,
    deselectSession,
    activeSubview,
    setActiveSubview,
  ]);

  // Save scroll position on scroll
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (currentSessionId) {
        saveScrollPosition(activeSubview, e.currentTarget.scrollTop);
      }
    },
    [currentSessionId, activeSubview, saveScrollPosition],
  );

  // Session selected: drill-in detail
  if (currentSessionId && currentSession) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
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
          <Tooltip content="Keyboard: 1-7 tabs, p=plan, t=turns, s=skills, Esc=back, [ ]=sessions">
            <span className="ml-auto text-[9px] text-trace-muted font-mono cursor-help">
              Esc · [ ] · 1-7
            </span>
          </Tooltip>
        </div>

        <div className="session-detail-summary scroll-shadow-y shrink-0 overflow-y-auto scrollbar-thin bg-trace-panel border-b border-trace-border">
          <TraceDetailHeader session={currentSession as any} />
        </div>
        <TraceSubviewToggle />

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto scrollbar-thin"
        >
          {activeSubview === "turns" ? (
            <div className="flex flex-col px-5 py-4">
              <TurnSearchBar />
              {(currentEntries as any[]).length === 0 && !tracesError ? (
                <LoadingSpinner message="Loading turns..." />
              ) : (
                <>
                  <TurnTimeline entries={currentEntries as any[]} />
                  <div className="flex-1 min-h-0">
                    <TurnList />
                  </div>
                </>
              )}
            </div>
          ) : activeSubview === "perception" ? (
            <div className="px-5 py-4">
              <PerceptionList />
            </div>
          ) : activeSubview === "logs" ? (
            <div className="flex flex-col">
              {logsWarning && (
                <div className="px-5 pt-3">
                  <div className="text-xs text-state-warning bg-state-warning/10 border border-state-warning/25 rounded px-3 py-2">
                    {logsWarning}
                  </div>
                </div>
              )}
              <LogList />
            </div>
          ) : activeSubview === "overview" ? (
            <div className="px-5 py-4">
              <OverviewTab session={currentSession as any} />
            </div>
          ) : activeSubview === "plan" ? (
            <div className="px-5 py-4">
              <PlanTab session={currentSession as any} />
            </div>
          ) : activeSubview === "skills" ? (
            <div className="px-5 py-4">
              <SkillsTab session={currentSession as any} />
            </div>
          ) : activeSubview === "prompts" ? (
            <div className="px-5 py-4">
              <PromptsTab session={currentSession as any} />
            </div>
          ) : (
            <div className="px-5 py-4">
              <div className="text-sm text-trace-muted">
                {activeSubview} tab coming soon...
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // No session: filter bar + unified sessions table
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <FilterBar onFiltersChanged={refreshSessions} />
      <FleetOverview onFiltersChanged={refreshSessions} />
      <FleetInsights onSelectSession={selectSession} />
      {tracesError ? (
        <div className="px-5 py-4">
          <ErrorBanner
            message={`Failed to load sessions: ${tracesError}`}
            hint="Ensure the local server is running (npm run logs)"
            onRetry={refreshSessions}
          />
        </div>
      ) : (
        <UnifiedSessionsTableView
          onSelect={selectSession}
          navigateToSkill={navigateToSkill}
        />
      )}
    </div>
  );
}
