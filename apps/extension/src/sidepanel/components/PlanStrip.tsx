import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  SkipForward,
  RotateCcw,
} from "lucide-react";
import { useStore } from "../store";
import { PlanStepIcon } from "./PlanStepIcon";
import { buildRecoveryHint, derivePlanRows } from "../plan-board-view";
import { MessageSource } from "../../types";
import { logger } from "../../utils";

// --- Segmented progress bar for collapsed bar ---

function ProgressBar({ rows }: { rows: { id: string; status: string }[] }) {
  if (rows.length === 0) return null;
  const hasFailed = rows.some((r) => r.status === "failed");
  return (
    <div
      className="flex items-center gap-1"
      role="progressbar"
      aria-label={`${rows.filter((r) => r.status === "completed").length} of ${rows.length} steps completed`}
    >
      <div className="flex h-2 flex-1 min-w-[60px] max-w-[160px] rounded-full overflow-hidden bg-warm-200 dark:bg-warm-700">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`h-full transition-colors duration-300 ${
              row.status === "completed"
                ? "bg-green-500"
                : row.status === "running"
                  ? "bg-primary-500 animate-pulse"
                  : row.status === "failed"
                    ? "bg-red-500"
                    : row.status === "skipped"
                      ? "bg-warm-400 dark:bg-warm-500"
                      : ""
            }`}
            style={{ flex: 1 }}
            role="presentation"
          />
        ))}
      </div>
      {hasFailed && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"
          role="status"
          aria-label="One or more steps failed"
        />
      )}
    </div>
  );
}

