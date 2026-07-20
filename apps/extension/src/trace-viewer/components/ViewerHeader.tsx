import React, { useMemo } from "react";
import { useStore } from "../store";
import type { TopLevelView } from "../store/types";
import { TRACE_SESSION_SEARCH_LIMIT } from "../api";
import { formatCost, formatCount } from "../utils";
import Tooltip from "./Tooltip";

// The single header bar: brand, the two top-level tabs, the fleet summary
// stats (hidden while a session is open), and the theme toggle. Absorbs the
// former TopLevelTabs strip and FleetOverview summary so the list views sit
// under two chrome bars (header + FilterBar) instead of five.
export default function ViewerHeader() {
  const viewerTheme = useStore((s) => s.viewerTheme);
  const setViewerTheme = useStore((s) => s.setViewerTheme);
  const activeTopLevelView = useStore((s) => s.activeTopLevelView);
  const setActiveTopLevelView = useStore((s) => s.setActiveTopLevelView);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const sessions = useStore((s) => s.sessions);
  const runGroups = useStore((s) => s.runGroups);

  const cycleTheme = () => {
    const next =
      viewerTheme === "light"
        ? "dark"
        : viewerTheme === "dark"
          ? "system"
          : "light";
    setViewerTheme(next);
  };

  const icon =
    viewerTheme === "light" ? "☀" : viewerTheme === "dark" ? "☾" : "◐";

  const sessionsLimitReached = sessions.length >= TRACE_SESSION_SEARCH_LIMIT;
  // Standalone sessions (no runId) render as top-level rows on the Runs view,
  // so the badge counts every row a user will actually see there.
  const standaloneCount = useMemo(
    () => sessions.filter((s) => !s.runId || s.runId.length === 0).length,
    [sessions],
  );
  const runsCountLabel = `${formatCount(runGroups.length + standaloneCount)}${
    sessionsLimitReached ? "+" : ""
  }`;

  const stats = useMemo(() => {
    const completed = sessions.filter((session) =>
      ["completed", "success"].includes(session.outcome),
    ).length;
    const totalTurns = sessions.reduce(
      (sum, session) => sum + (session.turnCount || 0),
      0,
    );
    const totalCost = sessions.reduce(
      (sum, session) => sum + (session.metrics?.totalCost ?? 0),
      0,
    );
    const successRate =
      sessions.length === 0
        ? 0
        : Math.round((completed / sessions.length) * 100);
    const averageTurns =
      sessions.length === 0 ? "0.0" : (totalTurns / sessions.length).toFixed(1);
    return { successRate, averageTurns, totalCost };
  }, [sessions]);

  const tabs: Array<{ id: TopLevelView; label: string; countLabel?: string }> =
    [
      { id: "runs", label: "Runs", countLabel: runsCountLabel },
      { id: "analytics", label: "Analytics" },
    ];

  const selectTab = (view: TopLevelView) => {
    // The tabs are globally visible; selecting one from session detail backs
    // out to the list first (same cleanup as ViewerBody's deselect).
    if (currentSessionId) {
      setCurrentSessionId(null);
      setCurrentEntries([]);
      setSearchQuery("");
    }
    setActiveTopLevelView(view);
  };

  return (
    <header className="viewer-header shrink-0 px-5 py-2">
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="viewer-brand-mark">OS</div>
          <h1 className="text-sm leading-tight font-semibold text-trace-text whitespace-nowrap">
            Trace Viewer
          </h1>
        </div>
        <div className="inline-flex rounded border border-trace-border overflow-hidden shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => selectTab(tab.id)}
              className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                activeTopLevelView === tab.id && !currentSessionId
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
        <div className="ml-auto flex items-center gap-4 min-w-0">
          {!currentSessionId && (
            <div className="hidden md:flex items-center gap-x-4 text-[11px] text-trace-muted min-w-0">
              <InlineStat
                label="Traces"
                value={`${formatCount(sessions.length)}${
                  sessionsLimitReached ? "+" : ""
                }`}
                tooltip={
                  sessionsLimitReached
                    ? `Loaded trace rows; list is capped at ${formatCount(
                        TRACE_SESSION_SEARCH_LIMIT,
                      )}. Use Analytics for aggregate totals.`
                    : `${formatCount(standaloneCount)} standalone, ${formatCount(
                        sessions.length - standaloneCount,
                      )} in ${formatCount(runGroups.length)} runs`
                }
              />
              <InlineStat
                label="Success"
                value={`${stats.successRate}%`}
                tooltip={`% of traces with outcome 'completed' or 'success' (n=${formatCount(sessions.length)})`}
              />
              <InlineStat
                label="Avg turns"
                value={stats.averageTurns}
                tooltip={`Average turns per trace (n=${formatCount(sessions.length)})`}
              />
              <InlineStat
                label="Est. cost"
                value={formatCost(stats.totalCost) || "$0"}
                tooltip="Estimated total API cost across loaded traces"
              />
            </div>
          )}
          <button
            onClick={cycleTheme}
            className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-0.5 transition-colors shrink-0"
            title={`Theme: ${viewerTheme}`}
            aria-label={`Current theme: ${viewerTheme}. Click to cycle.`}
          >
            {icon} {viewerTheme}
          </button>
        </div>
      </div>
    </header>
  );
}

function InlineStat({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: string;
  tooltip: string;
}) {
  return (
    <Tooltip content={tooltip}>
      <span className="cursor-help whitespace-nowrap">
        {label}:{" "}
        <span className="font-semibold text-trace-subtle font-mono">
          {value}
        </span>
      </span>
    </Tooltip>
  );
}
