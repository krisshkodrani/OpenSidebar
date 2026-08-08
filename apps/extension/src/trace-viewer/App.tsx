import React, {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import { useStore } from "./store";
import { useTraceData } from "./hooks/useTraceData";
import ViewerHeader from "./components/ViewerHeader";
import ViewerErrorBoundary from "./components/ViewerErrorBoundary";
import Tooltip from "./components/Tooltip";
import FilterBar from "./components/traces/FilterBar";
import ErrorBanner from "./components/ErrorBanner";
import LoadingSpinner from "./components/LoadingSpinner";
import TraceDetailHeader from "./components/traces/TraceDetailHeader";
import TraceSubviewToggle from "./components/traces/TraceSubviewToggle";
import TurnSearchBar from "./components/traces/TurnSearchBar";
import TurnList from "./components/traces/TurnList";
import TurnTimeline from "./components/traces/TurnTimeline";
import TrajectoryScorecard from "./components/traces/TrajectoryScorecard";
import StoryTab from "./components/traces/story/StoryTab";
import RunsTableView from "./components/traces/RunsTableView";
import SkillDetail from "./components/traces/SkillDetail";
import { TRACE_SESSION_SEARCH_LIMIT } from "./api";
import type { Subview, TopLevelView } from "./store/types";
import { formatCount } from "./utils";
import { parseViewerHash, serializeViewerHash } from "@observability-schema";

const AnalyticsTab = lazy(() => import("./components/traces/AnalyticsTab"));
const LogList = lazy(() => import("./components/traces/LogList"));
const PerceptionList = lazy(() => import("./components/traces/PerceptionList"));
const PlanTab = lazy(() => import("./components/traces/PlanTab"));
const PromptsTab = lazy(() => import("./components/traces/PromptsTab"));
const SkillsTab = lazy(() => import("./components/traces/SkillsTab"));

const VALID_SUBVIEWS = new Set([
  "story",
  "plan",
  "turns",
  "perception",
  "prompts",
  "skills",
  "logs",
]);

// Legacy subview hashes from the pre-simplification viewer. Old deep links
// keep working: Overview folded into Story, RL Trajectory retired (its data
// stays reachable via the /rl-trajectory endpoint, MCP, and trace-query CLI).
const SUBVIEW_MIGRATIONS: Record<string, Subview> = {
  overview: "story",
  trajectory: "turns",
};

const VALID_TOP_LEVEL_VIEWS = new Set(["runs", "analytics"]);

// Legacy top-level hashes. The Attention inbox became the "needs review" chip
// on Runs (the chip itself is restored separately from the review= param); the
// flat Traces table folded into Runs; Insights and Metrics merged into one
// Analytics tab. Old deep links land on the closest new surface.
const TOP_LEVEL_MIGRATIONS: Record<string, TopLevelView> = {
  attention: "runs",
  sessions: "runs",
  insights: "analytics",
  metrics: "analytics",
};

// App

export default function App() {
  const currentSessionId = useStore((s) => s.currentSessionId);
  const activeSubview = useStore((s) => s.activeSubview);
  const activeTopLevelView = useStore((s) => s.activeTopLevelView);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const setActiveTopLevelView = useStore((s) => s.setActiveTopLevelView);
  const setFilter = useStore((s) => s.setFilter);
  const needsReview = useStore((s) => s.filters.needsReview);
  const focusedTurn = useStore((s) => s.focusTurnNumber);
  const focusedRunId = useStore((s) => s.filters.runId);
  const navigateToTurn = useStore((s) => s.navigateToTurn);
  const navigateToPerception = useStore((s) => s.navigateToPerception);
  const navigateToModelIO = useStore((s) => s.navigateToModelIO);
  const modelIOFocus = useStore((s) => s.modelIOFocus);
  const viewerTheme = useStore((s) => s.viewerTheme);
  const [currentSkillId, setCurrentSkillId] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState<boolean>(false);
  const [routeHydrated, setRouteHydrated] = useState(false);
  const routeHydratedRef = useRef(false);

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

  const applyHashRoute = useCallback(() => {
    const route = parseViewerHash(window.location.hash);
    const replacesCurrentRoute =
      routeHydratedRef.current || window.location.hash.length > 1;
    setCurrentSkillId(route.skillId ?? null);
    if (route.sessionId) {
      setCurrentSessionId(route.sessionId);
      setFilter("runId", "");
      const migrated = route.view
        ? (SUBVIEW_MIGRATIONS[route.view] ?? route.view)
        : "story";
      if (VALID_SUBVIEWS.has(migrated)) {
        setActiveSubview(migrated as Subview);
      }
    } else if (!route.skillId && replacesCurrentRoute) {
      setCurrentSessionId(null);
    }
    if (route.top) {
      const migrated = TOP_LEVEL_MIGRATIONS[route.top] ?? route.top;
      if (VALID_TOP_LEVEL_VIEWS.has(migrated)) {
        setActiveTopLevelView(migrated as TopLevelView);
      }
    } else if (!route.sessionId && !route.skillId && replacesCurrentRoute) {
      setActiveTopLevelView("runs");
    }
    setFilter(
      "needsReview",
      route.review === "needs" || route.top === ("attention" as TopLevelView)
        ? "on"
        : "off",
    );
    if (route.runId) setFilter("runId", route.runId);
    else if (replacesCurrentRoute) setFilter("runId", "");
    if (route.turn && route.view === "prompts") {
      navigateToModelIO(route.turn, route.section);
    } else if (
      route.turn &&
      (route.view === "turns" || route.view === "perception")
    ) {
      requestAnimationFrame(() => {
        if (route.view === "perception") navigateToPerception(route.turn!);
        else navigateToTurn(route.turn!);
      });
    }
    routeHydratedRef.current = true;
    setRouteHydrated(true);
  }, [
    navigateToPerception,
    navigateToModelIO,
    navigateToTurn,
    setActiveSubview,
    setActiveTopLevelView,
    setCurrentSessionId,
    setFilter,
  ]);

  useEffect(() => {
    applyHashRoute();
    window.addEventListener("hashchange", applyHashRoute);
    return () => window.removeEventListener("hashchange", applyHashRoute);
  }, [applyHashRoute]);

  useEffect(() => {
    if (!routeHydrated) return;
    const newHash = serializeViewerHash({
      skillId: currentSkillId ?? undefined,
      sessionId: currentSessionId ?? undefined,
      runId: !currentSessionId ? focusedRunId || undefined : undefined,
      view: currentSessionId ? activeSubview : undefined,
      top: !currentSessionId ? activeTopLevelView : undefined,
      review: !currentSessionId && needsReview === "on" ? "needs" : undefined,
      turn:
        currentSessionId &&
        (activeSubview === "turns" || activeSubview === "perception")
          ? (focusedTurn ?? undefined)
          : activeSubview === "prompts"
            ? modelIOFocus?.turnNumber
            : undefined,
      section:
        currentSessionId && activeSubview === "prompts"
          ? modelIOFocus?.section
          : undefined,
    });
    if (window.location.hash !== newHash) {
      window.history.replaceState(
        null,
        "",
        newHash || window.location.pathname,
      );
    }
  }, [
    currentSessionId,
    activeSubview,
    activeTopLevelView,
    currentSkillId,
    focusedRunId,
    focusedTurn,
    modelIOFocus,
    needsReview,
    routeHydrated,
  ]);

  const closeSkill = useCallback(() => {
    setCurrentSkillId(null);
  }, []);

  return (
    <div className="viewer-shell flex flex-col h-screen text-trace-text font-sans overflow-hidden">
      <ViewerHeader />
      <ViewerErrorBoundary>
        {currentSkillId ? (
          <SkillDetail skillId={currentSkillId} onBack={closeSkill} />
        ) : (
          <ViewerBody setShowShortcuts={setShowShortcuts} />
        )}
      </ViewerErrorBoundary>
      {showShortcuts && (
        <div className="fixed right-4 bottom-4 z-50 rounded-lg border border-trace-border bg-trace-bg/95 px-3 py-2 text-[11px] text-trace-muted shadow-xl">
          <div className="mb-1 font-semibold text-trace-text">Shortcuts</div>
          <div>? toggle help</div>
          <div>Esc back to traces</div>
          <div>[ / ] previous / next trace</div>
          <div>1-7 switch detail tabs · m Model I/O</div>
        </div>
      )}
    </div>
  );
}

// Viewer body

function ViewerBody({
  setShowShortcuts,
}: {
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
  const { sessions, refreshSessions, loadMoreSessions, sessionsPageLoading } =
    useTraceData();

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
      setActiveSubview("story");
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
          setActiveSubview("story");
        } else if (e.key === "2") {
          e.preventDefault();
          setActiveSubview("turns");
        } else if (e.key === "3") {
          e.preventDefault();
          setActiveSubview("prompts");
        } else if (e.key === "4") {
          e.preventDefault();
          setActiveSubview("plan");
        } else if (e.key === "5") {
          e.preventDefault();
          setActiveSubview("perception");
        } else if (e.key === "6") {
          e.preventDefault();
          setActiveSubview("logs");
        } else if (e.key === "7") {
          e.preventDefault();
          setActiveSubview("skills");
        } else if (e.key === "p" || e.key === "P") {
          e.preventDefault();
          setActiveSubview("plan");
        } else if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          setActiveSubview("turns");
        } else if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          setActiveSubview("skills");
        } else if (e.key === "m" || e.key === "M") {
          e.preventDefault();
          setActiveSubview("prompts");
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
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
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
  }, []);

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
          <Tooltip content="Keyboard: 1-7 tabs, m=Model I/O, p=plan, t=timeline, s=skills, Esc=back, [ ]=traces">
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
          {activeSubview === "story" ? (
            <div className="px-5 py-4">
              <StoryTab session={currentSession} />
            </div>
          ) : activeSubview === "turns" ? (
            <div className="flex flex-col px-5 py-4">
              <TrajectoryScorecard session={currentSession} />
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
              <Suspense
                fallback={<LoadingSpinner message="Loading perception..." />}
              >
                <PerceptionList />
              </Suspense>
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
              <Suspense fallback={<LoadingSpinner message="Loading logs..." />}>
                <LogList />
              </Suspense>
            </div>
          ) : activeSubview === "plan" ? (
            <div className="px-5 py-4">
              <Suspense fallback={<LoadingSpinner message="Loading plan..." />}>
                <PlanTab session={currentSession} />
              </Suspense>
            </div>
          ) : activeSubview === "skills" ? (
            <div className="px-5 py-4">
              <Suspense
                fallback={<LoadingSpinner message="Loading skills..." />}
              >
                <SkillsTab session={currentSession} entries={currentEntries} />
              </Suspense>
            </div>
          ) : activeSubview === "prompts" ? (
            <div className="px-5 py-4">
              <Suspense
                fallback={<LoadingSpinner message="Loading model I/O..." />}
              >
                <PromptsTab session={currentSession} entries={currentEntries} />
              </Suspense>
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

  // No selected trace: filter bar + the active list view
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <FilterBar onFiltersChanged={refreshSessions} />
      {activeTopLevelView === "analytics" ? (
        <Suspense fallback={<LoadingSpinner message="Loading analytics..." />}>
          <AnalyticsTab onSelectSession={selectSession} onFocusRun={focusRun} />
        </Suspense>
      ) : tracesError ? (
        <div className="px-5 py-4">
          <ErrorBanner
            message={`Failed to load traces: ${tracesError}`}
            hint="Ensure the local server is running (pnpm run logs)"
            onRetry={refreshSessions}
          />
        </div>
      ) : (
        <RunsTableView
          onSelectSession={selectSession}
          onLoadMore={loadMoreSessions}
          loadMorePending={sessionsPageLoading}
        />
      )}
    </div>
  );
}
