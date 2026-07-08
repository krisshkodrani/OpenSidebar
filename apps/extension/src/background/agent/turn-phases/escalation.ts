/**
 * escalation phase (RFC LP-16 Phase 3, extending the LP-15 Phase 11 turn machine).
 *
 * The escalation-rescue policy (RFC LP-2): fail fast when a prior escalation
 * produced no verified progress, then fire progress-based triggers the
 * snapshot-delta monitors cannot see (moving page, frozen progress) — trying a
 * replan-on-escalation first, then falling back to a prompt-based persona
 * escalation + strategy pivot. Exercises the `end_task` result (fail-fast returns
 * a LoopResult). Most members are real AgentLoop fields/methods so loop() passes
 * `this`; the turn-local escalation state (esc controller, tabId, subgoal
 * attempts, and the two working-memory closures) is passed in as deps.
 */

import type { AgentStep } from "../../../types";
import type { logger, SessionScopedLogger } from "../../../utils";
import type { ContextManager } from "../context";
import type { TraceRecorder } from "../trace";
import type { LoopResult } from "../loop-types";
import type { EscalationRescueTracker } from "../escalation-rescue-policy";
import type { EscalationTierController } from "../escalation-tier-controller";
import { extractAttemptSummary, type SubgoalAttempt } from "../loop-helpers";
import { ESCALATION_REFLECTION } from "../loop-prompts";

export interface EscalationPhaseHost {
  readonly escalationRescue: EscalationRescueTracker;
  readonly turnCount: number;
  readonly maxTurns: number;
  readonly planSubtasks: ReadonlyArray<{ status: string }>;
  readonly traceRecorder: TraceRecorder | null;
  readonly abortController: AbortController | null;
  readonly log: typeof logger | SessionScopedLogger;
  readonly context: ContextManager;
  readonly stagnation: { resetEscalation(): void };
  flushEscalationRescueEvents(): void;
  failFastAfterEscalation(reason: string): LoopResult;
  replanOnEscalation(
    tabId: number,
    subgoalAttempts: SubgoalAttempt[],
    signal?: AbortSignal,
  ): Promise<boolean>;
  strategyPivot(tabId: number, attemptSummary: string): Promise<void>;
  stepHandler(step: AgentStep, update: boolean): void;
}

export interface EscalationPhaseDeps {
  esc: EscalationTierController;
  tabId: number;
  subgoalAttempts: SubgoalAttempt[];
  resetEscalationWorkingMemory: () => void;
  beginPlannerEscalation: (options: { bumpStepCounter: boolean }) => void;
}

export type EscalationPhaseResult =
  | { kind: "continue" }
  | { kind: "end_task"; result: LoopResult };

export async function runEscalationPhase(
  host: EscalationPhaseHost,
  deps: EscalationPhaseDeps,
): Promise<EscalationPhaseResult> {
  const rescueAssessment = host.escalationRescue.assess({
    turn: host.turnCount,
    maxTurns: host.maxTurns,
    escalationTier: deps.esc.tier,
    cooldownRemaining: deps.esc.cooldownRemaining,
    planSubtaskCount: host.planSubtasks.length,
    planCompletedCount: host.planSubtasks.filter(
      (subtask) => subtask.status === "completed",
    ).length,
  });
  if (rescueAssessment.kind === "fail_fast") {
    host.flushEscalationRescueEvents();
    await host.traceRecorder?.endTurn();
    return {
      kind: "end_task",
      result: host.failFastAfterEscalation(rescueAssessment.reason),
    };
  }
  if (rescueAssessment.kind === "escalate") {
    host.log.warn("agent", "Escalation rescue trigger fired", {
      turn: host.turnCount,
      trigger: rescueAssessment.trigger,
      reason: rescueAssessment.reason,
    });
    host.escalationRescue.noteEscalation(
      host.turnCount,
      rescueAssessment.trigger,
    );

    // Try replan-on-escalation first (planner replans, executor continues)
    const rescueReplanOk = await host.replanOnEscalation(
      deps.tabId,
      deps.subgoalAttempts,
      host.abortController?.signal,
    );
    if (rescueReplanOk) {
      deps.resetEscalationWorkingMemory();
    } else {
      // Fallback: prompt-based persona escalation + strategy pivot
      const rescueAttemptSummary = extractAttemptSummary(
        host.context.getMessages(),
      );
      deps.beginPlannerEscalation({ bumpStepCounter: true });
      await host.strategyPivot(deps.tabId, rescueAttemptSummary);
      host.stagnation.resetEscalation();
      host.context.addMessage({
        role: "user",
        content:
          rescueAssessment.trigger === "budget_stall"
            ? `BUDGET STALL: ${rescueAssessment.reason}. ${ESCALATION_REFLECTION("over half the turn budget is gone with most of the plan incomplete")}`
            : `NO-PROGRESS ESCALATION: ${rescueAssessment.reason}. ${ESCALATION_REFLECTION(rescueAssessment.reason)}`,
      });
      host.stepHandler(
        {
          id: crypto.randomUUID(),
          type: "info",
          label:
            rescueAssessment.trigger === "budget_stall"
              ? "Budget stall — escalating to planner model"
              : "No verified progress — escalating to planner model",
          status: "done",
          timestamp: Date.now(),
        },
        false,
      );
    }
  }
  host.flushEscalationRescueEvents();
  return { kind: "continue" };
}
