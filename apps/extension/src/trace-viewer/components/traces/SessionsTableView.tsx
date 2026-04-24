import React, { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "../../store";
import type { TraceSession } from "../../../types/traces";
import Badge from "../Badge";
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
  { key: "startTime", label: "Time", width: "w-[90px]" },
  { key: "query", label: "Query", width: "flex-1 min-w-0" },
  { key: "outcome", label: "Outcome", width: "w-[90px]" },
  { key: "turnCount", label: "Turns", width: "w-[55px]" },
  { key: "cost", label: "Cost", width: "w-[70px]" },
  { key: "duration", label: "Duration", width: "w-[75px]" },
  { key: "models", label: "Model", width: "w-[120px]" },
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
        cmp =
          (a.metrics?.totalCost ?? 0) - (b.metrics?.totalCost ?? 0);
        break;
      case "duration":
        cmp =
          ((a.endTime || 0) - (a.startTime || 0)) -
          ((b.endTime || 0) - (b.startTime || 0));
        break;
      default:
        cmp = 0;
    }
    return direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}

interface SessionsTableViewProps {
  onSelect: (sessionId: string) => void;
}

export default function SessionsTableView({ onSelect }: SessionsTableViewProps) {
  const sessions = useStore((s) => s.sessions);
  const tracesLoading = useStore((s) => s.tracesLoading);
  const tableSort = useStore((s) => s.tableSort);
  const compareSessionIds = useStore((s) => s.compareSessionIds);
  const toggleCompareSession = useStore((s) => s.toggleCompareSession);
  const setTableSort = useStore((s) => s.setTableSort);

  const sorted = useMemo(
    () => sortSessions(sessions, tableSort.column, tableSort.direction),
    [sessions, tableSort],
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sorted.length,
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
        No sessions found. Adjust filters in the Sessions tab.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 text-[10px] font-semibold text-trace-muted uppercase tracking-wider border-b border-trace-border bg-trace-bg shrink-0">
        {COLUMNS.map((col) => (
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
                {tableSort.direction === "asc" ? "\u25B2" : "\u25BC"}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Rows */}
      <div ref={parentRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const session = sorted[virtualRow.index];
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
                <TableRow
                  session={session}
                  isCompared={compareSessionIds.includes(session.sessionId)}
                  onToggleCompare={() => toggleCompareSession(session.sessionId)}
                  onClick={() => onSelect(session.sessionId)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-1.5 text-[10px] text-trace-muted border-t border-trace-border/50 shrink-0">
        {sorted.length} sessions
      </div>
    </div>
  );
}

function TableRow({
  session,
  isCompared,
  onToggleCompare,
  onClick,
}: {
  session: TraceSession;
  isCompared: boolean;
  onToggleCompare: () => void;
  onClick: () => void;
}) {
  const cost = session.metrics?.totalCost
    ? formatCost(session.metrics.totalCost)
    : "";
  const duration = formatDuration(
    (session.endTime || 0) - (session.startTime || 0),
  );
  const models = getSessionModels(session).map(shortModel).join(", ");
  const title = extractQueryTitle(session.query).title;

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2.5 border-b border-trace-border/50 cursor-pointer transition-colors hover:bg-trace-accent/[0.06] text-[12px]"
    >
      <span className="w-[90px] text-trace-muted text-[11px] shrink-0">
        {formatTime(session.startTime)}
      </span>
      <span className="flex-1 min-w-0 text-trace-text truncate">
        {truncate(title, 50)}
      </span>
      <span className="w-[90px] shrink-0">
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
      <span className="w-[55px] text-trace-subtle text-right shrink-0">
        {session.turnCount || 0}
      </span>
      <span className="w-[70px] text-trace-subtle font-mono text-right shrink-0">
        {cost || "-"}
      </span>
      <span className="w-[75px] text-trace-muted text-right shrink-0">
        {duration}
      </span>
      <span className="w-[120px] text-trace-muted text-[10px] truncate shrink-0">
        {models || "-"}
      </span>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onToggleCompare();
        }}
        className={`shrink-0 text-[10px] rounded border px-2 py-1 transition-colors ${
          isCompared
            ? "border-trace-accent/40 text-trace-accent-light bg-trace-accent/10"
            : "border-trace-border text-trace-muted hover:text-trace-text"
        }`}
      >
        {isCompared ? "Queued" : "Compare"}
      </button>
    </div>
  );
}
