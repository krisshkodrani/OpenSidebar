import type { DomSnapshot } from "../../../types";
import { countExplicitSteps } from "../explicit-steps";
import { getListDetailDoneRejection } from "../list-detail-policy";
import {
  isDoneSummaryGroundedInSnapshot,
  requiresGroundingReadBeforeDone,
} from "../loop-helpers";
import { getIncompleteDoneSummaryReason } from "../summary-completeness";
import {
  assessTaskContractCoverage,
  buildTaskContract,
} from "../task-contract";
import { getAutocompleteSuggestionDoneRejection } from "../text-entry-guards";
import { assessWorkflowDoneGuard } from "../verification";
import type {
  CompletionEarlyMultiStepPreflight,
  CompletionGroundingReadPreflight,
  CompletionListDetailReviewPreflight,
  CompletionMoneyTableAggregatePreflight,
  CompletionPendingAutocompletePreflight,
  CompletionRequiredEvidencePreflight,
  CompletionSummaryPreflight,
  CompletionTaskContractPreflight,
  CompletionWorkflowContractPreflight,
} from "./kernel-types";

export function isDoneSummaryAskingClarification(summary: string): boolean {
  const text = summary.trim();
  if (!text.includes("?")) return false;

  const lower = text.toLowerCase();
  const hasCompletionFrame =
    /\b(completed|successfully|identified|found|located|confirmed|verified|posted|sent|drafted|updated|read|analysis complete|summary)\b/.test(
      lower,
    );
  if (hasCompletionFrame) return false;

  if (
    /^(can|could|should|do|does|did|is|are|which|what|when|where|who|why|how|would|please)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return /\?$/.test(text);
}

export function evaluateCompletionSummaryPreflight(params: {
  summary: string;
  taskContext: string;
  turnCount: number;
  rootUserRequest?: string;
  isOrchestratorNode?: boolean;
}): CompletionSummaryPreflight {
  if (
    params.turnCount <= 2 &&
    isDoneSummaryAskingClarification(params.summary)
  ) {
    return {
      status: "needs_clarification",
      reason: "done_summary_is_question",
    };
  }

  const incompleteReason = getIncompleteDoneSummaryReason({
    summary: params.summary,
    taskContext: params.taskContext,
  });
  if (incompleteReason) {
    return {
      status: "rejected",
      kind: "incomplete_summary",
      reason: incompleteReason,
    };
  }

  if (params.rootUserRequest && !params.isOrchestratorNode) {
    const multiReturnContract = buildTaskContract(params.rootUserRequest);
    if ((multiReturnContract.multiReturnCount ?? 0) >= 2) {
      const multiCoverage = assessTaskContractCoverage({
        contract: multiReturnContract,
        text: params.summary,
      });
      if (!multiCoverage.satisfied) {
        return {
          status: "rejected",
          kind: "missing_multi_return_coverage",
          reason:
            `Query requires ${multiReturnContract.multiReturnCount} results ` +
            `(detected "both"/"all") but summary only covers ` +
            `${multiReturnContract.requiredEntities.length - multiCoverage.missingEntities.length}. ` +
            `Missing: ${multiCoverage.missingEntities.join(", ")}`,
        };
      }
    }
  }

  return { status: "valid" };
}

export function evaluateCompletionPendingAutocompletePreflight(params: {
  snapshot: DomSnapshot | null | undefined;
  userRequest: string;
  activeObjective?: string;
  successCriteria?: string;
  summary?: string;
}): CompletionPendingAutocompletePreflight {
  const rejection = getAutocompleteSuggestionDoneRejection({
    snapshot: params.snapshot,
    originalQuery: params.userRequest,
    activeObjective: params.activeObjective,
    successCriteria: params.successCriteria,
    summary: params.summary,
  });
  if (!rejection) return { status: "valid" };

  return {
    status: "rejected",
    kind: "pending_autocomplete_suggestion",
    ...rejection,
  };
}

/**
 * Reject done() when the final summary drops required task entities/results or
 * when a round-trip task has not actually returned to the required page.
 */
export function evaluateCompletionTaskContractPreflight(params: {
  userRequest: string;
  summary: string;
  snapshot: DomSnapshot | null | undefined;
}): CompletionTaskContractPreflight {
  const contract = buildTaskContract(params.userRequest);
  const hasObligations =
    contract.requiresRoundTrip ||
    contract.requiredEntities.length > 0 ||
    contract.requiredNumbers.length > 0;

  const summaryCoverage = assessTaskContractCoverage({
    contract,
    text: params.summary,
  });

  if (!hasObligations) {
    return {
      blocked: false,
      reason: null,
      summaryCoverage,
      missingReturnTarget: false,
    };
  }

  const returnTargetCoverage = contract.requiresRoundTrip
    ? assessTaskContractCoverage({
        contract: {
          ...contract,
          requiredEntities: [],
          requiredNumbers: [],
        },
        text: taskContractSnapshotSearchText(params.snapshot),
        requireReturnTarget: true,
      })
    : null;

  const reasons: string[] = [];
  if (summaryCoverage.missingEntities.length > 0) {
    reasons.push(
      `final summary is missing required targets: ${summaryCoverage.missingEntities.join(", ")}`,
    );
  }
  if (summaryCoverage.missingNumbers.length > 0) {
    reasons.push(
      `final summary is missing required values: ${summaryCoverage.missingNumbers.join(", ")}`,
    );
  }
  if (summaryCoverage.missingExhaustiveCoverage) {
    reasons.push(
      "final summary does not confirm exhaustive coverage of the requested items",
    );
  }
  if (summaryCoverage.missingMultiReturnCoverage) {
    reasons.push("final summary does not cover all required requested results");
  }
  if (returnTargetCoverage?.missingReturnTarget) {
    reasons.push(
      `you have not actually returned to the required page before finishing`,
    );
  }

  return {
    blocked: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
    summaryCoverage,
    missingReturnTarget: Boolean(returnTargetCoverage?.missingReturnTarget),
  };
}

export function evaluateCompletionGroundingReadPreflight(params: {
  userRequest: string;
  summary: string;
  snapshot: DomSnapshot | null | undefined;
  hasReadPage: boolean;
  hasExplicitPageRead: boolean;
  hasTaskId: boolean;
}): CompletionGroundingReadPreflight {
  const needsGroundingRead = requiresGroundingReadBeforeDone(
    params.userRequest,
  );
  const hasEnoughGrounding = needsGroundingRead
    ? params.hasExplicitPageRead
    : params.hasReadPage;
  if (hasEnoughGrounding || (!params.hasTaskId && !needsGroundingRead)) {
    return { status: "valid", needsGroundingRead };
  }

  const elementCount = params.snapshot?.elements?.length ?? 0;
  const visibleLen = (
    params.snapshot?.visibleContent ||
    params.snapshot?.pageContent ||
    ""
  ).length;
  if (elementCount <= 5 || visibleLen <= 100) {
    return { status: "valid", needsGroundingRead };
  }
  if (
    isDoneSummaryGroundedInSnapshot(params.summary, params.snapshot ?? null)
  ) {
    return {
      status: "grounded_from_snapshot",
      needsGroundingRead,
      elementCount,
      visibleLen,
    };
  }

  return {
    status: "rejected",
    kind: "missing_grounding_read",
    needsGroundingRead,
    elementCount,
    visibleLen,
  };
}

export function evaluateCompletionEarlyMultiStepPreflight(params: {
  userRequest: string;
  doneRejections: number;
  turnCount: number;
  hasNodeId: boolean;
}): CompletionEarlyMultiStepPreflight {
  if (
    params.doneRejections !== 0 ||
    !params.userRequest ||
    params.hasNodeId
  ) {
    return { status: "valid", stepCount: 0 };
  }

  const stepCount = countExplicitSteps(params.userRequest);
  // turnCount includes planner setup; <=3 means the executor has had at most
  // one action turn before trying to complete a 3+ step root task.
  if (stepCount < 3 || params.turnCount > 3) {
    return { status: "valid", stepCount };
  }

  return { status: "rejected", kind: "early_multi_step", stepCount };
}

export function evaluateCompletionMoneyTableAggregatePreflight(params: {
  incompleteScanReason?: string | null;
  incorrectAnswerReason?: string | null;
}): CompletionMoneyTableAggregatePreflight {
  if (params.incompleteScanReason) {
    return {
      status: "rejected",
      kind: "incomplete_money_table_scan",
      reason: params.incompleteScanReason,
    };
  }

  if (params.incorrectAnswerReason) {
    return {
      status: "rejected",
      kind: "incorrect_money_table_answer",
      reason: params.incorrectAnswerReason,
    };
  }

  return { status: "valid" };
}

export function evaluateCompletionRequiredEvidencePreflight(params: {
  missingRequiredEvidence: string[];
}): CompletionRequiredEvidencePreflight {
  if (params.missingRequiredEvidence.length === 0) {
    return { status: "valid" };
  }

  return {
    status: "rejected",
    kind: "missing_required_evidence",
    missingRequiredEvidence: [...params.missingRequiredEvidence],
  };
}

export function evaluateCompletionListDetailReviewPreflight(params: {
  selectedSkillId?: string | null;
  userRequest: string;
  reviewedDetailCount: number;
  visibleDetailActionCount: number;
}): CompletionListDetailReviewPreflight {
  const rejection = getListDetailDoneRejection({
    selectedSkillId: params.selectedSkillId,
    query: params.userRequest,
    reviewedDetailCount: params.reviewedDetailCount,
    visibleDetailActionCount: params.visibleDetailActionCount,
  });
  if (!rejection) return { status: "valid" };

  return {
    status: "rejected",
    kind: "incomplete_list_detail_review",
    reason: rejection,
  };
}

export function evaluateCompletionWorkflowContractPreflight(params: {
  userRequest: string;
  summary: string;
  selectedSkillId?: string | null;
  pageUrl?: string;
  pageTitle?: string;
}): CompletionWorkflowContractPreflight {
  return assessWorkflowDoneGuard({
    query: params.userRequest,
    summary: params.summary,
    selectedSkillId: params.selectedSkillId,
    pageUrl: params.pageUrl,
    pageTitle: params.pageTitle,
  });
}

function taskContractSnapshotSearchText(
  snapshot: DomSnapshot | null | undefined,
): string {
  if (!snapshot) return "";
  const elementText = snapshot.elements
    .flatMap((element) => [
      element.text,
      element.tagName,
      element.attributes.id,
      element.attributes.name,
      element.attributes.placeholder,
      element.attributes["aria-label"],
      element.attributes.label,
      element.attributes.value,
    ])
    .filter(Boolean)
    .join(" ");
  return [
    snapshot.title,
    snapshot.url,
    snapshot.pageContent,
    snapshot.visibleContent,
    elementText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
