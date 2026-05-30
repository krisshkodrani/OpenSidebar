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
import BackendPanel from "./components/BackendPanel";
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
import RunsTableView from "./components/traces/RunsTableView";
import InsightsTab from "./components/traces/InsightsTab";
import MetricsTab from "./components/traces/MetricsTab";
import SkillDetail from "./components/traces/SkillDetail";
import { TRACE_SESSION_SEARCH_LIMIT } from "./api";
import type { Subview, TopLevelView } from "./store/types";
import { formatCount } from "./utils";

// URL hash helpers

function parseHash(): {
  session?: string;
  view?: string;
  top?: string;
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
    top: params.get("top") || undefined,
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

const VALID_TOP_LEVEL_VIEWS = new Set([
  "sessions",
  "runs",
  "insights",
  "metrics",
]);

// App

export default function App() {
  const currentSessionId = useStore((s) => s.currentSessionId);
  const activeSubview = useStore((s) => s.activeSubview);
  const activeTopLevelView = useStore((s) => s.activeTopLevelView);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const setActiveTopLevelView = useStore((s) => s.setActiveTopLevelView);
  const navigateToTurn = useStore((s) => s.navigateToTurn);
  const viewerTheme = useStore((s) => s.viewerTheme);
  const [currentSkillId, setCurrentSkillId] = useState<string | null>(null);
  const [backendView, setBackendView] = useState<boolean>(false);
  const [showShortcuts, setShowShortcuts] = useState<boolean>(false);

  // Apply viewer theme
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (
        viewerTheme === "dark" ||
        (viewerTheme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches)
      ) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => apply();
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [viewerTheme]);

  useEffect(() => {
    const { session, view, top, turn, skill } = parseHash();
    if (skill) setCurrentSkillId(skill);
    if (view === "backend") setBackendView(true);
    if (session) setCurrentSessionId(session);
    if (view && VALID_SUBVIEWS.has(view)) {
      setBackendView(false);
      setActiveSubview(view as Subview);
    }
    if (top && VALID_TOP_LEVEL_VIEWS.has(top)) {
      setBackendView(false);
      setActiveTopLevelView(top as TopLevelView);
    }
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
    if (backendView) {
      parts.push("view=backend");
    } else if (currentSkillId) {
      parts.push(`skill=${currentSkillId}`);
    } else {
      if (currentSessionId) parts.push(`session=${currentSessionId}`);
      else if (activeTopLevelView !== "sessions")
        parts.push(`top=${activeTopLevelView}`);
      if (currentSessionId && activeSubview && activeSubview !== "overview")
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
  }, [
    backendView,
    currentSessionId,
    activeSubview,
    activeTopLevelView,
    currentSkillId,
  ]);

  const navigateToSkill = useCallback((skillId: string) => {
    setCurrentSkillId(skillId);
  }, []);

  const closeSkill = useCallback(() => {
    setCurrentSkillId(null);
  }, []);

  return (
    <div className="viewer-shell flex flex-col h-screen text-trace-text font-sans overflow-hidden">
      <ViewerHeader />
      <ViewerErrorBoundary>
        {currentSkillId ? (
          <SkillDetail skillId={currentSkillId} onBack={closeSkill} />
        ) : backendView ? (
          <BackendPanel />
        ) : (
          <ViewerBody
            navigateToSkill={navigateToSkill}
            setShowShortcuts={setShowShortcuts}
          />
        )}
      </ViewerErrorBoundary>
      {showShortcuts && (
        <div className="fixed right-4 bottom-4 z-50 rounded-lg border border-trace-border bg-trace-bg/95 px-3 py-2 text-[11px] text-trace-muted shadow-xl">
          <div className="mb-1 font-semibold text-trace-text">Shortcuts</div>
          <div>? toggle help</div>
          <div>Esc back to traces</div>
          <div>[ / ] previous / next trace</div>
          <div>1-7 switch detail tabs</div>
        </div>
      )}
    </div>
  );
}

// Viewer body

function ViewerBody({
  navigateToSkill,
  setShowShortcuts,
}: {
  navigateToSkill: (skillId: string) => void;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const currentSessionId = useStore((s) => s.currentSessionId);
  const currentEntries = useStore((s) => s.currentEntries);
  const activeSubview = useStore((s) => s.activeSubview);
  const activeTopLevelView = useStore((s) => s.activeTopLevelView);
  const tracesError = useStore((s) => s.tracesError);
  const logsWarning = useStore((s) => s.logsWarning);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const setActiveTopLevelView = useStore((s) => s.setActiveTopLevelView);
  const setFilter = useStore((s) => s.setFilter);
  const saveScrollPosition = useStore((s) => s.saveScrollPosition);
  const { sessions, refreshSessions } = useTraceData();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Live scroll position lives in a ref so scrolling never triggers a render.
  const liveScrollTopRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  // The session the live scroll value belongs to, so a flush that fires after
  // a session switch does not write the old scrollTop under the new key.
  const scrollSessionRef = useRef<string | null>(null);

  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);
  const sessionsLimitReached = sessions.length >= TRACE_SESSION_SEARCH_LIMIT;

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

  const focusRun = useCallback(
    (runId: string) => {
      setFilter("runId", runId);
      setActiveTopLevelView("runs");
      setCurrentSessionId(null);
      setCurrentEntries([]);
      setSearchQuery("");
    },
    [
      setActiveTopLevelView,
      setCurrentEntries,
      setCurrentSessionId,
      setFilter,
      setSearchQuery,
    ],
  );

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

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((prev: boolean) => !prev);
        return;
      }

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
    setShowShortcuts,
  ]);

  // Track the live scroll position in a ref and flush to the store at most
  // once per animation frame. The store write no longer re-renders anything
  // (nothing subscribes to scrollPositions reactively), and throttling keeps
  // the writes off the hot scroll path.
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      liveScrollTopRef.current = e.currentTarget.scrollTop;
      scrollSessionRef.current = useStore.getState().currentSessionId;
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const state = useStore.getState();
        // Skip if the session changed since this scroll was captured —
        // saveScrollPosition keys off the live currentSessionId.
        if (
          state.currentSessionId &&
          state.currentSessionId === scrollSessionRef.current
        ) {
          state.saveScrollPosition(state.activeSubview, liveScrollTopRef.current);
        }
      });
    },
    [],
  );

  // Restore the saved scroll position when the tab/session changes, and flush
  // the final position for the tab/session we are leaving. Read positions
  // imperatively so this effect does not subscribe to every scroll write.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const sessionAtMount = currentSessionId;
    const viewAtMount = activeSubview;
    const key = sessionAtMount
      ? `${sessionAtMount}:${viewAtMount}`
      : viewAtMount;
    el.scrollTop = useStore.getState().scrollPositions[key] || 0;
    liveScrollTopRef.current = el.scrollTop;
    scrollSessionRef.current = sessionAtMount;
    return () => {
      // Only flush if we are still on the same session, otherwise the store's
      // currentSessionId has already advanced and saveScrollPosition would
      // write under the wrong key.
      if (
        sessionAtMount &&
        useStore.getState().currentSessionId === sessionAtMount
      ) {
        saveScrollPosition(viewAtMount, liveScrollTopRef.current);
      }
    };
  }, [activeSubview, currentSessionId, saveScrollPosition]);

  // Cancel any pending flush on unmount.
  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  // Session selected: drill-in detail
  if (currentSessionId && currentSession) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 pt-3 pb-1 shrink-0">
          <button
            onClick={deselectSession}
            className="text-[11px] text-trace-muted hover:text-trace-accent-light transition-colors"
          >
            &larr; All Traces
          </button>
          <span className="text-trace-muted text-[10px]">&middot;</span>
          <span className="text-[10px] text-trace-muted">
            {formatCount(currentIdx + 1)} / {formatCount(sessions.length)}
            {sessionsLimitReached ? "+" : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigateSession(-1)}
              disabled={!hasPrev}
              className="w-6 h-6 flex items-center justify-center rounded border border-trace-border text-trace-muted hover:text-trace-accent-light hover:border-trace-accent/40 disabled:opacity-30 disabled:hover:text-trace-muted disabled:hover:border-trace-border transition-colors text-xs"
              title="Previous trace ( [ )"
            >
              &#8249;
            </button>
            <button
              onClick={() => navigateSession(1)}
              disabled={!hasNext}
              className="w-6 h-6 flex items-center justify-center rounded border border-trace-border text-trace-muted hover:text-trace-accent-light hover:border-trace-accent/40 disabled:opacity-30 disabled:hover:text-trace-muted disabled:hover:border-trace-border transition-colors text-xs"
              title="Next trace ( ] )"
            >
              &#8250;
            </button>
          </div>
          <Tooltip content="Keyboard: 1-7 tabs, p=plan, t=turns, s=skills, Esc=back, [ ]=traces">
            <span className="ml-auto text-[9px] text-trace-muted font-mono cursor-help">
              Esc · [ ] · 1-7
            </span>
          </Tooltip>
        </div>

        <div className="session-detail-summary scroll-shadow-y shrink-0 overflow-y-auto scrollbar-thin bg-trace-panel border-b border-trace-border">
          <TraceDetailHeader session={currentSession} />
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
              {currentEntries.length === 0 && !tracesError ? (
                <LoadingSpinner message="Loading turns..." />
              ) : (
                <>
                  <TurnTimeline entries={currentEntries} />
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
              <OverviewTab session={currentSession} />
            </div>
          ) : activeSubview === "plan" ? (
            <div className="px-5 py-4">
              <PlanTab session={currentSession} />
            </div>
          ) : activeSubview === "skills" ? (
            <div className="px-5 py-4">
              <SkillsTab session={currentSession} entries={currentEntries} />
            </div>
          ) : activeSubview === "prompts" ? (
            <div className="px-5 py-4">
              <PromptsTab session={currentSession} entries={currentEntries} />
            </div>
          ) : (
            <div className="px-5 py-4">
              <div className="text-sm text-trace-muted">
                Unknown trace subview: {activeSubview}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // No selected trace: filter bar + unified traces table
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <TopLevelTabs
        active={activeTopLevelView}
        onChange={setActiveTopLevelView}
      />
      <FilterBar onFiltersChanged={refreshSessions} />
      {activeTopLevelView !== "insights" &&
        activeTopLevelView !== "metrics" && (
        <FleetOverview onFiltersChanged={refreshSessions} />
      )}
      {activeTopLevelView !== "insights" &&
        activeTopLevelView !== "metrics" && (
          <FleetInsights onSelectSession={selectSession} />
        )}
      {activeTopLevelView === "insights" ? (
        <InsightsTab onSelectSession={selectSession} onFocusRun={focusRun} />
      ) : activeTopLevelView === "metrics" ? (
        <MetricsTab />
      ) : tracesError ? (
        <div className="px-5 py-4">
          <ErrorBanner
            message={`Failed to load traces: ${tracesError}`}
            hint="Ensure the local server is running (pnpm run logs)"
            onRetry={refreshSessions}
          />
        </div>
      ) : activeTopLevelView === "runs" ? (
        <RunsTableView onSelectSession={selectSession} />
      ) : (
        <UnifiedSessionsTableView
          onSelect={selectSession}
          navigateToSkill={navigateToSkill}
          onSelectRun={focusRun}
        />
      )}
    </div>
  );
}

