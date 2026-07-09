/**
 * done-plan validation (RFC LP-16 Phase 3 — loop.ts landmine decomposition).
 *
 * The two structural + model-backed checks that decide whether a done() against
 * an active plan should be rejected: the synchronous precheck (uncommitted
 * inline edit, plan-incomplete, pending async change) and the async planner
 * validateDone call (skipped for orchestrator sub-nodes / satisfied aggregates).
 * Extracted verbatim from loop() via the dispatch-host idiom — every member is a
 * real AgentLoop field/method, so loop() passes `this`; behavior-preserving.
 * Pairs with done-plan-rejection.ts (which applies the resulting rejection).
 */

import type { ContextManager } from "./context";
import type { TraceRecorder } from "./trace";
import type { logger, SessionScopedLogger } from "../../utils";
import type { PlanStep, TaskPlanner } from "./planner";
import type { SubtaskSummary, AgentStep } from "../../types";
import type { StagnationMonitor } from "./stagnation";
import type { PerceptionScreenshotState } from "../perception/perception-screenshot-state";
import { ToolProfile, resolveToolProfile } from "../tools/metadata";
import { shouldOmitPerceptionForDoneValidation } from "./perception-done-validation";
import {
  isPendingAsyncChangeSatisfied,
  formatStateEvidence,
} from "./loop-helpers";

type PendingAsyncVerification = {
  stepIndex: number;
  expectedTokens: string[];
  baselineLoadingKeywords: string[];
  reason: string;
  startedTurn: number;
} | null;

export interface DonePlanValidationHost {
  planSubtasks: SubtaskSummary[];
  planSteps: PlanStep[];
  readonly context: ContextManager;
  readonly perception: PerceptionScreenshotState;
  readonly stagnation: StagnationMonitor;
  readonly planner: TaskPlanner;
  readonly traceRecorder: TraceRecorder | null;
  readonly log: typeof logger | SessionScopedLogger;
  readonly abortController: AbortController | null;
  readonly turnCount: number;
  readonly nodeId: string | null;
  readonly hasReadPage: boolean;
  readonly originalQuery: string;
  readonly selectedSkillId: string | null;
  pendingAsyncVerification: PendingAsyncVerification;
  isCompletedMoneyTableAggregateSummary(summary: string): boolean;
  getUncommittedInlineEditDoneRejection(
    currentStepIndex: number,
  ): string | null;
  shouldBypassPlanIncompleteDoneRejection(params: {
    summary: string;
    currentStepIndex: number;
  }): boolean;
  hasRecentToolEvidenceForTokens(expectedTokens: string[]): boolean;
  stepHandler(step: AgentStep, update: boolean): void;
}

export function evaluateDonePlanPrecheck(
host: DonePlanValidationHost,
summary: string,
): {
  shouldReject: boolean;
  rejectReason: string;
  effectiveCurrentIdx: number;
  completedMoneyTableAggregate: boolean;
} {
  let shouldReject = false;
  let rejectReason = "";
  const completedMoneyTableAggregate =
    host.isCompletedMoneyTableAggregateSummary(summary);
  const completedCount = host.planSubtasks.filter(
    (s) => s.status === "completed",
  ).length;
  const runningIdx = host.planSubtasks.findIndex(
    (s) => s.status === "running",
  );
  const effectiveCurrentIdx = runningIdx >= 0 ? runningIdx : completedCount;
  const uncommittedInlineEditRejection =
    host.getUncommittedInlineEditDoneRejection(effectiveCurrentIdx);
  if (uncommittedInlineEditRejection) {
    shouldReject = true;
    rejectReason = uncommittedInlineEditRejection;
  }

  const bypassPlanIncompleteRejection = shouldReject
    ? false
    : completedMoneyTableAggregate ||
      host.shouldBypassPlanIncompleteDoneRejection({
        summary,
        currentStepIndex: effectiveCurrentIdx,
      });
  if (
    effectiveCurrentIdx < host.planSubtasks.length - 1 &&
    !shouldReject &&
    !bypassPlanIncompleteRejection
  ) {
    shouldReject = true;
    rejectReason = `Plan incomplete. Step ${effectiveCurrentIdx + 1}/${host.planSubtasks.length} is active; continue to the next planned step instead of ending the task.`;
  } else if (bypassPlanIncompleteRejection) {
    host.log.info(
      "agent",
      "Bypassing stale plan done rejection for satisfied task",
      {
        turn: host.turnCount,
        step: effectiveCurrentIdx,
        remainingSteps: host.planSubtasks.length - effectiveCurrentIdx - 1,
        selectedSkillId: host.selectedSkillId,
        reason: completedMoneyTableAggregate
          ? "completed_money_table_aggregate"
          : "satisfied_edit_task",
      },
    );
    host.traceRecorder?.recordEvent("done_plan_incomplete_bypassed", {
      step: effectiveCurrentIdx,
      remainingSteps: host.planSubtasks.length - effectiveCurrentIdx - 1,
      selectedSkillId: host.selectedSkillId,
      reason: completedMoneyTableAggregate
        ? "completed_money_table_aggregate"
        : "satisfied_edit_task",
    });
  }

  const activeAsyncExpectation =
    host.pendingAsyncVerification &&
    host.pendingAsyncVerification.stepIndex === effectiveCurrentIdx
      ? host.pendingAsyncVerification
      : null;
  if (
    host.pendingAsyncVerification &&
    host.pendingAsyncVerification.stepIndex !== effectiveCurrentIdx
  ) {
    host.pendingAsyncVerification = null;
  }
  if (
    activeAsyncExpectation &&
    !isPendingAsyncChangeSatisfied({
      snapshot: host.context.getSnapshot(),
      expectedTokens: activeAsyncExpectation.expectedTokens,
      baselineLoadingKeywords: activeAsyncExpectation.baselineLoadingKeywords,
    }) &&
    !host.hasRecentToolEvidenceForTokens(
      activeAsyncExpectation.expectedTokens,
    )
  ) {
    shouldReject = true;
    rejectReason = `The last action likely triggered delayed page content, but the expected result is not visible yet. ${activeAsyncExpectation.reason} Wait for the update and verify it before ending the task.`;
  } else if (activeAsyncExpectation) {
    host.pendingAsyncVerification = null;
  }

  return {
    shouldReject,
    rejectReason,
    effectiveCurrentIdx,
    completedMoneyTableAggregate,
  };
}

