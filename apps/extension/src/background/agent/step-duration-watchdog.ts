/** Escalate stalled steps, allowing observed progress within longer workflows. */
export type StepDurationWatchdogDecision =
  | { kind: "none" }
  | { kind: "warn" }
  | { kind: "defer" }
  | { kind: "escalate" };

export function assessStepDurationWatchdog(params: {
  hasTaskId: boolean;
  planSubtaskCount: number;
  turnsOnCurrentStep: number;
  turnsSinceProgress?: number;
  escalationTier: number;
  cooldownRemaining: number;
  warnTurns: number;
  escalateTurns: number;
  deferForStateChangingAction?: boolean;
}): StepDurationWatchdogDecision {
  const stalledTurns = Math.min(
    params.turnsOnCurrentStep,
    params.turnsSinceProgress ?? params.turnsOnCurrentStep,
  );
  if (
    !params.hasTaskId ||
    params.planSubtaskCount <= 0 ||
    params.turnsOnCurrentStep <= 0
  ) {
    return { kind: "none" };
  }

  if (params.deferForStateChangingAction && stalledTurns >= params.warnTurns) {
    return { kind: "defer" };
  }

  if (
    stalledTurns >= params.escalateTurns &&
    params.escalationTier < 1 &&
    params.cooldownRemaining <= 0
  ) {
    return { kind: "escalate" };
  }

  if (stalledTurns === params.warnTurns) {
    return { kind: "warn" };
  }

  return { kind: "none" };
}
