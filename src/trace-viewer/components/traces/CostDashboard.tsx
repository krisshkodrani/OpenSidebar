import React from "react";
import type { TraceSession } from "../../../types/traces";
import { formatCost } from "../../utils";

interface CostDashboardProps {
  sessions: TraceSession[];
}

export default function CostDashboard({ sessions }: CostDashboardProps) {
  if (sessions.length === 0) return null;

  let totalCost = 0;
  let totalTurns = 0;
  const outcomes: Record<string, number> = {};

  for (const s of sessions) {
    totalTurns += s.turnCount || 0;
    const cost = s.metrics?.totalCost ?? 0;
    totalCost += cost;
    const o = s.outcome || "unknown";
    outcomes[o] = (outcomes[o] || 0) + 1;
  }

  const avgCost = sessions.length > 0 ? totalCost / sessions.length : 0;

  const outcomeColors: Record<string, string> = {
    completed: "bg-green-500/20 text-[#2ecc71] border-green-500/30",
    stopped: "bg-yellow-500/20 text-[#f1c40f] border-yellow-500/30",
    error: "bg-red-500/20 text-[#e74c3c] border-red-500/30",
    max_turns: "bg-orange-500/20 text-[#e67e22] border-orange-500/30",
  };

  return (
    <div className="px-3 py-2 border-b border-trace-border bg-[rgba(15,52,96,0.2)] shrink-0">
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <span className="text-trace-muted">
          <span className="font-semibold text-trace-subtle">{sessions.length}</span> sessions
        </span>
        <span className="text-trace-muted">
          <span className="font-semibold text-trace-subtle">{totalTurns}</span> turns
        </span>
        {totalCost > 0 && (
          <span className="text-trace-muted">
            Total: <span className="font-semibold text-trace-subtle font-mono">{formatCost(totalCost)}</span>
          </span>
        )}
        {avgCost > 0 && (
          <span className="text-trace-muted">
            Avg: <span className="font-mono">{formatCost(avgCost)}</span>/session
          </span>
        )}
        <div className="flex gap-1 ml-auto">
          {Object.entries(outcomes).map(([outcome, count]) => (
            <span
              key={outcome}
              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${outcomeColors[outcome] || "bg-gray-500/20 text-[#95a5a6] border-gray-500/30"}`}
            >
              {outcome} {count}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