export async function evaluateDonePlanValidation(
  host: DonePlanValidationHost,
  summary: string,
  effectiveCurrentIdx: number,
  completedMoneyTableAggregate: boolean,
  initialShouldReject: boolean,
  initialRejectReason: string,
): Promise<{ shouldReject: boolean; rejectReason: string }> {
  let shouldReject = initialShouldReject;
  let rejectReason = initialRejectReason;

  try {
    host.stepHandler(
      {
        id: crypto.randomUUID(),
        type: "thinking",
        label: "Verifying completion...",
        status: "running",
        timestamp: Date.now(),
      },
      false,
    );

    // Skip planner validateDone for orchestrator sub-nodes.
    // Sub-nodes only need to satisfy their node-level objective;
    // the orchestrator's own verifier checks node completion.
    // Calling validateDone with the full original query would
    // reject because sibling steps aren't done yet.
    if (!shouldReject && !host.nodeId && !completedMoneyTableAggregate) {
      const currentSubtask =
        effectiveCurrentIdx >= 0
          ? host.planSubtasks[effectiveCurrentIdx]
          : undefined;
      const interpretation = host.perception.getInterpretation();
      const validationPerception = shouldOmitPerceptionForDoneValidation({
        interpretation,
        hasReadPage: host.hasReadPage,
        originalQuery: host.originalQuery,
        activeStepDescription: currentSubtask?.description,
        activeStepToolProfile:
          currentSubtask?.toolProfile &&
          resolveToolProfile(currentSubtask.toolProfile as ToolProfile)
            ? (currentSubtask.toolProfile as ToolProfile)
            : undefined,
      })
        ? undefined
        : (interpretation ?? undefined);
      const lastEffect = host.stagnation.lastActionEffect;
      const stateEvidence = lastEffect
        ? formatStateEvidence(lastEffect)
        : undefined;
      const validation = await host.planner.validateDone(
        host.originalQuery,
        host.planSubtasks,
        summary,
        host.context.getSnapshot()?.title || "",
        host.context.getSnapshot()?.url || "",
        host.abortController!.signal,
        validationPerception,
        host.planSteps[effectiveCurrentIdx]?.successCriteria,
        stateEvidence ?? undefined,
      );

      if (!validation.approved) {
        shouldReject = true;
        rejectReason = validation.reason || "Task is not yet complete.";
      }
    }
  } catch (_err: any) {
    // Planner call failed - structural fallback
    const completedCount = host.planSubtasks.filter(
      (s) => s.status === "completed",
    ).length;
    if (completedCount < host.planSubtasks.length) {
      shouldReject = true;
      rejectReason = `Planner unavailable. ${completedCount}/${host.planSubtasks.length} subtasks completed. Continue.`;
    }
  }

  return { shouldReject, rejectReason };
}
