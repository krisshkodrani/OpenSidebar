import React, { useState } from "react";
import type { RunGroup } from "../../store/types";
import { useStore } from "../../store";
import Badge from "../Badge";
import {
  outcomeClass,
  formatTime,
  formatCost,
  formatDuration,
  truncate,
  extractQueryTitle,
} from "../../utils";

interface RunGroupHeaderProps {
  group: RunGroup;
  onToggle: () => void;
}

const OUTCOME_BORDER: Record<string, string> = {
  completed: "border-l-[3px] border-l-green-500/60",
  success: "border-l-[3px] border-l-green-500/60",
  stopped: "border-l-[3px] border-l-yellow-500/60",
  error: "border-l-[3px] border-l-red-500/60",
  failure: "border-l-[3px] border-l-red-500/60",
  max_turns: "border-l-[3px] border-l-orange-500/60",
};

export default function RunGroupHeader({
  group,
  onToggle,
}: RunGroupHeaderProps) {
  const [copied, setCopied] = useState(false);
  const setFilter = useStore((s) => s.setFilter);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(group.shortId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const handleFilter = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFilter("runId", group.runId);
  };

  const borderCls =
    OUTCOME_BORDER[group.overallOutcome] ??
    "border-l-[3px] border-l-transparent";
  const duration = formatDuration(group.latestEnd - group.earliestStart);
  const cost = group.totalCost ? formatCost(group.totalCost) : "";
  const queryTitle = extractQueryTitle(group.query).title;

  return (
    <div
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      tabIndex={0}
      role="option"
      aria-selected={false}
      className={`px-4 py-3 border-b border-[rgba(68,64,60,0.4)] cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-trace-accent border-t-2 border-t-trace-accent/40 bg-[rgba(13,148,136,0.06)] hover:bg-[rgba(13,148,136,0.12)] ${borderCls}`}
    >
      {/* Row 1: chevron + RUN label + run ID + outcome + stats */}
      <div className="flex items-center gap-2 mb-1">
        <svg
          className={`w-3.5 h-3.5 text-trace-accent-light transition-transform duration-200 shrink-0 ${group.expanded ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
        <span className="text-[9px] font-bold uppercase tracking-widest text-trace-accent shrink-0">
          Run
        </span>
        <button
          onClick={handleCopy}
          title="Copy run ID"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-trace-bg border border-trace-border text-[10px] font-mono text-trace-accent-light hover:border-trace-accent transition-colors"
        >
          {group.shortId}
          <span className="text-[9px] text-trace-muted">
            {copied ? "\u2713" : "\u2398"}
          </span>
        </button>
        <button
          onClick={handleFilter}
          title="Filter to this run"
          className="p-0.5 text-trace-muted hover:text-trace-accent-light transition-colors"
        >
          <svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </button>
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
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <span
            className={`text-[10px] ${group.sessions.length === 1 ? "text-trace-dim" : "text-trace-subtle"}`}
          >
            {group.sessions.length}{" "}
            {group.sessions.length === 1 ? "session" : "sessions"}
          </span>
          <span className="text-trace-dim text-[10px]">&middot;</span>
          <span className="text-[10px] text-trace-subtle">
            {group.totalTurns} turns
          </span>
          {cost && (
            <>
              <span className="text-trace-dim text-[10px]">&middot;</span>
              <span className="text-[10px] text-trace-subtle font-mono">
                {cost}
              </span>
            </>
          )}
        </div>
      </div>
      {/* Row 2: query title + time/duration */}
      <div className="flex items-center gap-2">
        <div className="text-[13px] text-[#d6d3cc] leading-snug overflow-hidden text-ellipsis whitespace-nowrap flex-1 pl-[22px]">
          {truncate(queryTitle, 55)}
        </div>
        <span className="text-[10px] text-trace-muted shrink-0">
          {formatTime(group.earliestStart)} &middot; {duration}
        </span>
      </div>
    </div>
  );
}
