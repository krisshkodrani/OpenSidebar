/**
 * text-admission advance gate (RFC LP-16 Phase 3 — loop.ts landmine decomposition).
 *
 * The read-only gate that decides whether a text-only "I finished this step"
 * admission may advance the running plan step: needs a running step, enough
 * text-only turns, present success criteria, a confident summary, matched
 * criteria, and summary/step coherence. Pure over the host's plan/verification
 * state — extracted verbatim from loop() via the dispatch-host idiom (loop()
 * passes `this`); behavior-preserving.
 */

import type { PlanStep } from "./planner";
import type { SubtaskSummary } from "../../types";
import type { ContextManager } from "./context";
import { assessDoneSummary, checkSummaryStepCoherence } from "./verification";
import { matchSuccessCriteria } from "./loop-helpers";

export interface TextAdmissionGateHost {
  readonly planSubtasks: SubtaskSummary[];
  readonly verificationTurnMode: boolean;
  readonly planSteps: PlanStep[];
  readonly context: ContextManager;
}

export function evaluateTextAdmissionAdvanceGate(
host: TextAdmissionGateHost,
params: {
  summary: string;
  consecutiveTextOnly: number;
}): {
  passed: boolean;
  runningIdx: number;
  isLastStep: boolean;
  reason?: string;
} {
  const { summary, consecutiveTextOnly } = params;
  const runningIdx = host.planSubtasks.findIndex(
    (s) => s.status === "running",
  );
  if (runningIdx < 0) {
    return {
      passed: false,
      runningIdx: -1,
      isLastStep: false,
      reason: "no_running_step",
    };
  }

  const requiredTextOnlyTurns = host.verificationTurnMode ? 1 : 2;
  if (consecutiveTextOnly < requiredTextOnlyTurns) {
    return {
      passed: false,
      runningIdx,
      isLastStep: false,
      reason:
        requiredTextOnlyTurns === 1
          ? "verification_turn_waiting"
          : "first_text_only_turn",
    };
  }

  const currentStep = host.planSteps[runningIdx];
  if (!currentStep?.successCriteria) {
    return {
      passed: false,
      runningIdx,
      isLastStep: false,
      reason: "missing_success_criteria",
    };
  }

  const sentiment = assessDoneSummary(summary);
  if (!sentiment.confident) {
    return {
      passed: false,
      runningIdx,
      isLastStep: false,
      reason: `failure_sentiment:${sentiment.reason ?? "unknown"}`,
    };
  }

  const criteriaCheck = matchSuccessCriteria({
    successCriteria: currentStep.successCriteria,
    snapshot: host.context.getSnapshot(),
  });
  if (!criteriaCheck.satisfied) {
    return {
      passed: false,
      runningIdx,
      isLastStep: false,
      reason: "criteria_mismatch",
    };
  }

  const coherence = checkSummaryStepCoherence({
    summary,
    currentStepIndex: runningIdx,
    stepDescriptions: host.planSubtasks.map((s) => s.description),
  });
  if (!coherence.coherent) {
    return {
      passed: false,
      runningIdx,
      isLastStep: false,
      reason: `coherence_failed:${coherence.reason ?? "unknown"}`,
    };
  }

  const pendingCount = host.planSubtasks.filter(
    (s) => s.status === "pending",
  ).length;

  return {
    passed: true,
    runningIdx,
    isLastStep: pendingCount === 0,
  };
}
