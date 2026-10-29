import React from "react";
import { RotateCcw } from "lucide-react";
import type { TaskRecoveryState } from "../../../types";

export function PlanRecoveryBanner({
  onResume,
  recovery,
}: {
  onResume: () => void;
  recovery: TaskRecoveryState;
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5 rounded border border-accent/30 bg-accent-subtle px-2 py-1.5 text-ui-caption text-accent-text">
      <span>
        Recovered: {recovery.completedSubtasks}/{recovery.totalSubtasks} done,{" "}
        {recovery.pendingSubtasks} pending
      </span>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onResume();
        }}
        className="ml-auto inline-flex items-center gap-0.5 text-ui-caption font-medium text-accent-text transition-colors"
      >
        <RotateCcw size={9} />
        Resume
      </button>
    </div>
  );
}
