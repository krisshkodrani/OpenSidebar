import type { AgentStep, SubtaskSummary } from "../../types";
import type { SessionScopedLogger } from "../../utils";
import { logger } from "../../utils";
import type { ContextManager } from "./context";
import type { RuntimeLimits } from "./constants";
import type { PageStateCoordinator } from "./page-state";
import type { PlanStep, PlanMonitorResult, TaskPlanner } from "./planner";
import type { TraceRecorder } from "./trace";
import type { SubgoalAttempt } from "./loop-helpers";
import {
  buildStructuredFailureContext,
  formatStructuredFailureContext,
} from "./loop-helpers";
import {
  buildCompletedPlanStepSummaries,
  buildFailedPlanStep,
  buildPlanMonitorReplanMessage,
  buildPlanReplacementState,
  buildPlanRevisionMessage,
} from "./agent-plan-progress";

export interface PlanRecoveryHost {
  isSkillOwnedListDetailReview(): boolean;
  isSkillOwnedMultiTabChecklistLoop(): boolean;
  planSteps: PlanStep[];
  planSubtasks: SubtaskSummary[];
  readonly perception: PageStateCoordinator;
  readonly context: ContextManager;
  readonly planner: TaskPlanner;
  readonly originalQuery: string;
  readonly selectedSkillId: string | null;
  readonly turnCount: number;
  readonly limits: RuntimeLimits;
  replanCount: number;
  turnsOnCurrentStep: number;
  escalationsOnCurrentStep: number;
  doneRejections: number;
  lastContractRejectionKind: string | undefined;
  consecutiveSameKindRejections: number;
  lastPlanIndex: number;
  readonly traceRecorder: TraceRecorder | null;
  readonly log: typeof logger | SessionScopedLogger;
  stepHandler(step: AgentStep, update: boolean): void;
  broadcastTaskProgress(index: number): void;
  refreshSnapshotWithRetry(tabId: number, prevCount: number): Promise<number>;
  refreshPerceptionAndTriage(tabId: number): Promise<void>;
}

/** Plan monitoring and the two ways to repair a stale plan. */
export class PlanRecoveryRuntime {
  constructor(private readonly host: PlanRecoveryHost) {}

  /**
   * Run plan monitor: compare current perception against expected state for the active step.
   * Only runs when a plan is active, perception is available, and enough turns have passed.
   */
  async runPlanMonitor(
    signal?: AbortSignal,
  ): Promise<PlanMonitorResult | null> {
    if (
      this.host.isSkillOwnedListDetailReview() ||
      this.host.isSkillOwnedMultiTabChecklistLoop()
    ) {
      return null;
    }
    if (this.host.planSteps.length === 0 || !this.host.perception.getInterpretation())
      return null;

    // Find the currently running step
    const runningIdx = this.host.planSubtasks.findIndex(
      (s) => s.status === "running",
    );
    if (runningIdx < 0 || runningIdx >= this.host.planSteps.length) return null;

    const step = this.host.planSteps[runningIdx];
    if (!step.expectedState) return null;

    const pageUrl = this.host.context.getSnapshot()?.url || "";
    const result = await this.host.planner.monitorStep(
      step,
      runningIdx,
      this.host.perception.getInterpretation()!,
      pageUrl,
      signal,
    );

    if (result) {
      this.host.traceRecorder?.recordEvent("plan_monitor", {
        stepIndex: runningIdx,
        alignment: result.alignment,
        reason: result.reason,
        heuristicHit: !result.reason.includes("LLM"),
        ...(result.blocker ? { blocker: result.blocker } : {}),
      });
      this.host.log.info("agent", "Plan monitor check", {
        stepIndex: runningIdx,
        alignment: result.alignment,
        reason: result.reason.slice(0, 150),
      });
    }

    return result;
  }

  /**
   * Handle plan deviation: invoke selective replan and update plan state.
   */
  async handlePlanDeviation(
    monitorResult: PlanMonitorResult,
    tabId: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      this.host.isSkillOwnedListDetailReview() ||
      this.host.isSkillOwnedMultiTabChecklistLoop()
    ) {
      this.host.traceRecorder?.recordEvent("plan_replan_skipped_skill_owned_loop", {
        turn: this.host.turnCount,
        skillId: this.host.selectedSkillId,
        reason: "plan_monitor_deviation",
      });
      return;
    }

