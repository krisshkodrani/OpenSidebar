import React from "react";
import { ChevronRight } from "lucide-react";
import type { TraceSession } from "../../../types/traces";
import { useStore } from "../../store";
import Badge from "../Badge";
import {
  extractQueryTitle,
  formatCost,
  formatDuration,
  formatTime,
  getSessionModels,
  outcomeClass,
  shortModel,
  truncate,
} from "../../utils";

interface RunsTableViewProps {
  onSelectSession: (sessionId: string) => void;
}

export default function RunsTableView({ onSelectSession }: RunsTableViewProps) {
  const runGroups = useStore((s) => s.runGroups);
  const tracesLoading = useStore((s) => s.tracesLoading);
  const sessions = useStore((s) => s.sessions);
  const setTraceListMode = useStore((s) => s.setTraceListMode);
  const expandAllRunGroups = useStore((s) => s.expandAllRunGroups);
  const collapseAllRunGroups = useStore((s) => s.collapseAllRunGroups);
  const toggleRunGroup = useStore((s) => s.toggleRunGroup);

  if (tracesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-trace-muted text-sm">
        Loading runs...
      </div>
    );
  }

  if (runGroups.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center text-trace-muted text-sm">
        <div>
          No trace runs found for the current filters.
          {sessions.length > 0
            ? " These traces are still available as sessions."
            : ""}
        </div>
        {sessions.length > 0 && (
          <button
            type="button"
            onClick={() => setTraceListMode("sessions")}
            className="rounded border border-trace-border px-3 py-1.5 text-xs text-trace-subtle hover:text-trace-text hover:border-trace-accent/50 transition-colors"
          >
            View sessions
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-2 border-b border-trace-border bg-trace-bg shrink-0">
        <button
          onClick={expandAllRunGroups}
          className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
        >
          Expand all
        </button>
        <button
          onClick={collapseAllRunGroups}
          className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
        >
          Collapse all
        </button>
        <span className="ml-auto text-[10px] text-trace-dim">
          {runGroups.length} runs
        </span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {runGroups.map((group) => (
          <div key={group.runId} className="border-b border-trace-border/50">
            <button
              onClick={() => toggleRunGroup(group.runId)}
              className="w-full text-left px-5 py-3 hover:bg-trace-accent/[0.05] transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-trace-muted text-xs shrink-0">
                  <ChevronRight
                    size={14}
                    className={`transition-transform ${group.expanded ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                </span>
                <span className="text-[11px] text-trace-muted shrink-0">
                  {formatTime(group.earliestStart)}
                </span>
                <span className="font-mono text-[11px] text-trace-accent-light shrink-0">
                  {group.shortId}
                </span>
                <span className="min-w-0 flex-1 text-[12px] text-trace-text">
                  {truncate(extractQueryTitle(group.query).title, 80)}
                </span>
                <Badge
                  variant={
                    outcomeClass(group.overallOutcome) as
                      | "completed"
                      | "stopped"
                      | "error"
                      | "max_turns"
                  }
                >
                  {group.overallOutcome}
                </Badge>
                <span className="text-[11px] text-trace-muted shrink-0">
                  {group.sessions.length} sessions
                </span>
                <span className="text-[11px] text-trace-muted shrink-0">
                  {group.totalTurns} turns
                </span>
                <span className="text-[11px] text-trace-muted shrink-0">
                  {formatDuration(group.latestEnd - group.earliestStart)}
                </span>
                <span className="text-[11px] text-trace-subtle font-mono shrink-0">
                  {formatCost(group.totalCost) || "$0"}
                </span>
              </div>
            </button>
            {group.expanded && (
              <div className="pb-2">
                {group.sessions.map((session) => (
                  <RunSessionRow
                    key={session.sessionId}
                    session={session}
                    onSelect={() => onSelectSession(session.sessionId)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RunSessionRow({
  session,
  onSelect,
}: {
  session: TraceSession;
  onSelect: () => void;
}) {
  const models = getSessionModels(session).map(shortModel).join(", ");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className="w-full text-left ml-11 mr-5 px-4 py-2 rounded border border-transparent hover:border-trace-accent/20 hover:bg-trace-accent/[0.05] transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-trace-dim shrink-0">
          {formatTime(session.startTime)}
        </span>
        <span className="font-mono text-[10px] text-trace-muted shrink-0">
          {session.sessionId.slice(0, 8)}
        </span>
        <span className="min-w-0 flex-1 text-[12px] text-trace-subtle">
          {truncate(extractQueryTitle(session.query).title, 64)}
        </span>
        <span className="text-[10px] text-trace-muted shrink-0">
          {models || "-"}
        </span>
      </div>
    </div>
  );
}
