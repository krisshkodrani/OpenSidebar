import React, { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { useStore } from "../../store";
import type { TraceSession } from "../../../types/traces";
import type { RunGroup } from "../../store/types";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
import {
  outcomeClass,
  formatTime,
  formatCost,
  formatDuration,
  getSessionModels,
  shortModel,
  extractQueryTitle,
  truncate,
} from "../../utils";

const COLUMNS = [
  { key: "startTime", label: "Time", width: "w-[80px]", sortable: true },
  {
    key: "query",
    label: "Query",
    width: "flex-1 min-w-[160px]",
    sortable: true,
  },
  { key: "outcome", label: "Outcome", width: "w-[80px]", sortable: true },
  { key: "turnCount", label: "Turns", width: "w-[50px]", sortable: true },
  { key: "cost", label: "Cost", width: "w-[65px]", sortable: true },
  { key: "duration", label: "Duration", width: "w-[70px]", sortable: true },
  { key: "runId", label: "Run", width: "w-[100px]", sortable: false },
] as const;

interface UnifiedTableItem {
  type: "run" | "session";
  data: RunGroup | TraceSession;
  runId?: string;
  isExpanded?: boolean;
}

function sortSessions(
  sessions: TraceSession[],
  column: string,
  direction: "asc" | "desc",
): TraceSession[] {
  const sorted = [...sessions].sort((a, b) => {
    let cmp = 0;
    switch (column) {
      case "startTime":
        cmp = (a.startTime || 0) - (b.startTime || 0);
        break;
      case "query":
        cmp = (a.query || "").localeCompare(b.query || "");
        break;
      case "outcome":
        cmp = (a.outcome || "").localeCompare(b.outcome || "");
        break;
      case "turnCount":
        cmp = (a.turnCount || 0) - (b.turnCount || 0);
        break;
      case "cost":
        cmp = (a.metrics?.totalCost ?? 0) - (b.metrics?.totalCost ?? 0);
        break;
      case "duration":
        cmp =
          (a.endTime || 0) -
          (a.startTime || 0) -
          ((b.endTime || 0) - (b.startTime || 0));
        break;
      default:
        cmp = 0;
    }
    return direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}

interface UnifiedSessionsTableViewProps {
  onSelect: (sessionId: string) => void;
}

export default function UnifiedSessionsTableView({
  onSelect,
}: UnifiedSessionsTableViewProps) {
  const sessions = useStore((s) => s.sessions);
  const runGroups = useStore((s) => s.runGroups);
  const tracesLoading = useStore((s) => s.tracesLoading);
  const tableSort = useStore((s) => s.tableSort);
  const setTableSort = useStore((s) => s.setTableSort);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(() => {
    // Auto-expand runs with only 1 session
    const autoExpanded = new Set<string>();
    runGroups.forEach((g) => {
      if (g.sessions.length === 1) autoExpanded.add(g.runId);
    });
    return autoExpanded;
  });

  const toggleRun = (runId: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  // Build unified table items
  const tableItems = useMemo(() => {
    const items: UnifiedTableItem[] = [];
    const sortedSessions = sortSessions(
      sessions,
      tableSort.column,
      tableSort.direction,
    );

    // Create a map of runId -> sessions
    const sessionsByRun = new Map<string, TraceSession[]>();
    for (const session of sortedSessions) {
      const runId = (session as any).runId;
      if (runId) {
        if (!sessionsByRun.has(runId)) {
          sessionsByRun.set(runId, []);
        }
        sessionsByRun.get(runId)!.push(session);
      }
    }

    // Track which sessions have been added via runs
    const addedSessionIds = new Set<string>();

    // Add run groups first (if they have sessions)
    for (const runGroup of runGroups) {
      const runSessions = sessionsByRun.get(runGroup.runId) || [];
      if (runSessions.length > 0) {
        items.push({
          type: "run",
          data: runGroup,
          runId: runGroup.runId,
          isExpanded: expandedRuns.has(runGroup.runId),
        });

        // Add sessions under this run if expanded
        if (expandedRuns.has(runGroup.runId)) {
          for (const session of runSessions) {
            items.push({
              type: "session",
              data: session,
              runId: runGroup.runId,
            });
            addedSessionIds.add(session.sessionId);
          }
        }
      }
    }

    // Add standalone sessions (not part of any run)
    for (const session of sortedSessions) {
      if (!addedSessionIds.has(session.sessionId)) {
        items.push({
          type: "session",
          data: session,
        });
      }
    }

    return items;
  }, [sessions, runGroups, tableSort, expandedRuns]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tableItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = tableItems[index];
      return item.type === "run" ? 48 : 40;
    },
    overscan: 15,
  });

  const handleSort = (column: string) => {
    if (tableSort.column === column) {
      setTableSort(column, tableSort.direction === "asc" ? "desc" : "asc");
    } else {
      setTableSort(column, "desc");
    }
  };

  if (tracesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-trace-muted text-sm">
        Loading sessions...
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-trace-dim text-sm">
        No sessions found. Adjust filters to see more results.
      </div>
    );
  }

  const runCount = runGroups.filter((g) => g.sessions.length > 0).length;
  const standaloneCount =
    sessions.length - runGroups.reduce((acc, g) => acc + g.sessions.length, 0);

  return (
    <div className="flex-1 flex flex-col overflow-x-auto overflow-y-hidden">
      {/* Header */}
      <div className="flex min-w-[760px] items-center gap-2 px-4 py-2 text-[10px] font-semibold text-trace-muted uppercase tracking-wider border-b border-trace-border bg-trace-bg shrink-0">
        <div className="w-6 shrink-0"></div>
        {COLUMNS.map((col) =>
          col.sortable ? (
            <button
              key={col.key}
              onClick={() => handleSort(col.key)}
              className={`${col.width} text-left hover:text-trace-accent-light transition-colors cursor-pointer truncate ${
                tableSort.column === col.key ? "text-trace-accent-light" : ""
              }`}
            >
              {col.label}
              {tableSort.column === col.key && (
                <span className="ml-0.5">
                  {tableSort.direction === "asc" ? "▲" : "▼"}
                </span>
              )}
            </button>
          ) : (
            <span key={col.key} className={`${col.width} text-left truncate`}>
              {col.label}
            </span>
          ),
        )}
      </div>

      {/* Rows */}
      <div
        ref={parentRef}
        className="min-w-[760px] flex-1 overflow-y-auto scrollbar-thin"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = tableItems[virtualRow.index];
            return (
              <div
                key={
                  item.type === "run"
                    ? `run-${(item.data as RunGroup).runId}`
                    : `session-${(item.data as TraceSession).sessionId}`
                }
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {item.type === "run" ? (
                  <RunRow
                    runGroup={item.data as RunGroup}
                    isExpanded={item.isExpanded || false}
                    onToggle={() => toggleRun((item.data as RunGroup).runId)}
                  />
                ) : (
                  <SessionRow
                    session={item.data as TraceSession}
                    isNested={!!item.runId}
                    onClick={() =>
                      onSelect((item.data as TraceSession).sessionId)
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-1.5 text-[10px] text-trace-muted border-t border-trace-border/50 shrink-0">
        {sessions.length} sessions
        {runCount > 0 && ` · ${runCount} runs`}
        {standaloneCount > 0 && ` · ${standaloneCount} standalone`}
      </div>
    </div>
  );
}

function RunRow({
  runGroup,
  isExpanded,
  onToggle,
}: {
  runGroup: RunGroup;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const duration = formatDuration(runGroup.latestEnd - runGroup.earliestStart);
  const cost = formatCost(runGroup.totalCost);

  return (
    <div
      onClick={onToggle}
      className="flex min-w-[760px] items-center gap-2 px-4 py-3 border-b border-trace-border bg-trace-accent/[0.04] cursor-pointer transition-colors hover:bg-trace-accent/[0.08]"
    >
      <div className="w-6 shrink-0 flex items-center justify-center">
        <ChevronRight
          size={14}
          className={`text-trace-muted transition-transform ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
      </div>
      <span className="w-[80px] text-trace-muted text-[11px] shrink-0">
        {formatTime(runGroup.earliestStart)}
      </span>
      <span className="flex-1 min-w-0 text-trace-text font-medium truncate">
        {truncate(extractQueryTitle(runGroup.query).title, 50)}
      </span>
      <span className="w-[80px] shrink-0">
        <Badge
          variant={
            outcomeClass(runGroup.overallOutcome) as
              | "completed"
              | "stopped"
              | "error"
              | "max_turns"
          }
        >
          {runGroup.overallOutcome}
        </Badge>
      </span>
      <span className="w-[50px] text-trace-subtle text-right shrink-0">
        {runGroup.totalTurns}
      </span>
      <span className="w-[65px] text-trace-subtle font-mono text-right shrink-0">
        {cost || "-"}
      </span>
      <span className="w-[70px] text-trace-muted text-right shrink-0">
        {duration}
      </span>
      <Tooltip content={`Run ID: ${runGroup.runId}`}>
        <span className="w-[100px] text-trace-accent-light text-[10px] font-mono truncate shrink-0 cursor-help">
          {runGroup.shortId}
        </span>
      </Tooltip>
    </div>
  );
}

function SessionRow({
  session,
  isNested,
  onClick,
}: {
  session: TraceSession;
  isNested: boolean;
  onClick: () => void;
}) {
  const cost = session.metrics?.totalCost
    ? formatCost(session.metrics.totalCost)
    : "";
  const duration = formatDuration(
    (session.endTime || 0) - (session.startTime || 0),
  );
  const runId = (session as any).runId;

  return (
    <div
      onClick={onClick}
      className={`flex min-w-[760px] items-center gap-2 px-4 py-2.5 border-b border-trace-border/50 cursor-pointer transition-colors hover:bg-trace-accent/[0.06] text-[12px] ${
        isNested ? "bg-trace-bg/50" : ""
      }`}
    >
      <div className="w-6 shrink-0"></div>
      <span className="w-[80px] text-trace-muted text-[11px] shrink-0">
        {formatTime(session.startTime)}
      </span>
      <span className="flex-1 min-w-0 text-trace-text truncate">
        {truncate(extractQueryTitle(session.query).title, 50)}
      </span>
      <span className="w-[80px] shrink-0">
        <Badge
          variant={
            outcomeClass(session.outcome) as
              | "completed"
              | "stopped"
              | "error"
              | "max_turns"
          }
        >
          {session.outcome}
        </Badge>
      </span>
      <span className="w-[50px] text-trace-subtle text-right shrink-0">
        {session.turnCount || 0}
      </span>
      <span className="w-[65px] text-trace-subtle font-mono text-right shrink-0">
        {cost || "-"}
      </span>
      <span className="w-[70px] text-trace-muted text-right shrink-0">
        {duration}
      </span>
      <Tooltip
        content={
          runId ? `Part of run: ${runId.slice(0, 8)}...` : "Standalone session"
        }
      >
        <span className="w-[100px] text-trace-muted text-[10px] truncate shrink-0 cursor-help">
          {runId ? runId.slice(0, 8) : "—"}
        </span>
      </Tooltip>
    </div>
  );
}
