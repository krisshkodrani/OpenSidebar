import {
  advanceCompletedPlanSubtasks,
  completeRemainingPlanSubtasks,
  completeSinglePlanSubtask,
} from "./agent-plan-progress";

export interface AgentLoopPlanProgressHost {
  captureSubtaskResult(): string;
  context: {
    getCurrentUrl(): string | null;
  };
  escalationsOnCurrentStep: number;
  lastPlanIndex: number;
  mutationLedger: {
    clearReplayState(): void;
    clearStepLedger(): void;
  };
  perception: {
    invalidateCache(): void;
  };
  planSubtasks: Parameters<typeof advanceCompletedPlanSubtasks>[0]["subtasks"];
  recordVerifiedPlanAdvance(): void;
  stepRetryCount: number;
  turnsOnCurrentStep: number;
}

/**
 * Walk planSubtasks and mark early steps as completed based on
 * planner rejection (which implies the agent has progressed past them).
 * Returns the new currentIndex (first non-completed step).
 */
export function advanceCompletedSubtasks(
  loop: AgentLoopPlanProgressHost,
): number {
  const result = advanceCompletedPlanSubtasks({
    subtasks: loop.planSubtasks,
    captureResult: () => loop.captureSubtaskResult(),
    completedAtUrl: loop.context.getCurrentUrl() || undefined,
    lastPlanIndex: loop.lastPlanIndex,
  });
  // Plan-aware cache invalidation: force fresh perception on step advancement
  if (result.planIndexChanged) {
    loop.lastPlanIndex = result.currentIndex;
    loop.perception.invalidateCache();
    loop.turnsOnCurrentStep = 0;
    loop.escalationsOnCurrentStep = 0;
    loop.stepRetryCount = 0;
    loop.mutationLedger.clearStepLedger();
    loop.recordVerifiedPlanAdvance();
  }
  return result.currentIndex;
}

/**
 * Complete exactly one plan subtask and move the running pointer forward.
 * This is safer than walking all subtasks when advancement is triggered by
 * local structural evidence from the current page.
 */
export function completeSingleSubtask(
  loop: AgentLoopPlanProgressHost,
  currentIndex: number,
): number {
  const result = completeSinglePlanSubtask({
    subtasks: loop.planSubtasks,
    currentIndex,
    captureResult: () => loop.captureSubtaskResult(),
    completedAtUrl: loop.context.getCurrentUrl() || undefined,
    lastPlanIndex: loop.lastPlanIndex,
  });

  if (result.planIndexChanged) {
    loop.lastPlanIndex = result.currentIndex;
    loop.perception.invalidateCache();
    loop.turnsOnCurrentStep = 0;
    loop.escalationsOnCurrentStep = 0;
    loop.mutationLedger.clearReplayState();
    loop.recordVerifiedPlanAdvance();
  }

  return result.currentIndex;
}

export function completeRemainingSubtasks(
  loop: AgentLoopPlanProgressHost,
  currentIndex: number,
  result: string,
): number {
  const completion = completeRemainingPlanSubtasks({
    subtasks: loop.planSubtasks,
    currentIndex,
    result,
    completedAtUrl: loop.context.getCurrentUrl() || undefined,
    lastPlanIndex: loop.lastPlanIndex,
  });

  if (completion.planIndexChanged) {
    loop.lastPlanIndex = completion.currentIndex;
    loop.perception.invalidateCache();
    loop.turnsOnCurrentStep = 0;
    loop.escalationsOnCurrentStep = 0;
    loop.mutationLedger.clearReplayState();
    loop.recordVerifiedPlanAdvance();
  }

  return completion.currentIndex;
}
