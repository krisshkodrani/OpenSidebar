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
    <div className="mb-2 flex items-center gap-1.5 rounded border border-primary-200 bg-primary-50/70 px-2 py-1.5 text-[11px] text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-300">
      <span>
        Recovered: {recovery.completedSubtasks}/{recovery.totalSubtasks} done,{" "}
        {recovery.pendingSubtasks} pending
      </span>
      <button
        onClick={(event) => {
          event.stopPropagation();
          onResume();
        }}
        className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium text-primary-600 transition-colors hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-100"
      >
        <RotateCcw size={9} />
        Resume
      </button>
    </div>
  );
}