    if (this.host.replanCount >= this.host.limits.maxReplans) {
      this.host.log.warn("agent", "Plan deviation detected but replan cap reached", {
        replanCount: this.host.replanCount,
        maxReplans: this.host.limits.maxReplans,
      });
      return;
    }

    const perception = this.host.perception.getInterpretation() || "";
    const pageUrl = this.host.context.getSnapshot()?.url || "";

    const runningIdx = this.host.planSubtasks.findIndex(
      (s) => s.status === "running",
    );
    if (runningIdx < 0) return;

    this.host.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "thinking",
        label: "Replanning from deviation...",
        status: "running",
        timestamp: Date.now(),
      },
      false,
    );

    const replanResult = await this.host.planner.replanFrom(
      this.host.originalQuery,
      buildCompletedPlanStepSummaries(this.host.planSubtasks),
      buildFailedPlanStep(this.host.planSubtasks, runningIdx),
      perception,
      pageUrl,
      signal,
    );

    if (!replanResult || replanResult.newSteps.length === 0) {
      this.host.log.warn("agent", "Replan produced no new steps");
      return;
    }

    this.host.replanCount++;

    // Replace steps from deviation point onward
    const replacement = buildPlanReplacementState({
      subtasks: this.host.planSubtasks,
      steps: this.host.planSteps,
      fromIndex: runningIdx,
      replacementSteps: replanResult.newSteps,
    });
    this.host.planSubtasks = replacement.planSubtasks;
    this.host.planSteps = replacement.planSteps;

    // Update context with new plan
    this.host.context.setPlanStatus(replacement.statusEntries, runningIdx);

    // Inject plan monitor message into conversation
    this.host.context.addMessage({
      role: "user",
      content: buildPlanMonitorReplanMessage({
        fromIndex: runningIdx,
        reason: monitorResult.reason,
        replacementSteps: replanResult.newSteps,
      }),
    });

    // Broadcast updated progress
    this.host.broadcastTaskProgress(runningIdx);

    this.host.traceRecorder?.recordEvent("plan_replan", {
      fromIndex: runningIdx,
      newStepCount: replanResult.newSteps.length,
      reason: replanResult.reason,
      replanNumber: this.host.replanCount,
    });

    this.host.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "info",
        label: `Plan repaired (${replanResult.newSteps.length} new steps)`,
        status: "done",
        timestamp: Date.now(),
      },
      false,
    );

    this.host.log.info("agent", "Plan repaired after deviation", {
      fromIndex: runningIdx,
      newStepCount: replanResult.newSteps.length,
      replanCount: this.host.replanCount,
      reason: replanResult.reason.slice(0, 200),
    });
  }

  /**
   * Attempt replan-on-escalation: instead of switching the planner model to execute
   * tools directly, ask it to produce a revised plan, then hand back to executor.
   *
   * Returns true if replan succeeded (caller should skip old escalation behavior).
   * Returns false if replan is not applicable or fails (caller falls through to old behavior).
   */
  async replanOnEscalation(
    tabId: number,
    subgoalAttempts: SubgoalAttempt[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (
      this.host.isSkillOwnedListDetailReview() ||
      this.host.isSkillOwnedMultiTabChecklistLoop()
    ) {
      this.host.traceRecorder?.recordEvent("plan_replan_skipped_skill_owned_loop", {
        turn: this.host.turnCount,
        skillId: this.host.selectedSkillId,
        reason: "escalation_or_stagnation",
      });
      this.host.log.info(
        "agent",
        "Skipping replan for skill-owned list-detail loop",
        {
          turn: this.host.turnCount,
        },
      );
      return false;
    }

    // Guard: replan cap
    if (this.host.replanCount >= this.host.limits.maxReplans) {
      this.host.log.info("agent", "replanOnEscalation: cap reached", {
        replanCount: this.host.replanCount,
        maxReplans: this.host.limits.maxReplans,
      });
      return false;
    }

    // Guard: must have a plan with steps
    if (this.host.planSteps.length === 0 || this.host.planSubtasks.length === 0) {
      this.host.log.info("agent", "replanOnEscalation: no plan exists");
      return false;
    }

    // Find running step
    const runningIdx = this.host.planSubtasks.findIndex(
      (s) => s.status === "running",
    );
    if (runningIdx < 0) {
      this.host.log.info("agent", "replanOnEscalation: no running step");
      return false;
    }

    const stuckStep = this.host.planSubtasks[runningIdx];
    const stuckStepGoal = stuckStep.description;

    // Build structured failure context from subgoal attempts
    const failureContext = buildStructuredFailureContext(
      subgoalAttempts,
      stuckStepGoal,
      runningIdx,
      this.host.turnsOnCurrentStep,
      this.host.context.getSnapshot()?.url || "",
    );
    const failureContextStr = formatStructuredFailureContext(failureContext);

    this.host.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "thinking",
        label: "Replanning stuck step...",
        status: "running",
        timestamp: Date.now(),
      },
      false,
    );

    // Get fresh perception for the replan prompt
    await this.host.refreshSnapshotWithRetry(tabId, -1);
    this.host.perception.invalidateCache();
    await this.host.refreshPerceptionAndTriage(tabId);

    const perception = this.host.perception.getInterpretation() || "";
    const pageUrl = this.host.context.getSnapshot()?.url || "";

    // Call the planner to replan (temporarily — no model switch needed, planner has its own LLM)
    const replanResult = await this.host.planner.replanFrom(
      this.host.originalQuery,
      buildCompletedPlanStepSummaries(this.host.planSubtasks),
      buildFailedPlanStep(this.host.planSubtasks, runningIdx),
      perception,
      pageUrl,
      signal,
      failureContextStr,
    );

    if (!replanResult || replanResult.newSteps.length === 0) {
      this.host.log.warn("agent", "replanOnEscalation: replan produced no steps");
      return false;
    }

    this.host.replanCount++;

    // Replace steps from stuck point onward
    const replacement = buildPlanReplacementState({
      subtasks: this.host.planSubtasks,
      steps: this.host.planSteps,
      fromIndex: runningIdx,
      replacementSteps: replanResult.newSteps,
    });
    this.host.planSubtasks = replacement.planSubtasks;
    this.host.planSteps = replacement.planSteps;

    // Update context with new plan
    this.host.context.setPlanStatus(replacement.statusEntries, runningIdx);

    // Clear history and inject fresh context with the new plan
    this.host.context.clearHistory();
    this.host.context.addMessage({
      role: "user",
      content: this.host.originalQuery,
    });
    this.host.context.addMessage({
      role: "user",
      content: buildPlanRevisionMessage({
        fromIndex: runningIdx,
        reason: replanResult.reason,
        replacementSteps: replanResult.newSteps,
      }),
    });

    // Reset step tracking for the new step
    this.host.turnsOnCurrentStep = 0;
    this.host.escalationsOnCurrentStep = 0;
    this.host.doneRejections = 0;
    this.host.lastContractRejectionKind = undefined;
    this.host.consecutiveSameKindRejections = 0;
    this.host.lastPlanIndex = runningIdx;

    // Broadcast updated progress
    this.host.broadcastTaskProgress(runningIdx);

    this.host.traceRecorder?.recordEvent("replan_on_escalation", {
      fromIndex: runningIdx,
      newStepCount: replanResult.newSteps.length,
      reason: replanResult.reason,
      replanNumber: this.host.replanCount,
      failureContext: failureContextStr.slice(0, 300),
    });

    this.host.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "info",
        label: `Replanned from step ${runningIdx + 1} (${replanResult.newSteps.length} new steps)`,
        status: "done",
        timestamp: Date.now(),
      },
      false,
    );

    this.host.log.info("agent", "replanOnEscalation succeeded", {
      fromIndex: runningIdx,
      newStepCount: replanResult.newSteps.length,
      replanCount: this.host.replanCount,
      reason: replanResult.reason.slice(0, 200),
    });

    return true;
  }

}
