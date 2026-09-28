import type { SubtaskSummary } from "../../types";
import type { PerceptionTaskContext } from "../perception/types";
import type { PlanStep } from "./planner";

export function deriveActivePerceptionTaskContext(
  planSteps: readonly PlanStep[],
  planSubtasks: readonly SubtaskSummary[],
  lastPlanIndex: number,
): PerceptionTaskContext | undefined {
  if (planSteps.length === 0) return undefined;

  let stepIndex = planSubtasks.findIndex((subtask) => subtask.status === "running");
  if (stepIndex < 0 && lastPlanIndex >= 0 && lastPlanIndex < planSteps.length) {
    stepIndex = lastPlanIndex;
  }
  if (stepIndex < 0 || stepIndex >= planSteps.length) return undefined;

  const step = planSteps[stepIndex];
  const objective =
    step.objective?.trim() || planSubtasks[stepIndex]?.description?.trim();
  if (!objective) return undefined;

  return {
    objective,
    successCriteria: step.successCriteria?.trim() || undefined,
    expectedStateDescription: step.expectedState?.description?.trim() || undefined,
    toolProfile: step.toolProfile,
    currentStepIndex: stepIndex,
    totalSteps: planSteps.length,
  };
}
