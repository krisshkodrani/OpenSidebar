import React from "react";
import Badge from "../Badge";

interface ProgressState {
  staleTurns?: number;
  stagnantTurns?: number;
  signal?: string | null;
}

interface TurnProgressStateProps {
  progressState: ProgressState;
}

const STAGNATION_THRESHOLD = 10;

export default function TurnProgressState({
  progressState,
}: TurnProgressStateProps) {
  const stale = (progressState.staleTurns ?? progressState.stagnantTurns) || 0;
  const pct = Math.min((stale / STAGNATION_THRESHOLD) * 100, 100);
  const barColor =
    stale > 7
      ? "bg-state-error"
      : stale >= 4
        ? "bg-state-warning"
        : "bg-state-success";

  return (
    <div className="text-[10px] text-trace-subtle pt-1.5 border-t border-trace-accent/[0.12] mt-2 flex items-center gap-3 flex-wrap">
      <span className="flex items-center gap-1.5">
        <span className={stale > 4 ? "text-state-warning" : ""}>
          Stale turns: {stale}
        </span>
        <span className="inline-flex items-center">
          <span className="w-16 h-1.5 bg-trace-border rounded-full overflow-hidden">
            <span
              className={`block h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
      </span>
      {progressState.signal && (
        <Badge variant={`event-stuck_signal` as `event-${string}`}>
          {progressState.signal}
        </Badge>
      )}
    </div>
  );
}