// --- Elapsed timer formatting ---

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s}s`;
}

// --- Main PlanStrip ---

export function PlanStrip({
  isExpanded,
  onToggle,
}: {
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const pendingPlan = useStore((s) => s.pendingPlanConfirmation);
  const taskProgress = useStore((s) => s.taskProgress);
  const taskCompletion = useStore((s) => s.taskCompletion);
  const taskRecovery = useStore((s) => s.taskRecovery);
  const isPlanning = useStore((s) => s.isPlanning);
  const clearPending = useStore((s) => s.clearPendingPlanConfirmation);
  const setInputText = useStore((s) => s.setInputText);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);

  const runningRef = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // Reset confirmed state when confirmation clears (task started or new plan)
  useEffect(() => {
    if (!pendingPlan) setConfirmed(false);
  }, [pendingPlan]);

  const rows = useMemo(
    () => derivePlanRows(taskProgress, taskCompletion),
    [taskProgress, taskCompletion],
  );

  // --- State machine ---
  const mode: "planning" | "confirmation" | "progress" | "completion" | null =
    pendingPlan
      ? "confirmation"
      : taskProgress
        ? "progress"
        : taskCompletion
          ? "completion"
          : isPlanning
            ? "planning"
            : null;

  // --- Elapsed timer ---
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (mode !== "progress") {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [mode, taskProgress?.currentIndex]);

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
        if (decision === "approve") {
          // Keep pendingPlan alive so the strip stays visible until
          // TASK_PROGRESS arrives — prevents the strip from vanishing.
          setConfirmed(true);
        } else {
          clearPending();
        }
      } catch (error) {
        logger.error("ui", "Failed to send plan confirmation", { error });
      } finally {
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

  // --- Nothing to show ---
  if (!mode) return null;

  const currentIndex = taskProgress?.currentIndex ?? 0;
  const canSkip =
    mode === "progress" && rows.some((r) => r.status === "running");

  // --- Collapsed bar styles per mode ---
  const barBg =
    mode === "planning"
      ? "bg-warm-50/60 dark:bg-warm-900/15 border-warm-200 dark:border-warm-700"
      : mode === "confirmation"
        ? "bg-primary-50/40 dark:bg-primary-900/10 border-primary-200 dark:border-primary-800"
        : mode === "completion"
          ? "bg-warm-50/60 dark:bg-warm-900/15 border-warm-200 dark:border-warm-700"
          : "bg-warm-50/60 dark:bg-warm-900/15 border-warm-200 dark:border-warm-700";

  const Chevron = isExpanded ? ChevronUp : ChevronDown;

  return (
    <div className={`shrink-0 border-b ${barBg}`}>
      {/* === Collapsed bar === */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 min-h-[30px] cursor-pointer select-none"
      >
        {mode === "planning" ? (
          <>
            <ClipboardList
              size={11}
              className="shrink-0 text-warm-400 dark:text-warm-500 animate-pulse"
            />
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-warm-500 dark:text-warm-400 animate-pulse">
              Plan
            </span>
            <span className="text-[11px] text-warm-500 dark:text-warm-400">
              Planning...
            </span>
          </>
        ) : mode === "confirmation" && pendingPlan ? (
          <>
            <ClipboardList
              size={11}
              className="shrink-0 text-primary-600 dark:text-primary-400"
            />
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-primary-600 dark:text-primary-400">
              Plan
            </span>
            <span
              className={`text-[11px] text-primary-800 dark:text-primary-200 ${confirmed ? "animate-pulse" : ""}`}
            >
              {confirmed ? "Starting..." : "Plan ready"}
            </span>
            {pendingPlan.difficulty && (
              <span className="text-[9px] px-1 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
                {pendingPlan.difficulty}
              </span>
            )}
            <span className="text-[10px] text-primary-600 dark:text-primary-400 ml-auto tabular-nums">
              {pendingPlan.nodes.length} steps
            </span>
          </>
        ) : (
          <>
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-warm-500 dark:text-warm-400">
              Plan
            </span>
            <ProgressBar rows={rows} />
            <span className="text-[11px] text-warm-700 dark:text-warm-200 ml-1 tabular-nums">
              {mode === "completion"
                ? "Complete"
                : `Step ${currentIndex + 1}/${rows.length}`}
            </span>
            <span className="text-[10px] text-warm-500 dark:text-warm-400 ml-auto tabular-nums">
              {mode === "completion"
                ? `${taskCompletion?.totalTurnsUsed ?? 0}t`
                : formatElapsed(elapsed)}
            </span>
          </>
        )}
        <Chevron
          size={12}
          className="shrink-0 text-warm-500 dark:text-warm-400 ml-1"
        />
      </button>

      {/* === Expanded panel === */}
      <div
        className={`overflow-hidden transition-[max-height] duration-200 ease-in-out ${
          isExpanded ? "max-h-[50vh]" : "max-h-0"
        }`}
      >
        <div className="border-t border-warm-200/60 dark:border-warm-700/40 px-3 pb-2 pt-1 overflow-y-auto max-h-[50vh]">
          {/* --- CONFIRMATION --- */}
          {mode === "confirmation" && pendingPlan && (
            <>
              <div className="ml-1 mb-2 max-h-52 overflow-y-auto">
                {pendingPlan.nodes.map((node, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="flex flex-col items-center">
                      <span className="w-5 h-5 flex items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/40 text-[10px] font-medium text-primary-700 dark:text-primary-300 shrink-0">
                        {i + 1}
                      </span>
                      {i < pendingPlan.nodes.length - 1 && (
                        <div className="w-px flex-1 min-h-[12px] bg-primary-200/60 dark:bg-primary-700/40" />
                      )}
                    </div>
                    <div className="pb-2 min-w-0 flex-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedStep(expandedStep === i ? null : i);
                        }}
                        className="text-xs text-left text-primary-800 dark:text-primary-200 leading-relaxed hover:text-primary-700 dark:hover:text-primary-100 transition-colors w-full"
                      >
                        {node.description}
                        {node.selectedSkillId && (
                          <span className="inline-flex ml-1.5 px-1 py-0.5 text-[9px] rounded bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-normal align-middle">
                            {node.selectedSkillId}
                          </span>
                        )}
                        {node.successCriteria && (
                          <ChevronDown
                            size={10}
                            className={`inline ml-1 transition-transform ${expandedStep === i ? "" : "-rotate-90"}`}
                          />
                        )}
                      </button>
                      {expandedStep === i && node.successCriteria && (
                        <div className="mt-1 text-[10px] text-primary-600 dark:text-primary-400 italic leading-relaxed">
                          {node.successCriteria}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {confirmed ? (
                <div className="text-[11px] text-primary-600 dark:text-primary-400 animate-pulse py-1">
                  Starting...
                </div>
              ) : (
                <>
                  {!showFeedback ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowFeedback(true);
                      }}
                      className="text-[10px] text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-200 mb-2 transition-colors"
                    >
                      + Add guidance
                    </button>
                  ) : (
                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Add guidance or corrections..."
                      rows={2}
                      className="w-full px-2 py-1.5 mb-2 text-xs border border-primary-200 dark:border-primary-700 rounded-md bg-white dark:bg-primary-950/20 text-primary-800 dark:text-primary-200 placeholder:text-primary-400 dark:placeholder:text-primary-500 outline-none focus:ring-1 focus:ring-primary-400 resize-none"
                      autoFocus
                    />
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void sendDecision("cancel");
                      }}
                      className="flex-1 rounded border border-primary-300 dark:border-primary-700 px-2 py-1.5 text-xs font-medium text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void sendDecision("approve");
                      }}
                      className="flex-1 rounded bg-primary-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-primary-700 transition-colors"
                    >
                      {feedback.trim() ? "Start with guidance" : "Start"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* --- PROGRESS / COMPLETION --- */}
          {(mode === "progress" || mode === "completion") &&
            rows.length > 0 && (
              <>
                {/* Recovery banner */}
                {taskRecovery && (
                  <div className="mb-2 rounded border border-primary-200 dark:border-primary-800 bg-primary-50/70 dark:bg-primary-900/20 px-2 py-1.5 text-[11px] text-primary-700 dark:text-primary-300 flex items-center gap-1.5">
                    <span>
                      Recovered: {taskRecovery.completedSubtasks}/
                      {taskRecovery.totalSubtasks} done,{" "}
                      {taskRecovery.pendingSubtasks} pending
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setInputText(buildRecoveryHint(taskRecovery));
                      }}
                      className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium text-primary-600 dark:text-primary-300 hover:text-primary-800 dark:hover:text-primary-100 transition-colors"
                    >
                      <RotateCcw size={9} />
                      Resume
                    </button>
                  </div>
                )}

                {/* Vertical timeline */}
                <div className="ml-1">
                  {rows.map((row, i) => (
                    <div
                      key={row.id}
                      ref={row.status === "running" ? runningRef : undefined}
                      className="flex items-start gap-2"
                    >
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
                                ? "text-warm-500 dark:text-warm-400"
                                : "text-warm-600 dark:text-warm-300"
                          }`}
                        >
                          {row.description}
                          {row.selectedSkillId && (
                            <span className="inline-flex ml-1.5 px-1 py-0.5 text-[9px] rounded bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 font-normal align-middle">
                              {row.selectedSkillId}
                            </span>
                          )}
                        </span>
                        {row.evidenceSnippet &&
                          row.status !== "pending" &&
                          row.status !== "running" && (
                            <div className="mt-0.5 text-[10px] text-warm-500 dark:text-warm-400 line-clamp-2 leading-relaxed">
                              {row.evidenceSnippet}
                            </div>
                          )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Skip button */}
                {canSkip && (
                  <div className="mt-1 flex justify-end">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void skipCurrentSubtask();
                      }}
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
      </div>
    </div>
  );
}
