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
import type { PageStateCoordinator } from "./page-state";
import { ToolProfile, resolveToolProfile } from "../tools/metadata";
import { shouldOmitPerceptionForDoneValidation } from "./perception-done-validation";
import {
  isPendingAsyncChangeSatisfied,
  formatStateEvidence,
  tokenizeStepText,
  matchSuccessCriteria,
} from "./loop-helpers";
import {
  assessDoneSummary,
  checkSummaryStepCoherence,
} from "./verification";
import { normalizeGuardText } from "./text-entry-guards";

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
  readonly perception: PageStateCoordinator;
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
      shouldBypassPlanIncompleteDoneRejection(host, {
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

export function shouldBypassPlanIncompleteDoneRejection(
host: DonePlanValidationHost,
params: {
  summary: string;
  currentStepIndex: number;
}): boolean {
  const { summary, currentStepIndex } = params;
  if (
    currentStepIndex < 0 ||
    currentStepIndex >= host.planSubtasks.length - 1 ||
    currentStepIndex >= host.planSteps.length
  ) {
    return false;
  }

  const currentStep = host.planSteps[currentStepIndex];
  if (!currentStep?.successCriteria) return false;

  const taskContext = [
    host.originalQuery,
    host.planSubtasks[currentStepIndex]?.description,
    currentStep.successCriteria,
  ]
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join("\n");

  const sentiment = assessDoneSummary(summary);
  if (!sentiment.confident) return false;

  if (host.nodeId) {
    const snapshot = host.context.getSnapshot();
    const summaryTokens = new Set(tokenizeStepText(summary));
    const snapshotText = normalizeGuardText(
      `${snapshot?.title || ""}\n${snapshot?.url || ""}\n${snapshot?.visibleContent || ""}\n${snapshot?.pageContent || ""}`,
    );
    const groundedSummaryTokens = [...summaryTokens].filter((token) =>
      snapshotText.includes(token),
    );
    if (groundedSummaryTokens.length >= 2) {
      return true;
    }
  }

  const summaryText = normalizeGuardText(summary);
  const snapshot = host.context.getSnapshot();
  const snapshotText = normalizeGuardText(
    `${snapshot?.title || ""}\n${snapshot?.url || ""}\n${snapshot?.visibleContent || ""}\n${snapshot?.pageContent || ""}`,
  );
  const confirmationIntent =
    /\b(submit|submission|confirm|confirmation|sent|saved|applied|placed)\b/i.test(
      taskContext,
    );
  const summaryShowsFinalization =
    /\b(submitted?|submission complete|completed?|confirmed?|confirmation|saved|applied|sent|placed|finished)\b/i.test(
      summaryText,
    );
  const snapshotShowsFinalState =
    /\b(submission complete|submitted successfully|success(?:fully)?|thank you|reference(?: number)?|confirmation(?: number| page)?|has been submitted|request received|completed successfully|order confirmed|receipt)\b/i.test(
      snapshotText,
    );

  const multiTabChecklistIntent =
    host.selectedSkillId === "multi-tab-checklist-workflow" ||
    /\b(procurement|purchase|buy|checklist|source list|separate tabs?|new tabs?)\b/i.test(
      taskContext,
    );
  if (multiTabChecklistIntent) {
    const summaryShowsTargetWork =
      /\b(purchase|purchased|order|ordered|confirmed|bought|place(?:d)? order|reviewed|captured|extracted|recorded)\b/i.test(
        summaryText,
      );
    const summaryShowsSourceReturn =
      /\b(check(?:ed|ing)? off|mark(?:ed|ing)? .* (?:done|complete|reviewed)|record(?:ed|ing)? .* reviewed|returned? to .* (?:list|checklist|procurement|board|source)|back on .* (?:list|checklist|procurement|board|source))\b/i.test(
        summaryText,
      );
    const sourceLooksComplete =
      /\b\d+\s+of\s+\d+\s+items?\s+completed\b/i.test(snapshotText) ||
      /\b(mark .* as done|all items procured|viewed|reviewed|completed)\b/i.test(
        snapshotText,
      );

    if (
      summaryShowsTargetWork &&
      summaryShowsSourceReturn &&
      sourceLooksComplete
    ) {
      return true;
    }
  }

  if (
    confirmationIntent &&
    summaryShowsFinalization &&
    snapshotShowsFinalState
  ) {
    return true;
  }

  const nextStepText = normalizeGuardText(
    [
      host.planSubtasks[currentStepIndex + 1]?.description,
      host.planSteps[currentStepIndex + 1]?.objective,
      host.planSteps[currentStepIndex + 1]?.successCriteria,
    ]
      .filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      )
      .join("\n"),
  );
  const nextStepIsFinalizationOnly =
    /\b(?:terminate|end|close|finali[sz]e)\b[\s\S]{0,80}\b(?:task|workflow|run)\b/i.test(
      nextStepText,
    ) ||
    /\b(?:finish|complete)\s+(?:the\s+)?(?:task|workflow|run)\b/i.test(
      nextStepText,
    ) ||
    /\b(?:task|workflow|run)\s+(?:is\s+)?(?:finished|complete|completed|done)\b/i.test(
      nextStepText,
    ) ||
    /\b(?:call|use)\s+done\b/i.test(nextStepText) ||
    /\breport\s+(?:success|completion|that\b[\s\S]{0,80}\bcomplete)/i.test(
      nextStepText,
    );
  const terminalMutationIntent =
    /\b(confirm|confirmation|delete|deletion|remove|removal|submit|submission|save|apply|send|post|complete|success|close|dismiss|update|change)\b/i.test(
      taskContext,
    );
  const summaryShowsTerminalState =
    /\b(success(?:fully)?|completed?|confirmed?|deleted?|removed?|saved|submitted?|sent|posted|closed|dismissed|updated|changed|finished)\b/i.test(
      summaryText,
    );
  const snapshotShowsTerminalMutation =
    /\b(?:deleted|removed|saved|submitted|sent|posted|closed|dismissed|updated|changed|completed|confirmed)\s+successfully\b/i.test(
      snapshotText,
    ) ||
    /\b(?:success|successful|thank you|confirmation|receipt|completed)\b/i.test(
      snapshotText,
    );
  if (
    nextStepIsFinalizationOnly &&
    terminalMutationIntent &&
    summaryShowsTerminalState &&
    snapshotShowsTerminalMutation
  ) {
    const coherence = checkSummaryStepCoherence({
      summary,
      currentStepIndex,
      stepDescriptions: host.planSubtasks.map((s) => s.description),
    });
    if (coherence.coherent) return true;
  }

  const editIntent =
    /\b(change|edit|update|replace|set|type|enter|revise|rewrite)\b/i.test(
      taskContext,
    );
  const inPlaceSurface =
    /\b(spreadsheet|grid|cell|row|column|sheet|table|field|value|draft|reply|email|message|text|copy|wording)\b/i.test(
      taskContext,
    );
  if (!editIntent || !inPlaceSurface) return false;

  const criteriaCheck = matchSuccessCriteria({
    successCriteria: currentStep.successCriteria,
    snapshot,
  });
  if (!criteriaCheck.satisfied) return false;

  const coherence = checkSummaryStepCoherence({
    summary,
    currentStepIndex,
    stepDescriptions: host.planSubtasks.map((s) => s.description),
  });
  if (!coherence.coherent) return false;

  return true;
}
