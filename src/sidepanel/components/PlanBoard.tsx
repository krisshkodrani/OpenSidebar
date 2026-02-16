import React, { useMemo } from "react";
import { CheckCircle2, Circle, Loader2, SkipForward, XCircle, RotateCcw } from "lucide-react";
import { useStore } from "../store";
import { buildRecoveryHint, derivePlanRows, PlanRowStatus } from "../plan-board-view";
import { MessageSource } from "../../types";
import { logger } from "../../utils";

function StatusIcon({ status }: { status: PlanRowStatus }) {
  if (status === "completed") {
    return <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />;
  }
  if (status === "running") {
    return <Loader2 size={12} className="text-sky-500 animate-spin shrink-0" />;
  }
  if (status === "failed") {
    return <XCircle size={12} className="text-red-500 shrink-0" />;
  }
  if (status === "skipped") {
    return <SkipForward size={12} className="text-warm-400 shrink-0" />;
  }
  return <Circle size={12} className="text-warm-300 dark:text-warm-600 shrink-0" />;
}

export function PlanBoard() {
  const taskProgress = useStore((s) => s.taskProgress);
  const taskCompletion = useStore((s) => s.taskCompletion);
  const taskRecovery = useStore((s) => s.taskRecovery);
  const setInputText = useStore((s) => s.setInputText);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);

  const rows = useMemo(
    () => derivePlanRows(taskProgress, taskCompletion),
    [taskProgress, taskCompletion],
  );

  if (rows.length === 0 && !taskRecovery) return null;

  const canSkipCurrent = !!taskProgress && rows.some((row) => row.status === "running");

  const skipCurrentSubtask = async () => {
    if (!taskProgress) return;
    try {
      await chrome.runtime.sendMessage({
        type: "SKIP_SUBTASK",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        workspaceId: activeWorkspaceId,
        payload: {
          taskId: taskProgress.taskId,
        },
      });
    } catch (error) {
      logger.error("ui", "Failed to send skip subtask request", { error });
    }
  };

  return (
    <section className="mx-3 mt-2 rounded-lg border border-warm-200 dark:border-warm-700 bg-warm-50/90 dark:bg-warm-800/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-600 dark:text-warm-300">
          Plan Board
        </h3>
        <div className="flex items-center gap-1.5">
          {canSkipCurrent && (
            <button
              onClick={() => void skipCurrentSubtask()}
              className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
            >
              <SkipForward size={10} />
              Skip Current
            </button>
          )}
          {taskRecovery && (
            <button
              onClick={() => setInputText(buildRecoveryHint(taskRecovery))}
              className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-300 dark:hover:bg-violet-900/30"
            >
              <RotateCcw size={10} />
              Inject Resume Hint
            </button>
          )}
        </div>
      </div>

      {taskRecovery && (
        <div className="mt-2 rounded border border-violet-200 bg-violet-50/70 px-2 py-1.5 text-[11px] text-violet-700 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-300">
          Recovered from checkpoint: {taskRecovery.completedSubtasks}/{taskRecovery.totalSubtasks} completed,{" "}
          {taskRecovery.pendingSubtasks} pending.
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
          {rows.map((row) => (
            <div
              key={row.id}
              className="rounded border border-warm-200 dark:border-warm-700 px-2 py-1.5"
            >
              <div className="flex items-center gap-1.5 text-xs">
                <StatusIcon status={row.status} />
                <span className="truncate text-warm-800 dark:text-warm-100">
                  {row.description}
                </span>
                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-warm-500 dark:text-warm-400">
                  {row.turnsUsed}
                  {typeof row.turnBudget === "number" && row.turnBudget > 0
                    ? `/${row.turnBudget}`
                    : ""}{" "}
                  turns
                </span>
              </div>
              {row.evidenceSnippet && (
                <div className="mt-1 pl-4 text-[10px] text-warm-500 dark:text-warm-400 line-clamp-2">
                  {row.evidenceSnippet}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
