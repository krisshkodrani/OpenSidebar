import React from "react";
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
  const compareSessionIds = useStore((s) => s.compareSessionIds);
  const expandAllRunGroups = useStore((s) => s.expandAllRunGroups);
  const collapseAllRunGroups = useStore((s) => s.collapseAllRunGroups);
  const toggleRunGroup = useStore((s) => s.toggleRunGroup);
  const toggleCompareSession = useStore((s) => s.toggleCompareSession);

  if (tracesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-trace-muted text-sm">
        Loading runs...
      </div>
    );
  }

  if (runGroups.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-trace-dim text-sm">
        No runs found. Switch to Sessions or adjust filters.
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
              className="w-full text-left px-5 py-3 hover:bg-[rgba(124,58,237,0.05)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-trace-muted text-xs">
                  {group.expanded ? "v" : ">"}
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
                    isCompared={compareSessionIds.includes(session.sessionId)}
                    onToggleCompare={() => toggleCompareSession(session.sessionId)}
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
  isCompared,
  onToggleCompare,
  onSelect,
}: {
  session: TraceSession;
  isCompared: boolean;
  onToggleCompare: () => void;
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
      className="w-full text-left ml-11 mr-5 px-4 py-2 rounded border border-transparent hover:border-trace-accent/20 hover:bg-[rgba(124,58,237,0.05)] transition-colors"
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
    </div>
  );
}
