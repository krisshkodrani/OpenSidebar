import React from "react";
import type { TraceSession } from "../../../types/traces";
import Badge from "../Badge";
import {
  outcomeClass,
  shortModel,
  formatTime,
  formatCost,
  extractQueryTitle,
  truncate,
} from "../../utils";

interface TraceSessionItemProps {
  session: TraceSession;
  isActive: boolean;
  onClick: () => void;
}

const OUTCOME_BORDER: Record<string, string> = {
  completed: "border-l-[3px] border-l-green-500/60",
  success: "border-l-[3px] border-l-green-500/60",
  stopped: "border-l-[3px] border-l-yellow-500/60",
  error: "border-l-[3px] border-l-red-500/60",
  failure: "border-l-[3px] border-l-red-500/60",
  max_turns: "border-l-[3px] border-l-orange-500/60",
};

export default function TraceSessionItem({
  session,
  isActive,
  onClick,
}: TraceSessionItemProps) {
  const metrics = session.metrics;
  let cost = "";
  if (metrics?.totalCost) cost = formatCost(metrics.totalCost);

  const models: string[] = metrics?.modelBreakdown
    ? Object.keys(metrics.modelBreakdown)
    : [];

  const borderCls = OUTCOME_BORDER[session.outcome] ?? "border-l-[3px] border-l-transparent";

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      role="option"
      aria-selected={isActive}
      className={`px-4 py-3 border-b border-[rgba(68,64,60,0.4)] cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-trace-accent ${borderCls} ${
        isActive ? "bg-trace-border" : "hover:bg-[rgba(68,64,60,0.5)]"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] text-trace-muted shrink-0">
          {formatTime(session.startTime)}
        </span>
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
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <span className="text-[11px] text-trace-subtle">
            {session.turnCount || 0} turns
          </span>
          {cost && (
            <span className="text-[11px] text-trace-subtle font-mono">
              {cost}
            </span>
          )}
        </div>
      </div>
      <div className="text-[13px] text-[#d6d3cc] leading-snug overflow-hidden text-ellipsis whitespace-nowrap">
        {truncate(extractQueryTitle(session.query).title, 60)}
      </div>
      {models.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {models.map((m, i) => (
            <Badge
              key={i}
              variant={
                m === "manual"
                  ? "manual"
                  : m === "recording"
                    ? "recording"
                    : "model"
              }
            >
              {shortModel(m)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
