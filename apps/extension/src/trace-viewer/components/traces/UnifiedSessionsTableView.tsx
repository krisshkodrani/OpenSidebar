import React, { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "../../store";
import type { TraceSession } from "../../../types/traces";
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
  { key: "startTime", label: "Time", width: "w-[75px]", sortable: true },
  {
    key: "query",
    label: "Query",
    width: "flex-1 min-w-[200px]",
    sortable: true,
  },
  { key: "outcome", label: "Outcome", width: "w-[75px]", sortable: true },
  { key: "turnCount", label: "Turns", width: "w-[45px]", sortable: true },
  { key: "model", label: "Model", width: "w-[85px]", sortable: false },
  { key: "cost", label: "Est. Cost", width: "w-[65px]", sortable: true },
  { key: "duration", label: "Duration", width: "w-[60px]", sortable: true },
  { key: "runId", label: "Run", width: "w-[80px]", sortable: false },
] as const;

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
  const tracesLoading = useStore((s) => s.tracesLoading);
  const tableSort = useStore((s) => s.tableSort);
  const setTableSort = useStore((s) => s.setTableSort);

  const sortedSessions = useMemo(
    () => sortSessions(sessions, tableSort.column, tableSort.direction),
    [sessions, tableSort],
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sortedSessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
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

  // Count unique runs
  const uniqueRuns = new Set(
    sessions.map((s) => (s as any).runId).filter(Boolean),
  );

  return (
    <div className="flex-1 flex flex-col overflow-x-auto overflow-y-hidden">
      {/* Header */}
      <div className="flex min-w-[700px] items-center gap-2 px-4 py-2 text-[10px] font-semibold text-trace-muted uppercase tracking-wider border-b border-trace-border bg-trace-bg shrink-0">
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
        className="min-w-[700px] flex-1 overflow-y-auto scrollbar-thin"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const session = sortedSessions[virtualRow.index];
            return (
              <div
                key={session.sessionId}
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
                <SessionRow
                  session={session}
                  onClick={() => onSelect(session.sessionId)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-1.5 text-[10px] text-trace-muted border-t border-trace-border/50 shrink-0">
        {sessions.length} sessions
        {uniqueRuns.size > 0 && ` · ${uniqueRuns.size} runs`}
      </div>
    </div>
  );
}

function SessionRow({
  session,
  onClick,
}: {
  session: TraceSession;
  onClick: () => void;
}) {
  const cost = session.metrics?.totalCost
    ? formatCost(session.metrics.totalCost)
    : "";
  const duration = formatDuration(
    (session.endTime || 0) - (session.startTime || 0),
  );
  const runId = (session as any).runId as string | undefined;
  const models = session.models || [];
  const modelDisplay = models.length > 0 ? shortModel(models[0]) : "—";
  const hasMultipleModels = models.length > 1;

  return (
    <div
      onClick={onClick}
      className="flex min-w-[700px] items-center gap-2 px-4 py-2.5 border-b border-trace-border/50 cursor-pointer transition-colors hover:bg-trace-accent/[0.06] text-[12px]"
    >
      <span className="w-[75px] text-trace-muted text-[11px] shrink-0">
        {formatTime(session.startTime)}
      </span>
      <span className="flex-1 min-w-0 text-trace-text truncate">
        {truncate(extractQueryTitle(session.query).title, 50)}
      </span>
      <span className="w-[75px] shrink-0">
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
      <span className="w-[45px] text-trace-subtle text-right shrink-0">
        {session.turnCount || 0}
      </span>
      <Tooltip
        content={
          hasMultipleModels
            ? `Models: ${models.map(shortModel).join(", ")}`
            : "Model used for this session"
        }
      >
        <span className="w-[85px] text-trace-subtle text-[10px] truncate shrink-0 cursor-help">
          {modelDisplay}
          {hasMultipleModels ? ` (+${models.length - 1})` : ""}
        </span>
      </Tooltip>
      <span className="w-[65px] text-trace-subtle font-mono text-right shrink-0">
        {cost || "-"}
      </span>
      <span className="w-[60px] text-trace-muted text-right shrink-0">
        {duration}
      </span>
      <Tooltip
        content={
          runId
            ? `Part of run: ${runId}`
            : "Standalone session (not part of a run)"
        }
      >
        <span className="w-[80px] text-trace-accent-light text-[10px] font-mono truncate shrink-0 cursor-help">
          {runId ? runId.slice(0, 8) : "—"}
        </span>
      </Tooltip>
    </div>
  );
}
