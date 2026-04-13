import React, { useCallback, useMemo, useState } from "react";
import {
  ClipboardList,
  ChevronDown,
  SkipForward,
  RotateCcw,
} from "lucide-react";
import { useStore } from "../store";
import { PlanStepIcon } from "./PlanStepIcon";
import { buildRecoveryHint, derivePlanRows } from "../plan-board-view";
import { MessageSource } from "../../types";
import { logger } from "../../utils";

export function PlanTimelineCard() {
  const pendingPlan = useStore((s) => s.pendingPlanConfirmation);
  const taskProgress = useStore((s) => s.taskProgress);
  const taskCompletion = useStore((s) => s.taskCompletion);
  const taskRecovery = useStore((s) => s.taskRecovery);
  const clearPending = useStore((s) => s.clearPendingPlanConfirmation);
  const setInputText = useStore((s) => s.setInputText);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);

  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const rows = useMemo(
    () => derivePlanRows(taskProgress, taskCompletion),
    [taskProgress, taskCompletion],
  );

  // --- State machine ---
  const mode: "confirmation" | "progress" | "completion" | null = pendingPlan
    ? "confirmation"
    : taskProgress
      ? "progress"
      : taskCompletion
        ? "completion"
        : null;

  // --- Confirmation callbacks ---
  const sendDecision = useCallback(
    async (decision: "approve" | "cancel") => {
      if (!pendingPlan) return;
      try {
        await chrome.runtime.sendMessage({
          type: "PLAN_CONFIRMATION_RESPONSE",
          requestId: crypto.randomUUID(),
          source: MessageSource.SIDEPANEL,
          workspaceId: activeWorkspaceId,
          payload: {
            confirmationId: pendingPlan.confirmationId,
            decision,
            feedback: feedback.trim() || undefined,
          },
        });
      } catch (error) {
        logger.error("ui", "Failed to send plan confirmation", { error });
      } finally {
        clearPending();
        setFeedback("");
        setShowFeedback(false);
      }
    },
    [pendingPlan, clearPending, feedback, activeWorkspaceId],
  );

  // --- Skip callback ---
  const skipCurrentSubtask = useCallback(async () => {
    if (!taskProgress) return;
    try {
      await chrome.runtime.sendMessage({
        type: "SKIP_SUBTASK",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        workspaceId: activeWorkspaceId,
        payload: { taskId: taskProgress.taskId },
      });
    } catch (error) {
      logger.error("ui", "Failed to send skip subtask request", { error });
    }
  }, [taskProgress, activeWorkspaceId]);

  if (!mode) return null;

  // --- Progress bar ---
  const completedCount = rows.filter(
    (r) =>
      r.status === "completed" ||
      r.status === "failed" ||
      r.status === "skipped",
  ).length;
  const progressPct =
    rows.length > 0 ? (completedCount / rows.length) * 100 : 0;
  const canSkip =
    mode === "progress" && rows.some((r) => r.status === "running");

  // --- Border color per mode ---
  const borderClass =
    mode === "confirmation"
      ? "border-blue-200 dark:border-blue-800"
      : mode === "completion"
        ? "border-green-200 dark:border-green-800"
        : "border-warm-200 dark:border-warm-700";

  return (
    <div
      className={`rounded-lg border ${borderClass} bg-warm-50/90 dark:bg-warm-800/60 p-3 message-enter`}
    >
      {/* --- CONFIRMATION --- */}
      {mode === "confirmation" && pendingPlan && (
        <>
          {/* Header */}
          <div className="flex items-center gap-2 mb-2">
            <ClipboardList
              size={14}
              className="shrink-0 text-blue-600 dark:text-blue-400"
            />
            <span className="text-xs font-medium text-blue-800 dark:text-blue-200">
              Plan ready
            </span>
            {pendingPlan.difficulty && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300">
                {pendingPlan.difficulty}
              </span>
            )}
            <span className="text-[10px] text-blue-500 dark:text-blue-400 ml-auto">
              {pendingPlan.nodes.length} steps
            </span>
          </div>

          {/* Vertical timeline */}
          <div className="ml-1 mb-2 max-h-52 overflow-y-auto">
            {pendingPlan.nodes.map((node, i) => (
              <div key={i} className="flex items-start gap-2">
                {/* Connector + number */}
                <div className="flex flex-col items-center">
                  <span className="w-5 h-5 flex items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40 text-[10px] font-medium text-blue-600 dark:text-blue-300 shrink-0">
                    {i + 1}
                  </span>
                  {i < pendingPlan.nodes.length - 1 && (
                    <div className="w-px flex-1 min-h-[12px] bg-blue-200/60 dark:bg-blue-700/40" />
                  )}
                </div>
                {/* Step content */}
                <div className="pb-2 min-w-0 flex-1">
                  <button
                    onClick={() =>
                      setExpandedStep(expandedStep === i ? null : i)
                    }
                    className="text-xs text-left text-blue-800 dark:text-blue-200 leading-relaxed hover:text-blue-600 dark:hover:text-blue-100 transition-colors w-full"
                  >
                    {node.description}
                    {node.successCriteria && (
                      <ChevronDown
                        size={10}
                        className={`inline ml-1 transition-transform ${expandedStep === i ? "" : "-rotate-90"}`}
                      />
                    )}
                  </button>
                  {expandedStep === i && node.successCriteria && (
                    <div className="mt-1 text-[10px] text-blue-500 dark:text-blue-400 italic leading-relaxed">
                      {node.successCriteria}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add guidance */}
          {!showFeedback ? (
            <button
              onClick={() => setShowFeedback(true)}
              className="text-[10px] text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 mb-2 transition-colors"
            >
              + Add guidance
            </button>
          ) : (
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Add guidance or corrections..."
              rows={2}
              className="w-full px-2 py-1.5 mb-2 text-xs border border-blue-200 dark:border-blue-700 rounded-md bg-white dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 placeholder:text-blue-400 dark:placeholder:text-blue-600 outline-none focus:ring-1 focus:ring-blue-400 resize-none"
              autoFocus
            />
          )}

          {/* Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => void sendDecision("cancel")}
              className="flex-1 rounded border border-blue-300 dark:border-blue-700 px-2 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void sendDecision("approve")}
              className="flex-1 rounded bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
            >
              {feedback.trim() ? "Replan & Start" : "Start"}
            </button>
          </div>
        </>
      )}

      {/* --- PROGRESS / COMPLETION --- */}
      {(mode === "progress" || mode === "completion") && rows.length > 0 && (
        <>
          {/* Header */}
          <div className="flex items-center gap-2 mb-2">
            <ClipboardList
              size={14}
              className={`shrink-0 ${mode === "completion" ? "text-green-500" : "text-warm-500 dark:text-warm-400"}`}
            />
            <span className="text-xs font-medium text-warm-800 dark:text-warm-100">
              {mode === "completion"
                ? "Plan complete"
                : `Step ${(taskProgress?.currentIndex ?? 0) + 1} of ${rows.length}`}
            </span>
            {taskProgress && (
              <span className="text-[10px] text-warm-400 dark:text-warm-500 ml-auto tabular-nums">
                {taskProgress.totalTurnsUsed} turns
              </span>
            )}
            {taskCompletion && (
              <span className="text-[10px] text-warm-400 dark:text-warm-500 ml-auto tabular-nums">
                {taskCompletion.totalTurnsUsed} turns
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-1 rounded-full bg-warm-200 dark:bg-warm-700 mb-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${mode === "completion" ? "bg-green-500" : "bg-primary-500"}`}
              style={{ width: `${mode === "completion" ? 100 : progressPct}%` }}
            />
          </div>

          {/* Recovery banner */}
          {taskRecovery && (
            <div className="mb-2 rounded border border-primary-200 dark:border-primary-800 bg-primary-50/70 dark:bg-primary-900/20 px-2 py-1.5 text-[11px] text-primary-700 dark:text-primary-300 flex items-center gap-1.5">
              <span>
                Recovered: {taskRecovery.completedSubtasks}/
                {taskRecovery.totalSubtasks} done,{" "}
                {taskRecovery.pendingSubtasks} pending
              </span>
              <button
                onClick={() => setInputText(buildRecoveryHint(taskRecovery))}
                className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium text-primary-600 dark:text-primary-300 hover:text-primary-800 dark:hover:text-primary-100 transition-colors"
              >
                <RotateCcw size={9} />
                Resume
              </button>
            </div>
          )}

          {/* Vertical timeline */}
          <div className="ml-1 max-h-52 overflow-y-auto">
            {rows.map((row, i) => (
              <div key={row.id} className="flex items-start gap-2">
                {/* Connector + icon */}
                <div className="flex flex-col items-center">
                  <div className="w-5 h-5 flex items-center justify-center shrink-0">
                    <PlanStepIcon status={row.status} size={14} />
                  </div>
                  {i < rows.length - 1 && (
                    <div
                      className={`w-px flex-1 min-h-[8px] ${
                        row.status === "completed"
                          ? "bg-green-300/60 dark:bg-green-700/40"
                          : "bg-warm-200/60 dark:bg-warm-700/40"
                      }`}
                    />
                  )}
                </div>
                {/* Step content */}
                <div
                  className={`pb-2 min-w-0 flex-1 ${
                    row.status === "running"
                      ? "border-l-[3px] border-primary-400 dark:border-primary-600 pl-2 -ml-0.5"
                      : ""
                  }`}
                >
                  <span
                    className={`text-xs leading-relaxed ${
                      row.status === "running"
                        ? "text-warm-800 dark:text-warm-100 font-medium"
                        : row.status === "pending"
                          ? "text-warm-400 dark:text-warm-500"
                          : "text-warm-600 dark:text-warm-300"
                    }`}
                  >
                    {row.description}
                  </span>
                  {row.status === "running" && (
                    <span className="ml-1.5 text-[10px] text-primary-500 dark:text-primary-400">
                      running
                    </span>
                  )}
                  {row.evidenceSnippet &&
                    row.status !== "pending" &&
                    row.status !== "running" && (
                      <div className="mt-0.5 text-[10px] text-warm-400 dark:text-warm-500 line-clamp-2 leading-relaxed">
                        {row.evidenceSnippet}
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>

          {/* Skip button */}
          {canSkip && (
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => void skipCurrentSubtask()}
                className="inline-flex items-center gap-1 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
              >
                <SkipForward size={10} />
                Skip step
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
