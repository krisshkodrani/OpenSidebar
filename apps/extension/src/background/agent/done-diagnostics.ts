/**
 * done diagnostics (RFC LP-16 Phase 3 — loop.ts landmine decomposition).
 *
 * Assemble the human-readable list of reasons a done() looks premature (missing
 * required evidence, unreviewed list-detail actions, money-table aggregate gaps,
 * task-context mismatch, …), folded into the rejection diagnostic message after
 * repeated done() attempts. Read-only over the host's plan/evidence/progress
 * state — extracted verbatim from loop() via the dispatch-host idiom (loop()
 * passes `this`); behavior-preserving.
 */

import type { ContextManager } from "./context";
import type { PlanStep } from "./planner";
import type { SubtaskSummary } from "../../types";
import {
  evaluateCompletionEarlyMultiStepPreflight,
  evaluateCompletionGroundingReadPreflight,
  evaluateCompletionListDetailReviewPreflight,
  evaluateCompletionMoneyTableAggregatePreflight,
  evaluateCompletionPendingAutocompletePreflight,
  evaluateCompletionRequiredEvidencePreflight,
  evaluateCompletionSummaryPreflight,
  evaluateCompletionTaskContractPreflight,
  evaluateCompletionWorkflowContractPreflight,
} from "./completion-kernel";
import { countVisibleListDetailActions } from "./list-detail-policy";

export interface DoneDiagnosticsHost {
  readonly originalQuery: string;
  readonly planSubtasks: SubtaskSummary[];
  readonly planSteps: PlanStep[];
  readonly context: ContextManager;
  readonly turnCount: number;
  readonly selectedSkillId: string | null;
  readonly nodeId: string | null;
  readonly taskId: string | null;
  readonly doneRejections: number;
  readonly hasReadPage: boolean;
  readonly hasExplicitPageRead: boolean;
  readonly listDetailVisibleActionCount: number;
  readonly listDetailReviewedTargets: ReadonlySet<string>;
  isSkillOwnedListDetailReview(): boolean;
  getMissingRequiredEvidenceTypes(): string[];
  getIncorrectMoneyTableAggregateDoneRejection(summary: string): string | null;
  getIncompleteMoneyTableAggregateDoneRejection(): string | null;
  getCompletionSummaryTaskContext(): string;
}

export function collectDoneDiagnosticIssues(
host: DoneDiagnosticsHost,
summary: string,
): string[] {
  const issues = new Set<string>();
  const addIssue = (label: string, reason: string | null | undefined) => {
    const clean = reason?.trim();
    if (clean) issues.add(`${label}: ${clean}`);
  };

  const summaryPreflight = evaluateCompletionSummaryPreflight({
    summary,
    taskContext: host.getCompletionSummaryTaskContext(),
    turnCount: host.turnCount,
    rootUserRequest: host.originalQuery,
    isOrchestratorNode: Boolean(host.nodeId),
  });
  if (summaryPreflight.status !== "valid") {
    addIssue("summary", summaryPreflight.reason);
  }

  const groundingPreflight = evaluateCompletionGroundingReadPreflight({
    userRequest: host.originalQuery,
    summary,
    snapshot: host.context.getSnapshot(),
    hasReadPage: host.hasReadPage,
    hasExplicitPageRead: host.hasExplicitPageRead,
    hasTaskId: Boolean(host.taskId),
  });
  if (groundingPreflight.status === "rejected") {
    issues.add("grounding: call read_page first to verify actual page content");
  }

  const incompleteMoneyTableScan =
    host.getIncompleteMoneyTableAggregateDoneRejection();
  const moneyTablePreflight = evaluateCompletionMoneyTableAggregatePreflight({
    incompleteScanReason: incompleteMoneyTableScan,
    incorrectAnswerReason: incompleteMoneyTableScan
      ? null
      : host.getIncorrectMoneyTableAggregateDoneRejection(summary),
  });
  if (moneyTablePreflight.status !== "valid") {
    addIssue("money table", moneyTablePreflight.reason);
  }

  const earlyMultiStepPreflight = evaluateCompletionEarlyMultiStepPreflight({
    userRequest: host.originalQuery,
    doneRejections: host.doneRejections,
    turnCount: host.turnCount,
    hasNodeId: Boolean(host.nodeId),
  });
  if (earlyMultiStepPreflight.status !== "valid") {
    issues.add(
      `plan progress: task has ${earlyMultiStepPreflight.stepCount} steps and is not ready to finish`,
    );
  }

  const taskContractGuard = host.isSkillOwnedListDetailReview()
    ? null
    : evaluateCompletionTaskContractPreflight({
        userRequest: host.originalQuery,
        summary,
        snapshot: host.context.getSnapshot(),
      });
  if (taskContractGuard?.blocked) {
    addIssue("task contract", taskContractGuard.reason);
  }

  const workflowSnapshot = host.context.getSnapshot();
  const workflowDoneGuard = evaluateCompletionWorkflowContractPreflight({
    userRequest: host.originalQuery,
    summary,
    selectedSkillId: host.selectedSkillId,
    pageUrl: workflowSnapshot?.url,
    pageTitle: workflowSnapshot?.title,
  });
  if (workflowDoneGuard.blocked) {
    addIssue("workflow contract", workflowDoneGuard.reason);
  }

  const visibleDetailActionCount = Math.max(
    host.listDetailVisibleActionCount,
    countVisibleListDetailActions(host.context.getSnapshot()),
  );
  const listDetailPreflight = evaluateCompletionListDetailReviewPreflight({
    selectedSkillId: host.selectedSkillId,
    userRequest: host.originalQuery,
    reviewedDetailCount: host.listDetailReviewedTargets.size,
    visibleDetailActionCount,
  });
  if (listDetailPreflight.status !== "valid") {
    addIssue("list-detail review", listDetailPreflight.reason);
  }

  const activePlanIdx =
    host.planSubtasks.length > 0
      ? host.planSubtasks.findIndex((s) => s.status === "running")
      : -1;
  const effectivePlanIdx =
    activePlanIdx >= 0
      ? activePlanIdx
      : Math.min(
          host.planSubtasks.filter((s) => s.status === "completed").length,
          host.planSubtasks.length - 1,
        );
  const autocompletePreflight = evaluateCompletionPendingAutocompletePreflight({
    snapshot: host.context.getSnapshot(),
    userRequest: host.originalQuery,
    activeObjective:
      effectivePlanIdx >= 0
        ? host.planSubtasks[effectivePlanIdx]?.description
        : undefined,
    successCriteria:
      effectivePlanIdx >= 0
        ? host.planSteps[effectivePlanIdx]?.successCriteria
        : undefined,
    summary,
  });
  if (autocompletePreflight.status !== "valid") {
    addIssue("autocomplete", autocompletePreflight.reason);
  }

  const requiredEvidencePreflight =
    evaluateCompletionRequiredEvidencePreflight({
      missingRequiredEvidence: host.getMissingRequiredEvidenceTypes(),
    });
  if (requiredEvidencePreflight.status !== "valid") {
    issues.add(
      `typed evidence: missing ${requiredEvidencePreflight.missingRequiredEvidence.join(", ")}`,
    );
  }

  return Array.from(issues);
}
