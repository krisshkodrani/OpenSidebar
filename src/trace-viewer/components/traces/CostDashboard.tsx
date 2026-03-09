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

  for (const s of sessions) {
    totalTurns += s.turnCount || 0;
    const cost = s.metrics?.totalCost ?? 0;
    totalCost += cost;
  }

  return (
    <div className="px-3 py-2 bg-[#0f0d0a] border-b-2 border-trace-accent/40 shrink-0">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-trace-accent-light">
          Sessions
        </span>
        <span className="text-trace-muted">
          <span className="font-semibold text-trace-subtle">{sessions.length}</span>
        </span>
        <span className="text-trace-dim">&middot;</span>
        <span className="text-trace-muted">
          <span className="font-semibold text-trace-subtle">{totalTurns}</span> turns
        </span>
        {totalCost > 0 && (
          <>
            <span className="text-trace-dim">&middot;</span>
            <span className="text-trace-muted font-mono">
              {formatCost(totalCost)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
