import React from "react";

interface ProgressState {
  staleTurns?: number;
  stagnantTurns?: number;
  signal?: string | null;
}

interface TurnProgressStateProps {
  progressState: ProgressState;
}

export default function TurnProgressState({
  progressState,
}: TurnProgressStateProps) {
  return (
    <div className="text-[10px] text-trace-subtle pt-1.5 border-t border-trace-accent/[0.12] mt-2 flex gap-3">
      <span
        className={
          ((progressState.staleTurns ?? progressState.stagnantTurns) || 0) > 4
            ? "text-state-warning"
            : ""
        }
      >
        Stale turns:{" "}
        {(progressState.staleTurns ?? progressState.stagnantTurns) || 0}
      </span>
      {progressState.signal && (
        <span className="text-state-warning">Signal: {progressState.signal}</span>
      )}
    </div>
  );
}
