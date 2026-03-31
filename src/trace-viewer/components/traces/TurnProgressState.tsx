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
    <div className="text-[10px] text-[#57534e] pt-1.5 border-t border-[rgba(68,64,60,0.3)] mt-2 flex gap-3">
      <span
        className={
          ((progressState.staleTurns ?? progressState.stagnantTurns) || 0) > 4
            ? "text-[#e67e22]"
            : ""
        }
      >
        Stale turns:{" "}
        {(progressState.staleTurns ?? progressState.stagnantTurns) || 0}
      </span>
      {progressState.signal && (
        <span className="text-[#e67e22]">Signal: {progressState.signal}</span>
      )}
    </div>
  );
}