function TopLevelTabs({
  active,
  onChange,
}: {
  active: TopLevelView;
  onChange: (view: TopLevelView) => void;
}) {
  const sessions = useStore((s) => s.sessions);
  const runGroups = useStore((s) => s.runGroups);
  const sessionsLimitReached = sessions.length >= TRACE_SESSION_SEARCH_LIMIT;
  const sessionsCountLabel = `${formatCount(sessions.length)}${
    sessionsLimitReached ? "+" : ""
  }`;
  const runsCountLabel = `${formatCount(runGroups.length)}${
    sessionsLimitReached ? "+" : ""
  }`;
  const tabs: Array<{ id: TopLevelView; label: string; countLabel?: string }> = [
    { id: "runs", label: "Runs", countLabel: runsCountLabel },
    { id: "sessions", label: "Traces", countLabel: sessionsCountLabel },
    { id: "insights", label: "Insights" },
    { id: "metrics", label: "Metrics" },
  ];

  return (
    <div className="flex items-center gap-2 px-5 py-2 border-b border-trace-border bg-trace-panel/80 shrink-0">
      <span className="text-[10px] uppercase tracking-[0.22em] text-trace-muted">
        Trace Viewer
      </span>
      <div className="inline-flex rounded border border-trace-border overflow-hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${
              active === tab.id
                ? "bg-trace-accent/15 text-trace-accent-light"
                : "bg-transparent text-trace-muted hover:text-trace-text"
            }`}
          >
            {tab.countLabel == null
              ? tab.label
              : `${tab.label} (${tab.countLabel})`}
          </button>
        ))}
      </div>
    </div>
  );
}
