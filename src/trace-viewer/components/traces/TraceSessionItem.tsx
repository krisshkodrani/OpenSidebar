import React from "react";
import Badge from "../Badge";
import { outcomeClass, shortModel, formatTime, formatCost, truncate } from "../../utils";

interface TraceSessionItemProps {
  session: Record<string, unknown>;
  isActive: boolean;
  onClick: () => void;
}

export default function TraceSessionItem({
  session,
  isActive,
  onClick,
}: TraceSessionItemProps) {
  const metrics = session.metrics as Record<string, unknown> | undefined;
  let cost = "";
  if (metrics?.totalCost) cost = formatCost(metrics.totalCost as number);
  else if (session.totalCost) cost = formatCost(session.totalCost as number);

  let models: string[] = [];
  if (Array.isArray(session.models)) models = session.models as string[];
  else if (metrics?.modelBreakdown)
    models = Object.keys(metrics.modelBreakdown as Record<string, unknown>);

  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 border-b border-[rgba(15,52,96,0.4)] cursor-pointer transition-colors ${
        isActive ? "bg-trace-border" : "hover:bg-[rgba(15,52,96,0.5)]"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] text-trace-muted shrink-0">
          {formatTime(session.startTime as number)}
        </span>
        <Badge variant={outcomeClass(session.outcome as string) as "completed" | "stopped" | "error" | "max_turns"}>
          {session.outcome as string}
        </Badge>
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <span className="text-[11px] text-trace-subtle">
            {(session.turnCount as number) || 0} turns
          </span>
          {cost && (
            <span className="text-[11px] text-trace-subtle font-mono">{cost}</span>
          )}
        </div>
      </div>
      <div className="text-[13px] text-[#c0c0d8] leading-snug overflow-hidden text-ellipsis whitespace-nowrap">
        {truncate(session.query as string, 60)}
      </div>
      {models.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {models.map((m, i) => (
            <Badge key={i} variant={m === "manual" ? "manual" : m === "recording" ? "recording" : "model"}>
              {shortModel(m)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
