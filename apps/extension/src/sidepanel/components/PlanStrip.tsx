import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { buildRecoveryHint } from "../plan-board-view";
import { derivePlanStripViewModel } from "../plan-strip-view-model";
import { logger } from "../../utils";
import { uiRuntime } from "../runtime";
import { PlanCollapsedBar } from "./plan/PlanCollapsedBar";
import { PlanConfirmationPanel } from "./plan/PlanConfirmationPanel";
import { PlanProgressPanel } from "./plan/PlanProgressPanel";

export function PlanStrip({
  isExpanded,
  onToggle,
}: {
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const pendingPlan = useStore((s) => s.pendingPlanConfirmation);
  const taskProgress = useStore((s) => s.taskProgress);
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

  useEffect(() => {
    if (!pendingPlan) setConfirmed(false);
  }, [pendingPlan]);

  const viewModel = useMemo(
    () =>
      derivePlanStripViewModel({
        isPlanning,
        pendingPlan,
        taskProgress,
      }),
    [isPlanning, pendingPlan, taskProgress],
  );

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (viewModel.mode !== "progress") {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [viewModel.mode, taskProgress?.currentIndex]);

  const sendDecision = useCallback(
    async (decision: "approve" | "cancel") => {
      if (!pendingPlan) return;
      try {
        await uiRuntime.sendMessage({
          type: "PLAN_CONFIRMATION_RESPONSE",
          requestId: crypto.randomUUID(),
          source: uiRuntime.source,
          workspaceId: activeWorkspaceId,
          payload: {
            confirmationId: pendingPlan.confirmationId,
            decision,
            feedback: feedback.trim() || undefined,
          },
        });
        if (decision === "approve") {
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
    [activeWorkspaceId, clearPending, feedback, pendingPlan],
  );

  const skipCurrentSubtask = useCallback(async () => {
    if (!taskProgress) return;
    try {
      await uiRuntime.sendMessage({
        type: "SKIP_SUBTASK",
        requestId: crypto.randomUUID(),
        source: uiRuntime.source,
        workspaceId: activeWorkspaceId,
        payload: { taskId: taskProgress.taskId },
      });
    } catch (error) {
      logger.error("ui", "Failed to send skip subtask request", { error });
    }
  }, [activeWorkspaceId, taskProgress]);

  if (!viewModel.mode) return null;

  return (
    <div className={`shrink-0 border-b ${viewModel.barClassName}`}>
      <PlanCollapsedBar
        activeCount={viewModel.activeCount}
        blockedCount={viewModel.blockedCount}
        confirmed={confirmed}
        currentIndex={viewModel.currentIndex}
        elapsed={elapsed}
        isExpanded={isExpanded}
        mode={viewModel.mode}
        onToggle={onToggle}
        pendingPlan={pendingPlan}
        rows={viewModel.rows}
      />

      <div
        className={`overflow-hidden transition-[max-height] duration-200 ease-in-out ${
          isExpanded ? "max-h-[30vh]" : "max-h-0"
        }`}
      >
        <div className="max-h-[30vh] overflow-y-auto border-t border-warm-200/60 px-3 pb-2 pt-1 dark:border-warm-700/40">
          {viewModel.mode === "confirmation" && pendingPlan ? (
            <PlanConfirmationPanel
              confirmed={confirmed}
              expandedStep={expandedStep}
              feedback={feedback}
              onDecision={(decision) => void sendDecision(decision)}
              onFeedbackChange={setFeedback}
              onShowFeedback={() => setShowFeedback(true)}
              onToggleStep={(index) =>
                setExpandedStep((current) => (current === index ? null : index))
              }
              pendingPlan={pendingPlan}
              showFeedback={showFeedback}
            />
          ) : null}

          {viewModel.mode === "progress" && viewModel.rows.length > 0 ? (
            <PlanProgressPanel
              canSkip={viewModel.canSkip}
              onResumeRecoveredTask={() => {
                if (taskRecovery) setInputText(buildRecoveryHint(taskRecovery));
              }}
              onSkipCurrentStep={() => void skipCurrentSubtask()}
              recovery={taskRecovery}
              rows={viewModel.rows}
              runningRef={runningRef}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
