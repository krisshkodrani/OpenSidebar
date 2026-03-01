import React from "react";

interface ProgressState {
  staleTurns?: number;
  signal?: string;
}

interface TurnProgressStateProps {
  progressState: ProgressState;
}

export default function TurnProgressState({
  progressState,
}: TurnProgressStateProps) {
  return (
    <div className="text-[10px] text-[#5a5a7e] pt-1.5 border-t border-[rgba(15,52,96,0.3)] mt-2 flex gap-3">
      <span
        className={(progressState.staleTurns || 0) > 4 ? "text-[#e67e22]" : ""}
      >
        Stale turns: {progressState.staleTurns || 0}
      </span>
      {progressState.signal && (
        <span className="text-[#e67e22]">Signal: {progressState.signal}</span>
      )}
    </div>
  );
}
