import React from "react";
import type { RunGroup } from "../../store/types";
import { formatDuration, formatCost } from "../../utils";

interface RunGroupSummaryProps {
  group: RunGroup;
}

const OUTCOME_COLOR: Record<string, string> = {
  completed: "bg-green-500/60",
  success: "bg-green-500/60",
  stopped: "bg-yellow-500/60",
  error: "bg-red-500/60",
  failure: "bg-red-500/60",
  max_turns: "bg-orange-500/60",
};

export default function RunGroupSummary({ group }: RunGroupSummaryProps) {
  const totalSpan = group.latestEnd - group.earliestStart || 1;

  return (
    <div className="ml-4 border-l-2 border-trace-accent/25 pl-3 py-2.5 bg-[rgba(13,148,136,0.05)]">
      {/* Session timeline bar */}
      <div className="flex h-1.5 rounded-full overflow-hidden bg-trace-bg mb-2 gap-px">
        {group.sessions.map((s) => {
          const pct =
            ((s.endTime - s.startTime) / totalSpan) * 100;
          const color =
            OUTCOME_COLOR[s.outcome] ?? "bg-gray-500/60";
          return (
            <div
              key={s.sessionId}
              className={`${color} rounded-full`}
              style={{ width: `${Math.max(pct, 5)}%` }}
              title={`${s.outcome} — ${s.turnCount} turns`}
            />
          );
        })}
      </div>

      {/* Stats row */}
      <div className="flex gap-4 text-[10px] text-trace-muted">
        <span>
          {group.sessions.length}{" "}
          {group.sessions.length === 1 ? "session" : "sessions"}
        </span>
        <span>{group.totalTurns} turns</span>
        <span>{formatDuration(group.latestEnd - group.earliestStart)}</span>
        {group.totalCost > 0 && (
          <span className="font-mono">{formatCost(group.totalCost)}</span>
        )}
      </div>
    </div>
  );
}
