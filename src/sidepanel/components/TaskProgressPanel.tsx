import React from "react";
import { CheckCircle2, Circle, Loader2, XCircle, SkipForward } from "lucide-react";
import { useStore } from "../store";
import type { SubtaskSummary } from "../../types";

function SubtaskIcon({ status }: { status: SubtaskSummary["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 size={12} className="text-green-500 shrink-0" />;
    case "running":
      return <Loader2 size={12} className="text-primary-500 animate-spin shrink-0" />;
    case "failed":
      return <XCircle size={12} className="text-red-500 shrink-0" />;
    case "skipped":
      return <SkipForward size={12} className="text-gray-400 shrink-0" />;
    default:
      return <Circle size={12} className="text-gray-300 dark:text-gray-600 shrink-0" />;
  }
}

export function TaskProgressPanel() {
  const taskProgress = useStore((s) => s.taskProgress);
  const taskCompletion = useStore((s) => s.taskCompletion);

  if (!taskProgress && !taskCompletion) return null;

  // Show completion summary
  if (taskCompletion) {
    const statusColor =
      taskCompletion.status === "completed"
        ? "text-green-600 dark:text-green-400"
        : taskCompletion.status === "partial"
          ? "text-yellow-600 dark:text-yellow-400"
          : "text-red-600 dark:text-red-400";

    return (
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2 text-xs">
          <span className={`font-medium ${statusColor}`}>
            Task {taskCompletion.status}
          </span>
          {taskCompletion.totalTurnsUsed > 0 && (
            <span className="text-gray-400">
              ({taskCompletion.totalTurnsUsed} turns)
            </span>
          )}
        </div>
        {taskCompletion.summary && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
            {taskCompletion.summary}
          </p>
        )}
      </div>
    );
  }

  // Show live progress
  if (!taskProgress) return null;

  const { subtasks, currentIndex, totalTurnsUsed } = taskProgress;

  return (
    <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
        <span className="font-medium">
          Subtask {currentIndex + 1} of {subtasks.length}
        </span>
        {totalTurnsUsed > 0 && <span>{totalTurnsUsed} turns used</span>}
      </div>
      <div className="space-y-1">
        {subtasks.map((st, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <SubtaskIcon status={st.status} />
            <span
              className={`truncate ${
                i === currentIndex
                  ? "text-gray-900 dark:text-gray-100 font-medium"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {st.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
