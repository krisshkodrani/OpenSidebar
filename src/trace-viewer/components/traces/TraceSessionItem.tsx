import React from "react";
import type { TraceSession } from "../../../types/traces";
import Badge from "../Badge";
import {
  outcomeClass,
  shortModel,
  formatTime,
  formatCost,
  truncate,
} from "../../utils";

interface TraceSessionItemProps {
  session: TraceSession;
  isActive: boolean;
  onClick: () => void;
}

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

  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 border-b border-[rgba(15,52,96,0.4)] cursor-pointer transition-colors ${
        isActive ? "bg-trace-border" : "hover:bg-[rgba(15,52,96,0.5)]"
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
      <div className="text-[13px] text-[#c0c0d8] leading-snug overflow-hidden text-ellipsis whitespace-nowrap">
        {truncate(session.query, 60)}
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
