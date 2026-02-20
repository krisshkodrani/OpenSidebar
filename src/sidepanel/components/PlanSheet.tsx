import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  SkipForward,
  XCircle,
  RotateCcw,
  ChevronDown,
  X,
} from "lucide-react";
import { useStore } from "../store";
import {
  buildRecoveryHint,
  derivePlanRows,
  PlanRowStatus,
} from "../plan-board-view";
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
  return (
    <Circle size={12} className="text-warm-300 dark:text-warm-600 shrink-0" />
  );
}

export function PlanSheet() {
  const showPlanBoard = useStore((s) => s.showPlanBoard);
  const togglePlanBoard = useStore((s) => s.togglePlanBoard);
  const taskProgress = useStore((s) => s.taskProgress);
  const taskCompletion = useStore((s) => s.taskCompletion);
  const taskRecovery = useStore((s) => s.taskRecovery);
  const setInputText = useStore((s) => s.setInputText);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const [showSystemDetails, setShowSystemDetails] = useState(false);

  // Orchestrator-like system details
  const turnProgress = useStore((s) => s.turnProgress);
  const laneTelemetry = useStore((s) => s.laneTelemetry);

  const rows = useMemo(
    () => derivePlanRows(taskProgress, taskCompletion),
    [taskProgress, taskCompletion],
  );

  if (!showPlanBoard) return null;
  if (rows.length === 0 && !taskRecovery) return null;

  const canSkipCurrent =
    !!taskProgress && rows.some((row) => row.status === "running");

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
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/10 dark:bg-black/30 z-30 backdrop-enter"
        onClick={togglePlanBoard}
      />

      {/* Sheet */}
      <div className="absolute bottom-0 left-0 right-0 z-40 max-h-[55%] flex flex-col bg-warm-50 dark:bg-warm-900 border-t border-warm-200 dark:border-warm-800 rounded-t-xl shadow-xl plan-sheet-enter">
        {/* Drag handle */}
        <div className="flex justify-center py-1.5">
          <div className="w-8 h-1 rounded-full bg-warm-300 dark:bg-warm-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-3 pb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-600 dark:text-warm-300">
            Plan
          </h3>
          <div className="flex items-center gap-1.5">
            {canSkipCurrent && (
              <button
                onClick={() => void skipCurrentSubtask()}
                className="inline-flex items-center gap-1 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
              >
                <SkipForward size={10} />
                Skip
              </button>
            )}
            {taskRecovery && (
              <button
                onClick={() => {
                  setInputText(buildRecoveryHint(taskRecovery));
                  togglePlanBoard();
                }}
                className="inline-flex items-center gap-1 rounded border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 px-2 py-1 text-[10px] font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
              >
                <RotateCcw size={10} />
                Resume
              </button>
            )}
            <button
              onClick={togglePlanBoard}
              className="p-1 rounded hover:bg-warm-100 dark:hover:bg-warm-800 text-warm-400 hover:text-warm-600 dark:hover:text-warm-300 transition-colors"
              aria-label="Close plan"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Recovery info */}
        {taskRecovery && (
          <div className="mx-3 mb-2 rounded border border-violet-200 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-900/20 px-2 py-1.5 text-[11px] text-violet-700 dark:text-violet-300">
            Recovered: {taskRecovery.completedSubtasks}/
            {taskRecovery.totalSubtasks} done, {taskRecovery.pendingSubtasks}{" "}
            pending
          </div>
        )}

        {/* Subtask list */}
        <div className="flex-1 overflow-y-auto px-3 pb-2 space-y-1">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-1.5 text-xs py-1.5 px-2 rounded border border-warm-200/60 dark:border-warm-700/60"
            >
              <StatusIcon status={row.status} />
              <span className="text-warm-800 dark:text-warm-100 flex-1 min-w-0 truncate">
                {row.description}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-warm-400 dark:text-warm-500">
                {row.status === "running"
                  ? "running"
                  : row.status === "pending"
                    ? "pending"
                    : `${row.turnsUsed} turns`}
              </span>
            </div>
          ))}
        </div>

        {/* System Details collapsible */}
        <div className="border-t border-warm-200/60 dark:border-warm-700/60 px-3 py-2">
          <button
            onClick={() => setShowSystemDetails((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-warm-500 dark:text-warm-400 hover:text-warm-700 dark:hover:text-warm-200 transition-colors"
          >
            <ChevronDown
              size={12}
              className={`transition-transform ${showSystemDetails ? "" : "-rotate-90"}`}
            />
            System Details
          </button>
          {showSystemDetails && (
            <div className="mt-1.5 text-[10px] text-warm-500 dark:text-warm-400 space-y-1">
              {turnProgress && (
                <div className="flex items-center gap-2">
                  <span>
                    Turn: {turnProgress.turn}/{turnProgress.maxTurns}
                  </span>
                  {turnProgress.provider && (
                    <span>Provider: {turnProgress.provider}</span>
                  )}
                </div>
              )}
              {laneTelemetry && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span>
                    Total tokens:{" "}
                    {laneTelemetry.totalTokensUsed?.toLocaleString()}
                  </span>
                </div>
              )}
              {!turnProgress && !laneTelemetry && (
                <span>No system data available</span>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
