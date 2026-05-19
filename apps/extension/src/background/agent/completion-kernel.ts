import type { DomSnapshot, TaggedElement, ToolName } from "../../types";
import {
  hasDraftPreservedEvidence,
  hasStrongCommunicationSentEvidence,
  isDraftOnlyCommunicationTask,
} from "./consequential-action-policy";
import { getIncompleteDoneSummaryReason } from "./summary-completeness";
import {
  assessTaskContractCoverage,
  buildTaskContract,
  type TaskContract,
  type TaskContractCoverage,
} from "./task-contract";
import {
  getAutocompleteSuggestionDoneRejection,
  type AutocompleteSuggestionDoneRejection,
} from "./text-entry-guards";
import { getListDetailDoneRejection } from "./list-detail-policy";
import {
  assessWorkflowDoneGuard,
  type WorkflowDoneGuardResult,
} from "./verification";
import {
  isDoneSummaryGroundedInSnapshot,
  requiresGroundingReadBeforeDone,
} from "./loop-helpers";
import { countExplicitSteps } from "./explicit-steps";

export type CompletionCandidateSource = "model_done" | "trusted_tool";
export type CompletionConfidence = "medium" | "high";

export type CompletionEvidence =
  | {
      type: "selected_state";
      confidence: CompletionConfidence;
      logicalKey: string;
      observedAtTurn: number;
      detail: {
        elementId?: number;
        stableKey?: string;
        label: string;
        checked: boolean;
        questionNumber?: number;
      };
    }
  | {
      type: "correct_feedback";
      confidence: CompletionConfidence;
      logicalKey: string;
      observedAtTurn: number;
      detail: {
        questionNumber?: number;
        text: string;
      };
    }
  | {
      type: "field_value";
      confidence: CompletionConfidence;
      logicalKey: string;
      observedAtTurn: number;
      detail: {
        label: string;
        value: string;
        elementId?: number;
        stableKey?: string;
      };
    }
  | {
      type: "draft_state";
      confidence: CompletionConfidence;
      logicalKey: string;
      observedAtTurn: number;
      detail: {
        target: string;
        text: string;
        submitted: boolean;
      };
    }
  | {
      type: "confirmation_state";
      confidence: CompletionConfidence;
      logicalKey: string;
      observedAtTurn: number;
      detail: {
        text: string;
        recordId?: string;
        url?: string;
        action?: WorkflowConfirmationAction;
        targetText?: string;
        source?:
          | "visible_text"
          | "modal_disappearance"
          | "target_disappearance"
          | "draft_disappearance"
          | "status_change"
          | "control_label_change"
          | "control_state_change"
          | "dirty_indicator_cleared"
          | "trusted_workflow";
      };
    }
  | {
      type: "answer_state";
      confidence: CompletionConfidence;
      logicalKey: string;
      observedAtTurn: number;
      detail: {
        answer: string;
        question?: string;
        source: "knowledge_base_search" | "page_read";
        evidenceText: string;
        url?: string;
      };
    }
  | {
      type: "validation_error";
      confidence: CompletionConfidence;
      logicalKey: string;
      observedAtTurn: number;
      detail: {
        text: string;
        fieldLabel?: string;
        value?: string;
        inputElementId?: number;
        suggestionElementId?: number;
      };
    }
  | {
      type: "navigation_state";
      confidence: CompletionConfidence;
      logicalKey: string;
      observedAtTurn: number;
      detail: {
        url: string;
        title?: string;
      };
    };

export type QuizTarget =
  | { kind: "current_visible_question"; questionNumber?: number }
  | { kind: "question_number"; questionNumber: number };

export interface QuizSelectionContract {
  kind: "quiz_selection";
  target: QuizTarget;
  requiresSubmit: boolean;
  requiresCorrectFeedback: boolean;
  selectionCardinality?: number | "one_or_more";
  expectedSelections?: string[];
}

export interface FormFillFieldExpectation {
  label: string;
  value: string;
  elementId?: number;
  stableKey?: string;
}

export interface FormFillContract {
  kind: "form_fill";
  requiredFields: FormFillFieldExpectation[];
  requiresSubmit: boolean;
  requiresConfirmation: boolean;
}

export interface NavigationContract {
  kind: "navigation";
  targetUrl: string;
  targetHost: string;
}

export interface DraftOnlyContract {
  kind: "draft_only";
  requiresUnsent: true;
}

export interface ReadAnswerContract {
  kind: "read_answer";
  requiresGroundedPageEvidence: true;
  taskContract?: TaskContract;
  expectedAnswerLabel?: string;
}

export type WorkflowConfirmationAction =
  | "delete"
  | "archive"
  | "save"
  | "send"
  | "export"
  | "download"
  | "upload"
  | "import"
  | "attach"
  | "detach"
  | "copy"
  | "transfer"
  | "move"
  | "rename"
  | "merge"
  | "schedule"
  | "unschedule"
  | "deploy"
  | "rollback"
  | "backup"
  | "reset"
  | "suspend"
  | "unsuspend"
  | "block"
  | "unblock"
  | "link"
  | "unlink"
  | "tag"
  | "untag"
  | "flag"
  | "unflag"
  | "duplicate"
  | "restore"
  | "create"
  | "share"
  | "grant"
  | "revoke"
  | "install"
  | "uninstall"
  | "connect"
  | "disconnect"
  | "sync"
  | "invite"
  | "subscribe"
  | "unsubscribe"
  | "pin"
  | "unpin"
  | "mute"
  | "unmute"
  | "follow"
  | "unfollow"
  | "bookmark"
  | "unbookmark"
  | "favorite"
  | "unfavorite"
  | "watch"
  | "unwatch"
  | "star"
  | "unstar"
  | "post"
  | "approve"
  | "reject"
  | "close"
  | "reopen"
  | "cancel"
  | "enable"
  | "disable"
  | "assign"
  | "unassign"
  | "escalate"
  | "deescalate"
  | "lock"
  | "unlock"
  | "pause"
  | "resume"
  | "start"
  | "stop"
  | "restart"
  | "refresh"
  | "dismiss"
  | "update"
  | "submit"
  | "complete";

const WORKFLOW_CONFIRMATION_ACTIONS: WorkflowConfirmationAction[] = [
  "delete",
  "archive",
  "save",
  "send",
  "export",
  "download",
  "upload",
  "import",
  "attach",
  "detach",
  "copy",
  "transfer",
  "move",
  "rename",
  "merge",
  "schedule",
  "unschedule",
  "deploy",
  "rollback",
  "backup",
  "reset",
  "suspend",
  "unsuspend",
  "block",
  "unblock",
  "link",
  "unlink",
  "tag",
  "untag",
  "flag",
  "unflag",
  "duplicate",
  "restore",
  "create",
  "share",
  "grant",
  "revoke",
  "install",
  "uninstall",
  "connect",
  "disconnect",
  "sync",
  "invite",
  "subscribe",
  "unsubscribe",
  "pin",
  "unpin",
  "mute",
  "unmute",
  "follow",
  "unfollow",
  "bookmark",
  "unbookmark",
  "favorite",
  "unfavorite",
  "watch",
  "unwatch",
  "star",
  "unstar",
  "post",
  "approve",
  "reject",
  "close",
  "reopen",
  "cancel",
  "enable",
  "disable",
  "assign",
  "unassign",
  "escalate",
  "deescalate",
  "lock",
  "unlock",
  "pause",
  "resume",
  "start",
  "stop",
  "restart",
  "refresh",
  "dismiss",
  "update",
  "submit",
  "complete",
];

type WorkflowConfirmationTextMode = "summary" | "visible";
type TargetAwareVisibleWorkflowAction = Extract<
  WorkflowConfirmationAction,
  | "delete"
  | "archive"
  | "save"
  | "send"
  | "export"
  | "download"
  | "upload"
  | "import"
  | "attach"
  | "detach"
  | "copy"
  | "transfer"
  | "move"
  | "rename"
  | "merge"
  | "schedule"
  | "unschedule"
  | "deploy"
  | "rollback"
  | "backup"
  | "reset"
  | "suspend"
  | "unsuspend"
  | "block"
  | "unblock"
  | "link"
  | "unlink"
  | "tag"
  | "untag"
  | "flag"
  | "unflag"
  | "duplicate"
  | "restore"
  | "create"
  | "share"
  | "grant"
  | "revoke"
  | "install"
  | "uninstall"
  | "connect"
  | "disconnect"
  | "sync"
  | "invite"
  | "subscribe"
  | "unsubscribe"
  | "pin"
  | "unpin"
  | "mute"
  | "unmute"
  | "follow"
  | "unfollow"
  | "bookmark"
  | "unbookmark"
  | "favorite"
  | "unfavorite"
  | "watch"
  | "unwatch"
  | "star"
  | "unstar"
  | "post"
  | "approve"
  | "reject"
  | "close"
  | "reopen"
  | "cancel"
  | "enable"
  | "disable"
  | "assign"
  | "unassign"
  | "escalate"
  | "deescalate"
  | "lock"
  | "unlock"
  | "pause"
  | "resume"
  | "start"
  | "stop"
  | "restart"
  | "refresh"
  | "update"
  | "submit"
  | "complete"
>;

export interface WorkflowConfirmationContract {
  kind: "workflow_confirmation";
  action: WorkflowConfirmationAction;
  targetLabel?: string;
}

export type CompletionContract =
  | QuizSelectionContract
  | FormFillContract
  | NavigationContract
  | DraftOnlyContract
  | ReadAnswerContract
  | WorkflowConfirmationContract;

export interface GeneratedCompletionContract {
  contract: CompletionContract;
  confidence: "low" | "medium" | "high";
  source: "heuristic" | "planner" | "task_contract" | "skill";
  repairable: boolean;
  notes: string[];
}

export interface CompletionEnvelope {
  status: "completed";
  resultId: string;
  source: CompletionCandidateSource;
  contractKind: string;
  decisionReason: string;
  evidenceKeys: string[];
  evidenceEpoch: string;
}

export interface TrustedCompletionCandidate {
  contractKind: string;
  decisionReason: string;
  evidence: CompletionEvidence[];
}

export type CompletionEvaluation =
  | {
      status: "accepted";
      reason: string;
      contract: CompletionContract;
      evidence: CompletionEvidence[];
    }
  | {
      status: "rejected";
      reason: string;
      contract: CompletionContract;
      evidence: CompletionEvidence[];
    }
  | {
      status: "needs_verification";
      reason: string;
      hint: string;
      contract: CompletionContract;
      evidence: CompletionEvidence[];
    }
  | {
      status: "inconclusive";
      reason: string;
      contract?: CompletionContract;
      evidence: CompletionEvidence[];
    };

export type CompletionSummaryPreflight =
  | { status: "valid" }
  | {
      status: "needs_clarification";
      reason: "done_summary_is_question";
    }
  | {
      status: "rejected";
      reason: string;
      kind: "incomplete_summary" | "missing_multi_return_coverage";
    };

export type CompletionPendingAutocompletePreflight =
  | { status: "valid" }
  | ({
      status: "rejected";
      kind: "pending_autocomplete_suggestion";
    } & AutocompleteSuggestionDoneRejection);

export type CompletionListDetailReviewPreflight =
  | { status: "valid" }
  | {
      status: "rejected";
      kind: "incomplete_list_detail_review";
      reason: string;
    };

export type CompletionGroundingReadPreflight =
  | { status: "valid"; needsGroundingRead: boolean }
  | {
      status: "grounded_from_snapshot";
      needsGroundingRead: boolean;
      elementCount: number;
      visibleLen: number;
    }
  | {
      status: "rejected";
      kind: "missing_grounding_read";
      needsGroundingRead: boolean;
      elementCount: number;
      visibleLen: number;
    };

export type CompletionEarlyMultiStepPreflight =
  | { status: "valid"; stepCount: number }
  | { status: "rejected"; kind: "early_multi_step"; stepCount: number };

export type CompletionMoneyTableAggregatePreflight =
  | { status: "valid" }
  | {
      status: "rejected";
      kind: "incomplete_money_table_scan" | "incorrect_money_table_answer";
      reason: string;
    };

export type CompletionRequiredEvidencePreflight =
  | { status: "valid" }
  | {
      status: "rejected";
      kind: "missing_required_evidence";
      missingRequiredEvidence: string[];
    };

export interface CompletionTaskContractPreflight {
  blocked: boolean;
  reason: string | null;
  summaryCoverage: TaskContractCoverage;
  missingReturnTarget: boolean;
}

export type CompletionWorkflowContractPreflight = WorkflowDoneGuardResult;

type ChoiceKind = "checkbox" | "radio";

interface ChoiceObservation {
  elementId: number;
  stableKey: string;
  label: string;
  checked: boolean;
  kind: ChoiceKind;
  questionNumber?: number;
}

type FormFieldKind = "text" | "select" | "checkbox" | "radio";

interface FormFieldObservation {
  elementId: number;
  stableKey: string;
  label: string;
  value: string;
  kind: FormFieldKind;
}

const NUMBER_WORDS = new Map<string, number>([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
]);

const LABEL_STOPWORDS = new Set([
  "answer",
  "checked",
  "choice",
  "company",
  "option",
  "should",
  "that",
  "the",
  "this",
  "true",
  "use",
  "which",
  "with",
]);

export class CompletionEvidenceLedger {
  private readonly events = new Map<string, CompletionEvidence>();

  add(event: CompletionEvidence): boolean {
    const existing = this.events.get(event.logicalKey);
    if (existing && existing.observedAtTurn > event.observedAtTurn) {
      return false;
    }
    if (
      existing &&
      existing.observedAtTurn === event.observedAtTurn &&
      evidenceConfidenceRank(existing) > evidenceConfidenceRank(event)
    ) {
      return false;
    }
    if (
      existing &&
      existing.observedAtTurn === event.observedAtTurn &&
      JSON.stringify(existing) === JSON.stringify(event)
    ) {
      return false;
    }
    this.events.set(event.logicalKey, event);
    return true;
  }

  addMany(events: CompletionEvidence[]): number {
    let added = 0;
    for (const event of events) {
      if (this.add(event)) added++;
    }
    return added;
  }

  toArray(): CompletionEvidence[] {
    return [...this.events.values()].sort(
      (a, b) => a.observedAtTurn - b.observedAtTurn,
    );
  }

  clear(): void {
    this.events.clear();
  }
}

export function generateCompletionContract(params: {
  userRequest: string;
  snapshot: DomSnapshot | null | undefined;
  activeObjective?: string;
  successCriteria?: string;
}): GeneratedCompletionContract | null {
  const draftOnlyContract = generateDraftOnlyContract(params);
  if (draftOnlyContract) return draftOnlyContract;

  const snapshot = params.snapshot;
  if (!snapshot) return null;

  const quizContract = generateQuizSelectionContract(params, snapshot);
  if (quizContract) return quizContract;

  const formContract = generateFormFillContract(params, snapshot);
  if (formContract) return formContract;

  const navigationContract = generateNavigationContract(params, snapshot);
  if (navigationContract) return navigationContract;

  const readAnswerContract = generateReadAnswerContract(params, snapshot);
  if (readAnswerContract) return readAnswerContract;

  const workflowConfirmationContract = generateWorkflowConfirmationContract(
    params,
    snapshot,
  );
  if (workflowConfirmationContract) return workflowConfirmationContract;

  return null;
}

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

function generateDraftOnlyContract(
  params: {
    userRequest: string;
    snapshot: DomSnapshot | null | undefined;
    activeObjective?: string;
    successCriteria?: string;
  },
): GeneratedCompletionContract | null {
  const requestText = [
    extractCanonicalUserRequest(params.userRequest),
    params.activeObjective,
    params.successCriteria,
  ]
    .filter(Boolean)
    .join("\n");
  if (!isDraftOnlyCommunicationTask(requestText)) return null;

  return {
    contract: {
      kind: "draft_only",
      requiresUnsent: true,
    },
    confidence: "medium",
    source: "heuristic",
    repairable: true,
    notes: [],
  };
}

function generateQuizSelectionContract(
  params: {
    userRequest: string;
    snapshot: DomSnapshot | null | undefined;
    activeObjective?: string;
    successCriteria?: string;
  },
  snapshot: DomSnapshot,
): GeneratedCompletionContract | null {
  const choices = extractChoiceObservations(snapshot);
  if (choices.length < 2) return null;

  const canonicalUserRequest = extractCanonicalUserRequest(params.userRequest);
  const requestText = normalizeText(canonicalUserRequest);
  const combinedText = normalizeText(
    [params.userRequest, params.activeObjective, params.successCriteria]
      .filter(Boolean)
      .join("\n"),
  );
  if (!hasQuizSelectionIntent(combinedText)) return null;

  const visibleQuestionNumber = extractVisibleQuestionNumber(snapshot);
  const explicitUserQuestion = extractExplicitQuestionNumber(
    canonicalUserRequest,
  );
  const explicitPromptQuestion = extractExplicitQuestionNumber(
    params.userRequest,
  );
  const explicitObjectiveQuestion = extractExplicitQuestionNumber(
    params.activeObjective ?? "",
  );
  const deicticUserRequest =
    /\b(?:here|current|this|these|visible|on screen|what should i choose)\b/i.test(
      canonicalUserRequest,
    );
  const target: QuizTarget =
    explicitUserQuestion != null && !deicticUserRequest
      ? { kind: "question_number", questionNumber: explicitUserQuestion }
      : {
          kind: "current_visible_question",
          questionNumber: visibleQuestionNumber,
        };
  const notes: string[] = [];
  if (
    explicitObjectiveQuestion != null &&
    visibleQuestionNumber != null &&
    explicitObjectiveQuestion !== visibleQuestionNumber &&
    explicitUserQuestion == null
  ) {
    notes.push(
      `repaired stale planner target Question ${explicitObjectiveQuestion} to current visible Question ${visibleQuestionNumber}`,
    );
  } else if (
    explicitPromptQuestion != null &&
    visibleQuestionNumber != null &&
    explicitPromptQuestion !== visibleQuestionNumber &&
    explicitUserQuestion == null &&
    normalizeText(canonicalUserRequest) !== normalizeText(params.userRequest)
  ) {
    notes.push(
      `repaired stale orchestration target Question ${explicitPromptQuestion} to current visible Question ${visibleQuestionNumber}`,
    );
  }

  const requiresSubmit = /\b(?:check|submit|verify|mark|finish|grade)\b/i.test(
    requestText,
  );
  const requiresCorrectFeedback =
    requiresSubmit && /\b(?:correct|verify|check|grade)\b/i.test(requestText);
  const allRadio = choices.every((choice) => choice.kind === "radio");
  const selectionCardinality =
    inferSelectionCardinality(snapshot) ?? (allRadio ? 1 : undefined);

  return {
    contract: {
      kind: "quiz_selection",
      target,
      requiresSubmit,
      requiresCorrectFeedback,
      ...(selectionCardinality ? { selectionCardinality } : {}),
    },
    confidence: "high",
    source: "heuristic",
    repairable: true,
    notes,
  };
}

function generateFormFillContract(
  params: {
    userRequest: string;
    snapshot: DomSnapshot | null | undefined;
    activeObjective?: string;
    successCriteria?: string;
  },
  snapshot: DomSnapshot,
): GeneratedCompletionContract | null {
  const fields = extractFormFieldObservations(snapshot);
  if (fields.length === 0) return null;

  const expectedFields = inferExpectedFormFields(params.userRequest, fields);
  if (expectedFields.length === 0) return null;

  const requestText = normalizeText(
    [params.userRequest, params.activeObjective, params.successCriteria]
      .filter(Boolean)
      .join("\n"),
  );
  const requiresSubmit = /\b(?:log\s*in|sign\s*in|submit|send|save|create|register|apply|checkout|place\s+order|order|request|complete)\b/i.test(
    requestText,
  );

  return {
    contract: {
      kind: "form_fill",
      requiredFields: expectedFields,
      requiresSubmit,
      requiresConfirmation: requiresSubmit,
    },
    confidence: "medium",
    source: "heuristic",
    repairable: true,
    notes: [],
  };
}

function generateNavigationContract(
  params: {
    userRequest: string;
    snapshot: DomSnapshot | null | undefined;
    activeObjective?: string;
    successCriteria?: string;
  },
  _snapshot: DomSnapshot,
): GeneratedCompletionContract | null {
  const requestText = [
    extractCanonicalUserRequest(params.userRequest),
    params.activeObjective,
    params.successCriteria,
  ]
    .filter(Boolean)
    .join("\n");
  if (
    !/\b(?:go\s+to|open|navigate|visit|load|take\s+me\s+to|switch\s+to)\b/i.test(
      requestText,
    )
  ) {
    return null;
  }

  const target = extractNavigationTarget(requestText);
  if (!target) return null;

  return {
    contract: {
      kind: "navigation",
      targetUrl: target.href,
      targetHost: target.host,
    },
    confidence: "high",
    source: "heuristic",
    repairable: false,
    notes: [],
  };
}

function generateReadAnswerContract(
  params: {
    userRequest: string;
    snapshot: DomSnapshot | null | undefined;
    activeObjective?: string;
    successCriteria?: string;
  },
  _snapshot: DomSnapshot,
): GeneratedCompletionContract | null {
  const requestText = [
    extractCanonicalUserRequest(params.userRequest),
    params.activeObjective,
    params.successCriteria,
  ]
    .filter(Boolean)
    .join("\n");
  if (!hasPageReadAnswerIntent(requestText, _snapshot)) return null;
  const taskContract = buildTaskContract(requestText);
  const hasConcreteMultiReturn =
    (taskContract.multiReturnCount ?? 0) >= 2 &&
    taskContract.requiredEntities.length >= (taskContract.multiReturnCount ?? 0);
  const expectedAnswerLabel = getGroundedLabelValueQuestionLabel(
    requestText,
    _snapshot,
  );

  return {
    contract: {
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
      ...(hasConcreteMultiReturn ? { taskContract } : {}),
      ...(expectedAnswerLabel ? { expectedAnswerLabel } : {}),
    },
    confidence: "medium",
    source: hasConcreteMultiReturn ? "task_contract" : "heuristic",
    repairable: true,
    notes: hasConcreteMultiReturn
      ? [
          `multi-return coverage requires ${taskContract.multiReturnCount} returned entities`,
        ]
      : [],
  };
}

function generateWorkflowConfirmationContract(
  params: {
    userRequest: string;
    snapshot: DomSnapshot | null | undefined;
    activeObjective?: string;
    successCriteria?: string;
  },
  _snapshot: DomSnapshot,
): GeneratedCompletionContract | null {
  const requestText = [
    extractCanonicalUserRequest(params.userRequest),
    params.activeObjective,
    params.successCriteria,
  ]
    .filter(Boolean)
    .join("\n");
  const action = inferWorkflowConfirmationAction(requestText);
  if (!action) return null;
  if (isBrowserManagementWorkflowRequest(requestText)) return null;
  if (action === "dismiss" && isDismissalPartOfLargerTask(requestText)) {
    return null;
  }
  const targetLabel = inferWorkflowConfirmationTargetLabel(
    requestText,
    action,
  );

  return {
    contract: {
      kind: "workflow_confirmation",
      action,
      ...(targetLabel ? { targetLabel } : {}),
    },
    confidence: "medium",
    source: "heuristic",
    repairable: true,
    notes: [],
  };
}

export function deriveCompletionEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  if (/^Error:/i.test(params.result)) {
    return [];
  }

  const evidence: CompletionEvidence[] = [];
  const checked = params.args.checked;
  const id = Number(params.args.id);
  if (
    (params.toolName === "type_text" || params.toolName === "select_option") &&
    Number.isFinite(id)
  ) {
    const value =
      params.toolName === "type_text"
        ? params.args.text
        : params.args.value;
    if (typeof value === "string") {
      const field =
        findFormFieldObservationByElementId(params.preActionSnapshot, id) ??
        findFormFieldObservationByElementId(params.currentSnapshot, id);
      if (field) {
        evidence.push(
          fieldValueEvidence({
            ...field,
            value,
            confidence: "high",
            observedAtTurn: params.turn,
          }),
        );
      }
    }
  }

  if (
    params.toolName === "set_checkbox" &&
    typeof checked === "boolean" &&
    Number.isFinite(id)
  ) {
    const sourceSnapshot = params.currentSnapshot ?? params.preActionSnapshot;
    const choice =
      findChoiceObservationByElementId(sourceSnapshot, id) ??
      findChoiceObservationByElementId(params.preActionSnapshot, id);
    if (choice) {
      evidence.push(
        selectedStateEvidence({
          ...choice,
          checked,
          confidence: "high",
          observedAtTurn: params.turn,
        }),
      );
    }

    const field =
      findFormFieldObservationByElementId(params.preActionSnapshot, id) ??
      findFormFieldObservationByElementId(params.currentSnapshot, id);
    if (field) {
      evidence.push(
        fieldValueEvidence({
          ...field,
          value: String(checked),
          confidence: "high",
          observedAtTurn: params.turn,
        }),
      );
    }
  }

  evidence.push(...extractModalDismissalEvidenceFromToolOutcome(params));
  evidence.push(...extractTargetDisappearanceEvidenceFromToolOutcome(params));
  evidence.push(...extractDraftSubmissionEvidenceFromToolOutcome(params));
  evidence.push(...extractStatusChangeEvidenceFromToolOutcome(params));
  evidence.push(...extractControlLabelChangeEvidenceFromToolOutcome(params));
  evidence.push(...extractControlStateChangeEvidenceFromToolOutcome(params));
  evidence.push(...extractDirtyIndicatorClearedEvidenceFromToolOutcome(params));
  evidence.push(...extractReadAnswerEvidenceFromToolOutcome(params));

  return evidence;
}

export function deriveCompletionEvidenceFromSnapshot(
  snapshot: DomSnapshot | null | undefined,
  turn: number,
): CompletionEvidence[] {
  if (!snapshot) return [];
  const selectedEvidence = extractChoiceObservations(snapshot).map((choice) =>
    selectedStateEvidence({
      ...choice,
      confidence: "medium",
      observedAtTurn: turn,
    }),
  );
  const fieldEvidence = extractFormFieldObservations(snapshot).map((field) =>
    fieldValueEvidence({
      ...field,
      confidence: "medium",
      observedAtTurn: turn,
    }),
  );
  const draftEvidence = extractDraftEvidence(snapshot, turn);
  const feedbackEvidence = extractFeedbackEvidence(snapshot, turn);
  const validationEvidence = extractValidationErrorEvidence(snapshot, turn);
  const confirmationEvidence = extractFormConfirmationEvidence(snapshot, turn);
  const workflowConfirmationEvidence = extractWorkflowConfirmationEvidence(
    snapshot,
    turn,
  );
  const navigationEvidence = extractNavigationEvidence(snapshot, turn);
  return [
    ...selectedEvidence,
    ...fieldEvidence,
    ...draftEvidence,
    ...feedbackEvidence,
    ...validationEvidence,
    ...confirmationEvidence,
    ...workflowConfirmationEvidence,
    ...navigationEvidence,
  ];
}

export function evaluateCompletionContract(params: {
  contract: CompletionContract | null | undefined;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  candidateSource: CompletionCandidateSource;
  summary?: string;
}): CompletionEvaluation {
  if (!params.contract) {
    return {
      status: "inconclusive",
      reason: "No deterministic completion contract was generated.",
      evidence: params.evidence,
    };
  }
  if (params.contract.kind === "quiz_selection") {
    return evaluateQuizSelection({
      contract: params.contract,
      evidence: params.evidence,
      snapshot: params.snapshot,
      candidateSource: params.candidateSource,
      summary: params.summary,
    });
  }
  if (params.contract.kind === "form_fill") {
    return evaluateFormFill({
      contract: params.contract,
      evidence: params.evidence,
      snapshot: params.snapshot,
      summary: params.summary,
    });
  }
  if (params.contract.kind === "draft_only") {
    return evaluateDraftOnly({
      contract: params.contract,
      evidence: params.evidence,
      snapshot: params.snapshot,
      summary: params.summary,
    });
  }
  if (params.contract.kind === "navigation") {
    return evaluateNavigation({
      contract: params.contract,
      evidence: params.evidence,
    });
  }
  if (params.contract.kind === "read_answer") {
    return evaluateReadAnswer({
      contract: params.contract,
      evidence: params.evidence,
      snapshot: params.snapshot,
      summary: params.summary,
    });
  }
  if (params.contract.kind === "workflow_confirmation") {
    return evaluateWorkflowConfirmation({
      contract: params.contract,
      evidence: params.evidence,
      candidateSource: params.candidateSource,
      summary: params.summary,
    });
  }
  return {
    status: "inconclusive",
    reason: "No deterministic evaluator is available for this contract.",
    contract: params.contract,
    evidence: params.evidence,
  };
}

export function buildCompletionRecoveryHint(
  evaluation: CompletionEvaluation,
): string | null {
  if (evaluation.status === "accepted") {
    if (evaluation.contract.kind === "quiz_selection") {
      return (
        "Completion evidence indicates the requested quiz selections are already applied. " +
        'Call done({"summary":"..."}) now with the selected option names instead of exploring further.'
      );
    }
    if (evaluation.contract.kind === "form_fill") {
      return (
        "Completion evidence indicates the requested form fields are already filled. " +
        'Call done({"summary":"..."}) now with the completed field names instead of exploring further.'
      );
    }
    if (evaluation.contract.kind === "draft_only") {
      return (
        "Completion evidence indicates the requested draft remains unsent in the editor. " +
        'Call done({"summary":"..."}) now and state that the draft is unsent.'
      );
    }
    if (evaluation.contract.kind === "navigation") {
      return (
        "Completion evidence indicates the requested page is already open. " +
        'Call done({"summary":"..."}) now with the current page URL instead of navigating again.'
      );
    }
    if (evaluation.contract.kind === "read_answer") {
      return (
        "Completion evidence indicates the page has been grounded for the requested answer. " +
        'Call done({"summary":"..."}) now with the answer from the page evidence.'
      );
    }
    if (evaluation.contract.kind === "workflow_confirmation") {
      return (
        "Completion evidence indicates the requested action is already confirmed. " +
        'Call done({"summary":"..."}) now with the visible confirmation instead of repeating the action.'
      );
    }
  }
  if (evaluation.status === "needs_verification") {
    return evaluation.hint;
  }
  return null;
}

export function buildCompletionEnvelope(params: {
  source: CompletionCandidateSource;
  contractKind: string;
  decisionReason: string;
  evidence: CompletionEvidence[];
  turn: number;
  summary: string;
}): CompletionEnvelope {
  const evidenceKeys = [
    ...new Set(params.evidence.map((event) => event.logicalKey)),
  ].sort();
  const latestEvidenceTurn = params.evidence.reduce(
    (latest, event) => Math.max(latest, event.observedAtTurn),
    params.turn,
  );
  const evidenceMaterial = params.evidence
    .map(
      (event) =>
        `${event.logicalKey}@${event.observedAtTurn}:${event.confidence}`,
    )
    .sort()
    .join("|");
  const evidenceEpoch = `turn:${latestEvidenceTurn}:evidence:${hashStableString(
    evidenceMaterial || "none",
  )}`;
  const resultId = `completion:${hashStableString(
    [
      params.source,
      params.contractKind,
      params.decisionReason,
      evidenceEpoch,
      params.summary,
    ].join("\n"),
  )}`;
  return {
    status: "completed",
    resultId,
    source: params.source,
    contractKind: params.contractKind,
    decisionReason: params.decisionReason,
    evidenceKeys,
    evidenceEpoch,
  };
}

export function buildTrustedCompletionCandidate(params: {
  workflow: string;
  summary: string;
  reason: string;
  turn: number;
  contractKind?: string;
  evidenceText?: string;
  recordId?: string;
  targetText?: string;
  url?: string;
}): TrustedCompletionCandidate {
  const workflowKey = compactKey(params.workflow) || "workflow";
  const recordKey =
    (params.recordId ? compactKey(params.recordId) : null) ||
    compactKey(params.summary) ||
    "completed";
  return {
    contractKind: params.contractKind ?? "workflow_confirmation",
    decisionReason: params.reason,
    evidence: [
      {
        type: "confirmation_state",
        confidence: "high",
        logicalKey: `trusted:${workflowKey}:confirmation:${recordKey}`,
        observedAtTurn: params.turn,
        detail: {
          source: "trusted_workflow",
          text: (params.evidenceText ?? params.summary).slice(0, 1000),
          ...(params.recordId ? { recordId: params.recordId } : {}),
          ...(params.targetText ? { targetText: params.targetText } : {}),
          ...(params.url ? { url: params.url } : {}),
        },
      },
    ],
  };
}

export function buildTrustedReadAnswerCompletionCandidate(params: {
  workflow: string;
  answer: string;
  source: "knowledge_base_search" | "page_read";
  turn: number;
  question?: string;
  evidenceText?: string;
  url?: string;
}): TrustedCompletionCandidate {
  const workflowKey = compactKey(params.workflow) || "read-answer";
  const questionKey = params.question ? compactKey(params.question) : "";
  const answerKey = compactKey(params.answer) || hashStableString(params.answer);
  const logicalKey = questionKey
    ? `trusted:${workflowKey}:answer:${questionKey}:${answerKey}`
    : `trusted:${workflowKey}:answer:${answerKey}`;
  return {
    contractKind: "read_answer",
    decisionReason:
      params.source === "knowledge_base_search"
        ? "Trusted knowledge answer extraction produced an answer from grounded knowledge base search evidence."
        : "Trusted knowledge answer extraction produced an answer from grounded page-read evidence.",
    evidence: [
      {
        type: "answer_state",
        confidence: "high",
        logicalKey,
        observedAtTurn: params.turn,
        detail: {
          answer: params.answer.slice(0, 1000),
          ...(params.question ? { question: params.question.slice(0, 1000) } : {}),
          source: params.source,
          evidenceText: (params.evidenceText ?? params.answer).slice(0, 1000),
          ...(params.url ? { url: params.url } : {}),
        },
      },
    ],
  };
}

function evaluateQuizSelection(params: {
  contract: QuizSelectionContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  candidateSource: CompletionCandidateSource;
  summary?: string;
}): CompletionEvaluation {
  const contract = params.contract;
  const visibleQuestionNumber = extractVisibleQuestionNumber(params.snapshot);
  if (
    contract.target.kind === "question_number" &&
    visibleQuestionNumber != null &&
    contract.target.questionNumber !== visibleQuestionNumber
  ) {
    return {
      status: "rejected",
      reason: `The visible page is Question ${visibleQuestionNumber}, but the completion target is Question ${contract.target.questionNumber}.`,
      contract,
      evidence: params.evidence,
    };
  }

  const selectedStateEvidence = params.evidence.filter(
    (event): event is Extract<CompletionEvidence, { type: "selected_state" }> =>
      event.type === "selected_state" &&
      matchesQuizTarget(event, contract, visibleQuestionNumber),
  );
  const selected = selectedStateEvidence.filter((event) => event.detail.checked);
  const negativeEvidence = params.evidence.find(
    (event): event is Extract<
      CompletionEvidence,
      { type: "validation_error" }
    > =>
      event.type === "validation_error" &&
      event.logicalKey.startsWith("quiz:"),
  );
  if (negativeEvidence) {
    return {
      status: "rejected",
      reason: `Negative page evidence contradicts completion: ${negativeEvidence.detail.text}`,
      contract,
      evidence: params.evidence,
    };
  }

  if (selected.length === 0) {
    return {
      status: "rejected",
      reason: "No selected quiz option evidence is active for the current target.",
      contract,
      evidence: params.evidence,
    };
  }

  const cardinality = contract.selectionCardinality;
  if (typeof cardinality === "number" && selected.length !== cardinality) {
    return {
      status: "rejected",
      reason: `Expected ${cardinality} selected option${cardinality === 1 ? "" : "s"}, but found ${selected.length}.`,
      contract,
      evidence: params.evidence,
    };
  }
  if (cardinality === "one_or_more" && selected.length < 1) {
    return {
      status: "rejected",
      reason: "Expected at least one selected option.",
      contract,
      evidence: params.evidence,
    };
  }

  if (
    contract.expectedSelections &&
    !expectedSelectionsMatch(contract.expectedSelections, selected)
  ) {
    return {
      status: "rejected",
      reason: "Selected options do not match the expected completion selections.",
      contract,
      evidence: params.evidence,
    };
  }

  if (
    params.candidateSource === "model_done" &&
    params.summary &&
    !selectedLabelsCoveredBySummary(selected, params.summary)
  ) {
    return {
      status: "inconclusive",
      reason:
        "Selected options are visible, but the done summary does not name them clearly enough for deterministic acceptance.",
      contract,
      evidence: params.evidence,
    };
  }

  const correctFeedback = params.evidence.find(
    (event): event is Extract<CompletionEvidence, { type: "correct_feedback" }> =>
      event.type === "correct_feedback" &&
      matchesFeedbackTarget(event, contract, visibleQuestionNumber),
  );
  if (contract.requiresCorrectFeedback && !correctFeedback) {
    return {
      status: "needs_verification",
      reason: "Selected options are applied, but correct-answer feedback is missing.",
      hint:
        "The selected quiz options appear applied, but this request requires checking the answer. Click the visible Check answer or Submit control, then call done after correct feedback appears.",
      contract,
      evidence: params.evidence,
    };
  }
  if (contract.requiresSubmit && !correctFeedback) {
    return {
      status: "needs_verification",
      reason: "Selected options are applied, but submit/check evidence is missing.",
      hint:
        "The selected quiz options appear applied. Verify them with the page's Check answer or Submit control before calling done.",
      contract,
      evidence: params.evidence,
    };
  }

  return {
    status: "accepted",
    reason:
      contract.requiresSubmit || contract.requiresCorrectFeedback
        ? "Quiz selection and required verification evidence are satisfied."
        : "Quiz select-only contract is satisfied by active selected-state evidence.",
    contract,
    evidence: selected,
  };
}

function evaluateFormFill(params: {
  contract: FormFillContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): CompletionEvaluation {
  const contract = params.contract;
  const validationError = params.evidence.find(
    (event): event is Extract<
      CompletionEvidence,
      { type: "validation_error" }
    > =>
      event.type === "validation_error" &&
      event.logicalKey.startsWith("form:"),
  );

  const autocompleteRejection = getAutocompleteSuggestionDoneRejection({
    snapshot: params.snapshot,
    originalQuery: contract.requiredFields
      .map((field) => `"${field.value}"`)
      .join(" "),
    summary: params.summary,
  });
  const autocompleteMatchesRequiredField =
    autocompleteRejection &&
    contract.requiredFields.some((field) =>
      formValueMatches(autocompleteRejection.value, field.value),
    );
  if (autocompleteRejection && autocompleteMatchesRequiredField) {
    const autocompleteEvidence = formAutocompletePendingEvidence({
      rejection: autocompleteRejection,
      observedAtTurn: latestObservedTurn(params.evidence),
    });
    return {
      status: "rejected",
      reason: `Form-fill contract is not satisfied: ${autocompleteRejection.reason}`,
      contract,
      evidence: [...params.evidence, autocompleteEvidence],
    };
  }

  if (validationError) {
    return {
      status: "rejected",
      reason: `Visible form validation contradicts completion: ${validationError.detail.text}`,
      contract,
      evidence: params.evidence,
    };
  }

  const fieldEvidence = params.evidence.filter(
    (event): event is Extract<CompletionEvidence, { type: "field_value" }> =>
      event.type === "field_value",
  );
  const acceptedEvidence: Array<
    Extract<CompletionEvidence, { type: "field_value" }>
  > = [];
  const missing: string[] = [];
  const mismatched: string[] = [];

  for (const expected of contract.requiredFields) {
    const candidates = fieldEvidence.filter((event) =>
      matchesExpectedField(event, expected),
    );
    const matching = candidates
      .filter((event) => formValueMatches(event.detail.value, expected.value))
      .sort(compareEvidenceRecency);

    if (matching.length > 0) {
      acceptedEvidence.push(matching[0]);
      continue;
    }

    if (candidates.length > 0) {
      const latest = [...candidates].sort(compareEvidenceRecency)[0];
      mismatched.push(
        `${expected.label}: expected "${expected.value}", observed "${latest.detail.value}"`,
      );
    } else {
      missing.push(expected.label);
    }
  }

  if (missing.length > 0 || mismatched.length > 0) {
    const parts = [
      missing.length ? `missing field evidence for ${missing.join(", ")}` : "",
      mismatched.length ? `mismatched values: ${mismatched.join("; ")}` : "",
    ].filter(Boolean);
    return {
      status: "rejected",
      reason: `Form-fill contract is not satisfied: ${parts.join("; ")}.`,
      contract,
      evidence: params.evidence,
    };
  }

  const confirmation = params.evidence.find(
    (event): event is Extract<
      CompletionEvidence,
      { type: "confirmation_state" }
    > =>
      event.type === "confirmation_state" &&
      event.logicalKey.startsWith("form:"),
  );
  if (contract.requiresConfirmation && !confirmation) {
    return {
      status: "needs_verification",
      reason:
        "Requested form fields are filled, but submit/confirmation evidence is missing.",
      hint:
        "The requested form fields appear filled. Submit or verify the form, then call done after the page shows confirmation.",
      contract,
      evidence: acceptedEvidence,
    };
  }

  return {
    status: "accepted",
    reason: contract.requiresConfirmation
      ? "Form-fill contract and confirmation evidence are satisfied."
      : "Form-fill contract is satisfied by active field-value evidence.",
    contract,
    evidence: confirmation
      ? [...acceptedEvidence, confirmation]
      : acceptedEvidence,
  };
}

function evaluateDraftOnly(params: {
  contract: DraftOnlyContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): CompletionEvaluation {
  const contract = params.contract;
  const snapshotText = [
    params.snapshot?.title,
    params.snapshot?.url,
    params.snapshot?.visibleContent,
    params.snapshot?.pageContent,
  ]
    .filter(Boolean)
    .join("\n");
  const summary = params.summary ?? "";

  if (hasStrongCommunicationSentEvidence(snapshotText)) {
    return {
      status: "rejected",
      reason:
        "Visible page state indicates the communication was sent, but the task required an unsent draft.",
      contract,
      evidence: params.evidence,
    };
  }
  if (
    hasStrongCommunicationSentEvidence(summary) &&
    !hasDraftPreservedEvidence(summary)
  ) {
    return {
      status: "rejected",
      reason:
        "Completion summary says the communication was sent, but the task required an unsent draft.",
      contract,
      evidence: params.evidence,
    };
  }

  const drafts = params.evidence
    .filter(
      (event): event is Extract<CompletionEvidence, { type: "draft_state" }> =>
        event.type === "draft_state",
    )
    .sort(compareEvidenceRecency);
  const activeDraft = drafts.find(
    (event) => !event.detail.submitted && cleanLabel(event.detail.text),
  );
  if (!activeDraft) {
    return {
      status: "rejected",
      reason: "No active unsent draft evidence is visible.",
      contract,
      evidence: params.evidence,
    };
  }

  return {
    status: "accepted",
    reason: "Draft-only contract is satisfied by visible unsent draft evidence.",
    contract,
    evidence: [activeDraft],
  };
}

function evaluateNavigation(params: {
  contract: NavigationContract;
  evidence: CompletionEvidence[];
}): CompletionEvaluation {
  const contract = params.contract;
  const navigationEvidence = params.evidence
    .filter(
      (event): event is Extract<
        CompletionEvidence,
        { type: "navigation_state" }
      > => event.type === "navigation_state",
    )
    .sort(compareEvidenceRecency);
  const current = navigationEvidence[0];
  if (!current) {
    return {
      status: "rejected",
      reason: "No navigation evidence is active for the requested page.",
      contract,
      evidence: params.evidence,
    };
  }

  const currentTarget = parseNavigationTarget(current.detail.url);
  if (!currentTarget) {
    return {
      status: "rejected",
      reason: `Current URL is not a verifiable web URL: ${current.detail.url}`,
      contract,
      evidence: params.evidence,
    };
  }

  if (!navigationTargetMatches(currentTarget, contract)) {
    return {
      status: "rejected",
      reason: `Current URL ${current.detail.url} does not match requested host ${contract.targetHost}.`,
      contract,
      evidence: params.evidence,
    };
  }

  return {
    status: "accepted",
    reason: "Navigation contract is satisfied by current URL evidence.",
    contract,
    evidence: [current],
  };
}

function evaluateReadAnswer(params: {
  contract: ReadAnswerContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): CompletionEvaluation {
  const contract = params.contract;
  if (params.summary && contract.taskContract?.multiReturnCount) {
    const coverage = assessTaskContractCoverage({
      contract: contract.taskContract,
      text: params.summary,
    });
    if (coverage.missingMultiReturnCoverage) {
      return {
        status: "rejected",
        reason:
          `Read-answer summary is missing required multi-return coverage. ` +
          `Missing: ${coverage.missingEntities.join(", ") || "additional requested result"}.`,
        contract,
        evidence: params.evidence,
      };
    }
  }
  const pageEvidence = params.evidence
    .filter(
      (event): event is Extract<CompletionEvidence, { type: "answer_state" }> =>
        event.type === "answer_state" && event.detail.source === "page_read",
    )
    .sort(compareEvidenceRecency);
  const groundedEvidence = pageEvidence.find((event) =>
    hasSubstantiveReadAnswerEvidence(event.detail.evidenceText),
  );

  const snapshotEvidence =
    params.snapshot && hasSubstantiveReadAnswerEvidence(snapshotPageText(params.snapshot))
      ? readAnswerSnapshotEvidence({
          snapshot: params.snapshot,
          observedAtTurn: latestObservedTurn(params.evidence),
        })
      : null;

  const sourceEvidence = groundedEvidence ?? snapshotEvidence;
  if (!sourceEvidence) {
    return {
      status: "needs_verification",
      reason:
        "Requested page-answer task has no grounded page-read evidence yet.",
      hint:
        "Call read_page first to verify the current page content, then call done with the answer from that evidence.",
      contract,
      evidence: params.evidence,
    };
  }

  if (
    params.summary &&
    !readAnswerSummaryGroundedInEvidence(
      params.summary,
      sourceEvidence,
      contract.expectedAnswerLabel,
    )
  ) {
    return {
      status: "inconclusive",
      reason:
        "Page-read evidence exists, but the done summary is not grounded strongly enough for deterministic read-answer acceptance.",
      contract,
      evidence: [sourceEvidence],
    };
  }

  return {
    status: "accepted",
    reason: "Read-answer contract is satisfied by grounded page evidence.",
    contract,
    evidence: [sourceEvidence],
  };
}

function evaluateWorkflowConfirmation(params: {
  contract: WorkflowConfirmationContract;
  evidence: CompletionEvidence[];
  candidateSource: CompletionCandidateSource;
  summary?: string;
}): CompletionEvaluation {
  const contract = params.contract;
  const confirmations = params.evidence
    .filter(
      (event): event is Extract<
        CompletionEvidence,
        { type: "confirmation_state" }
      > =>
        event.type === "confirmation_state" &&
        event.logicalKey.startsWith("workflow:confirmation:") &&
        event.detail.action === contract.action,
    )
    .sort(compareEvidenceRecency);
  const targetMatchedConfirmations = confirmations.filter((event) =>
    workflowConfirmationMatchesTarget(event, contract.targetLabel),
  );
  if (confirmations.length > 0 && targetMatchedConfirmations.length === 0) {
    return {
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
      contract,
      evidence: confirmations,
    };
  }
  const confirmation = targetMatchedConfirmations[0];
  if (!confirmation) {
    return {
      status: "needs_verification",
      reason:
        "Requested action has no matching visible confirmation evidence yet.",
      hint:
        "Verify the page shows the action result, such as a success or confirmation message, before calling done.",
      contract,
      evidence: params.evidence,
    };
  }

  if (
    params.candidateSource === "model_done" &&
    params.summary &&
    !summaryConfirmsWorkflowAction(params.summary, contract.action)
  ) {
    return {
      status: "inconclusive",
      reason:
        "Workflow confirmation evidence is visible, but the done summary does not state the confirmed action clearly enough for deterministic acceptance.",
      contract,
      evidence: [confirmation],
    };
  }

  return {
    status: "accepted",
    reason: `Workflow confirmation contract is satisfied by matching ${contract.action} confirmation evidence.`,
    contract,
    evidence: [confirmation],
  };
}

function fieldValueEvidence(params: FormFieldObservation & {
  confidence: CompletionConfidence;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "field_value" }> {
  const key =
    compactKey(params.stableKey) ||
    compactKey(params.label) ||
    `tag-${params.elementId}`;
  return {
    type: "field_value",
    confidence: params.confidence,
    logicalKey: `form:field:${key}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      elementId: params.elementId,
      stableKey: params.stableKey,
      label: params.label,
      value: params.value,
    },
  };
}

function formAutocompletePendingEvidence(params: {
  rejection: AutocompleteSuggestionDoneRejection;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "validation_error" }> {
  const valueKey = compactKey(params.rejection.value) || "value";
  return {
    type: "validation_error",
    confidence: "high",
    logicalKey: `form:autocomplete_pending:${valueKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      text: params.rejection.reason,
      value: params.rejection.value,
      inputElementId: params.rejection.inputTag,
      suggestionElementId: params.rejection.suggestionTag,
    },
  };
}

function draftStateEvidence(params: FormFieldObservation & {
  confidence: CompletionConfidence;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "draft_state" }> {
  const target = params.label || params.stableKey || `tag-${params.elementId}`;
  const targetKey = compactKey(target) || `tag-${params.elementId}`;
  const identityKey =
    compactKey(params.stableKey) || compactKey(params.label) || targetKey;
  return {
    type: "draft_state",
    confidence: params.confidence,
    logicalKey: `draft:${targetKey}:${identityKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      target,
      text: params.value,
      submitted: false,
    },
  };
}

function navigationStateEvidence(
  snapshot: DomSnapshot,
  turn: number,
): Extract<CompletionEvidence, { type: "navigation_state" }>[] {
  if (!snapshot.url) return [];
  const parsed = parseNavigationTarget(snapshot.url);
  if (!parsed) return [];
  return [
    {
      type: "navigation_state",
      confidence: "medium",
      logicalKey: `navigation:page:${compactKey(parsed.host)}`,
      observedAtTurn: turn,
      detail: {
        url: snapshot.url,
        ...(snapshot.title ? { title: snapshot.title } : {}),
      },
    },
  ];
}

function readAnswerSnapshotEvidence(params: {
  snapshot: DomSnapshot;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }> {
  const evidenceText = snapshotPageText(params.snapshot);
  const pageKey =
    compactKey(params.snapshot.url) ||
    compactKey(params.snapshot.title ?? "") ||
    "current-page";
  return {
    type: "answer_state",
    confidence: "medium",
    logicalKey: `read_answer:page:${pageKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      answer: evidenceText.slice(0, 1000),
      source: "page_read",
      evidenceText: evidenceText.slice(0, 4000),
      ...(params.snapshot.url ? { url: params.snapshot.url } : {}),
    },
  };
}

function readAnswerToolEvidence(params: {
  result: string;
  snapshot?: DomSnapshot | null;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }>[] {
  const evidenceText = cleanReadAnswerEvidenceText(params.result);
  if (!hasSubstantiveReadAnswerEvidence(evidenceText)) return [];

  const pageKey =
    compactKey(params.snapshot?.url ?? "") ||
    compactKey(params.snapshot?.title ?? "") ||
    hashStableString(evidenceText.slice(0, 500));
  return [
    {
      type: "answer_state",
      confidence: "high",
      logicalKey: `read_answer:page:${pageKey}`,
      observedAtTurn: params.observedAtTurn,
      detail: {
        answer: evidenceText.slice(0, 1000),
        source: "page_read",
        evidenceText: evidenceText.slice(0, 4000),
        ...(params.snapshot?.url ? { url: params.snapshot.url } : {}),
      },
    },
  ];
}

function selectedStateEvidence(params: ChoiceObservation & {
  confidence: CompletionConfidence;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "selected_state" }> {
  const labelKey = compactKey(params.label);
  const questionKey =
    params.questionNumber == null ? "current" : String(params.questionNumber);
  return {
    type: "selected_state",
    confidence: params.confidence,
    logicalKey: `quiz:q${questionKey}:option:${labelKey || params.stableKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      elementId: params.elementId,
      stableKey: params.stableKey,
      label: params.label,
      checked: params.checked,
      ...(params.questionNumber != null
        ? { questionNumber: params.questionNumber }
        : {}),
    },
  };
}

function extractChoiceObservations(snapshot: DomSnapshot): ChoiceObservation[] {
  const questionNumber = extractVisibleQuestionNumber(snapshot);
  const labelByControl = new Map<string, string>();
  for (const element of snapshot.elements) {
    const control = element.attributes.control;
    if (!control) continue;
    const text = cleanLabel(element.text || element.attributes.label || "");
    if (!text) continue;
    const existing = labelByControl.get(control);
    if (!existing || text.length > existing.length) {
      labelByControl.set(control, text);
    }
  }

  const choices = new Map<string, ChoiceObservation>();
  for (const element of snapshot.elements) {
    const kind = getChoiceKind(element);
    if (!kind || element.isDisabled) continue;

    const stableKey = choiceStableKey(element);
    const associated = element.attributes.control
      ? labelByControl.get(element.attributes.control)
      : undefined;
    const label = bestChoiceLabel(element, associated);
    if (!label || label.length < 3) continue;
    if (/^mark lecture\b/i.test(label)) continue;

    const checked = readChecked(element);
    if (checked == null) continue;
    const observation: ChoiceObservation = {
      elementId: element.tag,
      stableKey,
      label,
      checked,
      kind,
      ...(questionNumber != null ? { questionNumber } : {}),
    };
    const existing = choices.get(stableKey);
    if (!existing || observation.label.length > existing.label.length) {
      choices.set(stableKey, observation);
    }
  }
  return [...choices.values()];
}

function findChoiceObservationByElementId(
  snapshot: DomSnapshot | null | undefined,
  id: number,
): ChoiceObservation | null {
  if (!snapshot) return null;
  const direct = snapshot.elements.find((element) => element.tag === id);
  if (!direct) return null;
  const directStableKey = choiceStableKey(direct);
  return (
    extractChoiceObservations(snapshot).find(
      (choice) =>
        choice.elementId === id || choice.stableKey === directStableKey,
    ) ?? null
  );
}

function extractFormFieldObservations(
  snapshot: DomSnapshot,
): FormFieldObservation[] {
  const labelByControl = new Map<string, string>();
  for (const element of snapshot.elements) {
    const control = element.attributes.control;
    if (!control) continue;
    const text = cleanLabel(element.text || element.attributes.label || "");
    if (!text) continue;
    const existing = labelByControl.get(control);
    if (!existing || text.length > existing.length) {
      labelByControl.set(control, text);
    }
  }

  const fields = new Map<string, FormFieldObservation>();
  for (const element of snapshot.elements) {
    const kind = getFormFieldKind(element);
    if (!kind || element.isDisabled) continue;

    const stableKey = formFieldStableKey(element);
    const associated = element.attributes.control
      ? labelByControl.get(element.attributes.control)
      : undefined;
    const label = bestFormFieldLabel(element, associated);
    if (!label || label.length < 2) continue;

    const value = readFormFieldValue(element, kind);
    const observation: FormFieldObservation = {
      elementId: element.tag,
      stableKey,
      label,
      value,
      kind,
    };
    const existing = fields.get(stableKey);
    if (!existing || observation.label.length > existing.label.length) {
      fields.set(stableKey, observation);
    }
  }
  return [...fields.values()];
}

function extractDraftEvidence(
  snapshot: DomSnapshot,
  turn: number,
): CompletionEvidence[] {
  return extractFormFieldObservations(snapshot)
    .filter(isLikelyDraftEditorField)
    .filter((field) => cleanLabel(field.value).length > 0)
    .map((field) =>
      draftStateEvidence({
        ...field,
        confidence: "medium",
        observedAtTurn: turn,
      }),
    );
}

function isLikelyDraftEditorField(field: FormFieldObservation): boolean {
  if (field.kind !== "text") return false;
  const labelText = normalizeText([field.label, field.stableKey].join(" "));
  return /\b(?:reply|response|message|comment|body|compose|draft|editor|post)\b/i.test(
    labelText,
  );
}

function findFormFieldObservationByElementId(
  snapshot: DomSnapshot | null | undefined,
  id: number,
): FormFieldObservation | null {
  if (!snapshot) return null;
  const direct = snapshot.elements.find((element) => element.tag === id);
  if (!direct) return null;
  const directStableKey = formFieldStableKey(direct);
  return (
    extractFormFieldObservations(snapshot).find(
      (field) =>
        field.elementId === id || field.stableKey === directStableKey,
    ) ?? null
  );
}

function getFormFieldKind(element: TaggedElement): FormFieldKind | null {
  const tagName = normalizeText(element.tagName);
  const role = normalizeText(element.role);
  const type = normalizeText(element.attributes.type || "");

  if (type === "checkbox" || role === "checkbox" || role === "switch") {
    return "checkbox";
  }
  if (type === "radio" || role === "radio") return "radio";
  if (tagName === "select" || role === "combobox" || role === "listbox") {
    return "select";
  }
  if (
    tagName === "textarea" ||
    role === "textbox" ||
    role === "searchbox"
  ) {
    return "text";
  }
  if (tagName !== "input") return null;
  if (
    [
      "button",
      "file",
      "hidden",
      "image",
      "reset",
      "submit",
    ].includes(type)
  ) {
    return null;
  }
  return "text";
}

function formFieldStableKey(element: TaggedElement): string {
  return (
    element.attributes.control ||
    element.attributes.id ||
    element.attributes.name ||
    element.attributes["aria-label"] ||
    element.attributes.label ||
    `tag:${element.tag}`
  );
}

function readFormFieldValue(
  element: TaggedElement,
  kind: FormFieldKind,
): string {
  if (kind === "checkbox" || kind === "radio") {
    const checked = readChecked(element);
    return checked == null ? "false" : String(checked);
  }
  if (kind === "select") {
    return cleanLabel(
      element.attributes.selected ||
        element.attributes.value ||
        element.text ||
        "",
    );
  }

  const placeholder = cleanLabel(element.attributes.placeholder || "");
  const visibleText = cleanLabel(element.text || "");
  const textValue =
    visibleText && visibleText !== placeholder ? visibleText : "";
  return cleanLabel(element.attributes.value || textValue);
}

function bestFormFieldLabel(
  element: TaggedElement,
  associated?: string,
): string {
  const candidates = [
    associated,
    element.attributes.label,
    element.attributes["aria-label"],
    element.attributes.placeholder,
    element.attributes.name,
    element.attributes.id,
    element.text,
  ];
  return candidates
    .map((value) => cleanLabel(value ?? ""))
    .find(Boolean) ?? "";
}

function inferExpectedFormFields(
  userRequest: string,
  fields: FormFieldObservation[],
): FormFillFieldExpectation[] {
  const expectedFields: FormFillFieldExpectation[] = [];
  for (const field of fields) {
    const value = inferExpectedFieldValue(userRequest, field, fields);
    if (value == null) continue;
    expectedFields.push({
      label: field.label,
      value,
      elementId: field.elementId,
      stableKey: field.stableKey,
    });
  }
  return expectedFields;
}

function inferExpectedFieldValue(
  userRequest: string,
  field: FormFieldObservation,
  fields: FormFieldObservation[],
): string | null {
  if (field.kind === "checkbox" || field.kind === "radio") {
    return inferExpectedBooleanValue(userRequest, field);
  }

  const text = cleanLabel(userRequest);
  for (const alias of formFieldAliases(field)) {
    const quoted = new RegExp(
      `\\b${escapeRegExp(alias)}\\b\\s*(?:is|=|:|to|as)?\\s*["']([^"']+)["']`,
      "i",
    ).exec(text);
    if (quoted?.[1]) {
      const value = trimInferredValue(quoted[1], field, fields);
      if (value) return value;
    }

    const unquoted = new RegExp(
      `\\b${escapeRegExp(alias)}\\b\\s*(?:is|=|:|to|as)?\\s+([^,;\\n]+(?:\\s+[^,;\\n]+){0,16})`,
      "i",
    ).exec(text);
    if (!unquoted?.[1]) continue;
    const value = trimInferredValue(unquoted[1], field, fields);
    if (value) return value;
  }
  return null;
}

function inferExpectedBooleanValue(
  userRequest: string,
  field: FormFieldObservation,
): string | null {
  const requestText = normalizeText(userRequest);
  for (const alias of formFieldAliases(field)) {
    const explicit = new RegExp(
      `\\b${escapeRegExp(alias)}\\b\\s*(?:is|=|:|to)?\\s*(true|false|yes|no|on|off|checked|unchecked)\\b`,
      "i",
    ).exec(requestText);
    if (explicit?.[1]) {
      const parsed = parseBooleanLike(explicit[1]);
      if (parsed != null) return String(parsed);
    }

    const index = requestText.indexOf(alias);
    if (index < 0) continue;
    const window = requestText.slice(
      Math.max(0, index - 45),
      Math.min(requestText.length, index + alias.length + 45),
    );
    if (/\b(?:uncheck|deselect|clear|disable|turn off)\b/i.test(window)) {
      return "false";
    }
    if (
      /\b(?:check|select|tick|enable|turn on|agree|accept)\b/i.test(window)
    ) {
      return "true";
    }
  }
  return null;
}

function trimInferredValue(
  rawValue: string,
  field: FormFieldObservation,
  fields: FormFieldObservation[],
): string {
  let value = cleanLabel(rawValue);
  let trimmedAtBoundary = false;
  const otherAliases = fields
    .filter((candidate) => candidate.stableKey !== field.stableKey)
    .flatMap(formFieldAliases)
    .sort((a, b) => b.length - a.length);

  for (const alias of otherAliases) {
    const boundary = new RegExp(
      `\\b(?:and|then|also)?\\s*(?:check|uncheck|select|set|choose|fill|enter|type)?\\s*${escapeRegExp(alias)}\\b`,
      "i",
    ).exec(value);
    if (boundary && boundary.index > 0) {
      value = value.slice(0, boundary.index);
      trimmedAtBoundary = true;
    }
  }

  value = value.replace(
    /\.\s+(?:then|and|click|press|submit|save|check|uncheck|select|set|choose|fill|enter|type)\b.*$/i,
    "",
  );
  if (trimmedAtBoundary) {
    value = value.replace(/[.]+$/g, "");
  }
  value = value.replace(/\b(?:and|then|also|too)$/i, "");
  value = value.replace(/^["']|["']$/g, "");
  return cleanLabel(value);
}

function formFieldAliases(field: FormFieldObservation): string[] {
  const normalizedLabel = normalizeText(field.label);
  const aliases = new Set<string>([normalizedLabel]);
  const compactLabel = normalizedLabel.replace(/[^a-z0-9]+/g, " ").trim();
  if (compactLabel) aliases.add(compactLabel);

  if (/\be[-\s]?mail\b/i.test(normalizedLabel)) {
    aliases.add("email");
    aliases.add("e-mail");
    aliases.add("mail");
  }
  if (/\buser\s*name\b/i.test(normalizedLabel)) {
    aliases.add("username");
    aliases.add("user name");
  }
  if (/\bfirst\s*name\b/i.test(normalizedLabel)) aliases.add("first name");
  if (/\blast\s*name\b/i.test(normalizedLabel)) aliases.add("last name");
  if (/\bpostal\b/i.test(normalizedLabel)) aliases.add("postal code");
  if (/\bzip\b/i.test(normalizedLabel)) aliases.add("zip");

  for (const term of [
    "address",
    "city",
    "company",
    "country",
    "description",
    "message",
    "name",
    "password",
    "phone",
    "priority",
    "state",
    "subject",
    "title",
    "username",
  ]) {
    if (normalizedLabel.includes(term)) aliases.add(term);
  }

  return [...aliases]
    .map((alias) => normalizeText(alias))
    .filter((alias) => alias.length >= 3)
    .sort((a, b) => b.length - a.length);
}

function inferWorkflowConfirmationAction(
  value: string,
): WorkflowConfirmationAction | null {
  const text = normalizeText(value);
  if (isModalDismissalWorkflowRequest(text)) return "dismiss";
  if (/\b(?:delete|deleted|deletion|remove|removed|removal)\b/i.test(text)) {
    return "delete";
  }
  if (/\b(?:archive|archived|archival)\b/i.test(text)) return "archive";
  if (/\b(?:save|saved)\b/i.test(text)) return "save";
  if (/\b(?:send|sent)\b/i.test(text)) return "send";
  if (
    /\bexport(?:ed)?\s+(?:the\s+)?(?:file|report|document|csv|pdf|spreadsheet|data|dataset|results?|table|list|view|logs?)\b/i.test(
      text,
    )
  ) {
    return "export";
  }
  if (
    /\bdownload(?:ed)?\s+(?:the\s+)?(?:file|report|document|attachment|csv|pdf|spreadsheet|export|data|dataset|results?|invoice|receipt|logs?|archive)\b/i.test(
      text,
    )
  ) {
    return "download";
  }
  if (
    /\bupload(?:ed)?\s+(?:the\s+)?(?:file|report|document|attachment|image|photo|csv|pdf|spreadsheet|data|dataset|results?|logs?|archive)\b/i.test(
      text,
    )
  ) {
    return "upload";
  }
  if (
    /\bimport(?:ed)?\s+(?:the\s+)?(?:file|report|document|csv|spreadsheet|data|dataset|results?|table|list|view|contacts?|records?|items?)\b/i.test(
      text,
    )
  ) {
    return "import";
  }
  if (
    /\bdetach(?:ed)?\s+(?:the\s+)?(?:file|report|document|attachment|image|photo|invoice|receipt|log|logs|record|item|task|ticket|request|entry|row|comment|message|note|account|case|issue)\b/i.test(
      text,
    )
  ) {
    return "detach";
  }
  if (
    /\battach(?:ed)?\s+(?:the\s+)?(?:file|report|document|attachment|image|photo|invoice|receipt|log|logs|record|item|task|ticket|request|entry|row|comment|message|note|account|case|issue)\b/i.test(
      text,
    )
  ) {
    return "attach";
  }
  if (
    /\b(?:copy|copied)\s+(?:the\s+)?(?:link|url|address|text|code|value|id|identifier|token|key|path|email|phone|file|report|document|message|comment|article|page|record|item|task|ticket|request|entry|row|table|list|view)\b/i.test(
      text,
    )
  ) {
    return "copy";
  }
  if (
    /\b(?:transfer|transferred)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|workflow|rule|ownership|assignment)\b/i.test(
      text,
    )
  ) {
    return "transfer";
  }
  if (
    /\b(?:move|moved)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|message|comment|thread|conversation|card|column|list|board|workflow|rule)\b/i.test(
      text,
    )
  ) {
    return "move";
  }
  if (
    /\b(?:rename|renamed)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|message|comment|thread|conversation|card|column|list|board|workflow|rule|profile|workspace)\b/i.test(
      text,
    )
  ) {
    return "rename";
  }
  if (
    /\b(?:merge|merged)\s+(?:the\s+)?(?:pull\s+request|merge\s+request|pr|branch|record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|document|report|page|message|comment|thread|conversation|workspace)\b/i.test(
      text,
    )
  ) {
    return "merge";
  }
  if (
    /\bunschedule(?:d)?\s+(?:the\s+)?(?:report|dashboard|job|task|ticket|request|entry|row|case|issue|incident|project|workflow|rule|automation|process|pipeline|message|email|notification|reminder|meeting|event|appointment|sync|backup|export|import|deployment|release)\b/i.test(
      text,
    )
  ) {
    return "unschedule";
  }
  if (
    /\bschedule(?:d)?\s+(?:the\s+)?(?:report|dashboard|job|task|ticket|request|entry|row|case|issue|incident|project|workflow|rule|automation|process|pipeline|message|email|notification|reminder|meeting|event|appointment|sync|backup|export|import|deployment|release)\b/i.test(
      text,
    )
  ) {
    return "schedule";
  }
  if (
    /\b(?:rollback|roll\s+back|rolled\s+back)\s+(?:the\s+)?(?:app|application|service|site|release|build|version|environment|deployment|package|workflow|pipeline|branch|change|changes)\b/i.test(
      text,
    )
  ) {
    return "rollback";
  }
  if (
    /\bdeploy(?:ed)?\s+(?:the\s+)?(?:app|application|service|site|release|build|version|environment|deployment|package|workflow|pipeline|branch|change|changes)\b/i.test(
      text,
    )
  ) {
    return "deploy";
  }
  if (
    /\b(?:back\s+up|backup|backed\s+up)\s+(?:the\s+)?(?:database|data|dataset|file|files|folder|folders|document|documents|record|records|settings|config|configuration|workspace|project|repository|repo|site|app|application|service|server|environment|system|account|profile|export|archive|backup)\b/i.test(
      text,
    )
  ) {
    return "backup";
  }
  if (
    /\breset(?:ting)?\s+(?:the\s+)?(?:password|passcode|pin|mfa|2fa|credential|credentials|token|key|secret|settings?|config|configuration|preferences?|cache|session|account|profile|device|app|application|service|workflow|rule|job|pipeline|database|data|dataset|form|filters?|view|dashboard|report)\b/i.test(
      text,
    )
  ) {
    return "reset";
  }
  if (
    /\bunsuspend(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|service|subscription|plan|workspace|project|workflow|rule|job|pipeline|task|ticket|request|record|item|case|issue|incident|access|license|licence)\b/i.test(
      text,
    )
  ) {
    return "unsuspend";
  }
  if (
    /\bsuspend(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|service|subscription|plan|workspace|project|workflow|rule|job|pipeline|task|ticket|request|record|item|case|issue|incident|access|license|licence)\b/i.test(
      text,
    )
  ) {
    return "suspend";
  }
  if (
    /\bunblock(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|contact|sender|email|domain|ip|address|device|app|application|service|site|url|workspace|project|task|ticket|request|record|item|case|issue|incident|access|license|licence)\b/i.test(
      text,
    )
  ) {
    return "unblock";
  }
  if (
    /\bblock(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|contact|sender|email|domain|ip|address|device|app|application|service|site|url|workspace|project|task|ticket|request|record|item|case|issue|incident|access|license|licence)\b/i.test(
      text,
    )
  ) {
    return "block";
  }
  if (
    /\bunlink(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|contact|record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|workflow|rule|integration|connector|service|app|application|device|domain|url)\b/i.test(
      text,
    )
  ) {
    return "unlink";
  }
  if (
    /\blink(?:ed|ing)?\s+(?:the\s+)?(?:account|profile|user|member|person|customer|client|contact|record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|workflow|rule|integration|connector|service|app|application|device|domain|url)\b/i.test(
      text,
    )
  ) {
    return "link";
  }
  if (
    /\buntag(?:ged|ging)?\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|user|member|profile)\b/i.test(
      text,
    )
  ) {
    return "untag";
  }
  if (
    /\btag(?:ged|ging)?\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|user|member|profile)\b/i.test(
      text,
    )
  ) {
    return "tag";
  }
  if (
    /\bunflag(?:ged|ging)?\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|email|user|member|profile)\b/i.test(
      text,
    )
  ) {
    return "unflag";
  }
  if (
    /\bflag(?:ged|ging)?\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|email|user|member|profile)\b/i.test(
      text,
    )
  ) {
    return "flag";
  }
  if (
    /\b(?:duplicate(?:d)?|clone(?:d)?)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile)\b/i.test(
      text,
    )
  ) {
    return "duplicate";
  }
  if (
    /\b(?:restore(?:d)?|recover(?:ed)?|reinstate(?:d)?)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|archive|version|backup)\b/i.test(
      text,
    )
  ) {
    return "restore";
  }
  if (
    /\b(?:create(?:d)?|add(?:ed)?|register(?:ed)?)\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|order|case|issue|incident|project|contact|customer)\b/i.test(
      text,
    )
  ) {
    return "create";
  }
  if (
    /\bshare\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|folder|workflow|rule|dashboard|view|list|policy|profile|link|board|project|invoice|receipt)\b/i.test(
      text,
    )
  ) {
    return "share";
  }
  if (
    /\bgrant(?:ed)?\s+(?:the\s+)?(?:access|permission|permissions?|privilege|privileges?|role|roles?|license|licence|licenses|licences|entitlement|entitlements?|membership|admin|administrator|viewer|editor|owner|read\s+access|write\s+access)\b/i.test(
      text,
    )
  ) {
    return "grant";
  }
  if (
    /\brevok(?:e|ed)\s+(?:the\s+)?(?:access|permission|permissions?|privilege|privileges?|role|roles?|license|licence|licenses|licences|entitlement|entitlements?|membership|admin|administrator|viewer|editor|owner|read\s+access|write\s+access)\b/i.test(
      text,
    )
  ) {
    return "revoke";
  }
  if (
    /\binstall(?:ed)?\s+(?:the\s+)?(?:app|application|extension|plugin|package|module|integration|connector|driver|dependency|tool|theme|add[-\s]?on|update|workflow|rule)\b/i.test(
      text,
    )
  ) {
    return "install";
  }
  if (
    /\buninstall(?:ed)?\s+(?:the\s+)?(?:app|application|extension|plugin|package|module|integration|connector|driver|dependency|tool|theme|add[-\s]?on|update|workflow|rule)\b/i.test(
      text,
    )
  ) {
    return "uninstall";
  }
  if (
    /\bdisconnect(?:ed)?\s+(?:the\s+)?(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection)\b/i.test(
      text,
    )
  ) {
    return "disconnect";
  }
  if (
    /\bconnect(?:ed)?\s+(?:the\s+)?(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection)\b/i.test(
      text,
    )
  ) {
    return "connect";
  }
  if (
    /\b(?:sync(?:ed)?|resync(?:ed)?|synchroni[sz](?:e|ed))\s+(?:the\s+)?(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection|calendar|contacts?|files?|folders?|documents?|settings|config|configuration|backup|workflow|rule|job|pipeline|queue)\b/i.test(
      text,
    )
  ) {
    return "sync";
  }
  if (
    /\binvit(?:e|ed)\s+(?:the\s+)?(?:user|member|person|contact|customer|client|guest|reviewer|approver|editor|viewer|admin|administrator|collaborator|teammate|team|group)\b/i.test(
      text,
    )
  ) {
    return "invite";
  }
  if (
    /\bunsubscrib(?:e|ed)\s+(?:from\s+)?(?:the\s+)?(?:channel|topic|list|newsletter|report|dashboard|board|project|queue|feed|service|plan|notification|notifications?|updates?|digest|subscription)\b/i.test(
      text,
    )
  ) {
    return "unsubscribe";
  }
  if (
    /\bsubscrib(?:e|ed)\s+(?:to\s+)?(?:the\s+)?(?:channel|topic|list|newsletter|report|dashboard|board|project|queue|feed|service|plan|notification|notifications?|updates?|digest|subscription)\b/i.test(
      text,
    )
  ) {
    return "subscribe";
  }
  if (
    /\bunpin(?:ned)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic)\b/i.test(
      text,
    )
  ) {
    return "unpin";
  }
  if (
    /\bpin(?:ned)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic)\b/i.test(
      text,
    )
  ) {
    return "pin";
  }
  if (
    /\bunmut(?:e|ed)\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|user|member|contact|notification|notifications?|alert|alerts?)\b/i.test(
      text,
    )
  ) {
    return "unmute";
  }
  if (
    /\bmut(?:e|ed)\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|user|member|contact|notification|notifications?|alert|alerts?)\b/i.test(
      text,
    )
  ) {
    return "mute";
  }
  if (
    /\bunfollow(?:ed)?\s+(?:the\s+)?(?:user|member|contact|account|profile|channel|topic|thread|conversation|project|board|list|report|dashboard|page|feed|newsletter|tag|repository|repo)\b/i.test(
      text,
    )
  ) {
    return "unfollow";
  }
  if (
    /\bfollow(?:ed)?\s+(?:the\s+)?(?:user|member|contact|account|profile|channel|topic|thread|conversation|project|board|list|report|dashboard|page|feed|newsletter|tag|repository|repo)\b/i.test(
      text,
    )
  ) {
    return "follow";
  }
  if (
    /\bunbookmark(?:ed)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site)\b/i.test(
      text,
    )
  ) {
    return "unbookmark";
  }
  if (
    /\bbookmark(?:ed)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site)\b/i.test(
      text,
    )
  ) {
    return "bookmark";
  }
  if (
    /\bunfavorite(?:d)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site|user|member|contact|account|profile|repository|repo)\b/i.test(
      text,
    )
  ) {
    return "unfavorite";
  }
  if (
    /\bfavorite(?:d)?\s+(?:the\s+)?(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site|user|member|contact|account|profile|repository|repo)\b/i.test(
      text,
    )
  ) {
    return "favorite";
  }
  if (
    /\bunwatch(?:ed)?\s+(?:the\s+)?(?:repository|repo|project|board|list|report|dashboard|page|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|queue|service|job|pipeline|workflow|record|item)\b/i.test(
      text,
    )
  ) {
    return "unwatch";
  }
  if (
    /\bwatch(?:ed)?\s+(?:the\s+)?(?:repository|repo|project|board|list|report|dashboard|page|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|queue|service|job|pipeline|workflow|record|item)\b/i.test(
      text,
    )
  ) {
    return "watch";
  }
  if (
    /\bunstar(?:red)?\s+(?:the\s+)?(?:repository|repo|project|board|list|report|dashboard|page|document|file|folder|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|record|item|message|comment|article|link|site|user|member|contact|profile)\b/i.test(
      text,
    )
  ) {
    return "unstar";
  }
  if (
    /\bstar(?:red)?\s+(?:the\s+)?(?:repository|repo|project|board|list|report|dashboard|page|document|file|folder|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|record|item|message|comment|article|link|site|user|member|contact|profile)\b/i.test(
      text,
    )
  ) {
    return "star";
  }
  if (/\b(?:post|posted|publish|published)\b/i.test(text)) return "post";
  if (/\b(?:approve|approved)\b/i.test(text)) return "approve";
  if (/\b(?:reject|rejected|deny|denied)\b/i.test(text)) return "reject";
  if (/\bre[-\s]?open(?:ed)?\b/i.test(text)) return "reopen";
  if (/\b(?:cancel|canceled|cancelled|cancellation)\b/i.test(text)) {
    return "cancel";
  }
  if (
    /\b(?:enable|activate)\b/i.test(text) ||
    /\bturn\s+on\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\b(?:enabled|activated|active)\b/i.test(text)
  ) {
    return "enable";
  }
  if (
    /\b(?:disable|deactivate)\b/i.test(text) ||
    /\bturn\s+off\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\b(?:disabled|deactivated|inactive)\b/i.test(
      text,
    )
  ) {
    return "disable";
  }
  if (
    /\bunassign\b/i.test(text) ||
    /\bclear\s+(?:the\s+)?assignee\b/i.test(text) ||
    /\bremove\s+(?:the\s+)?assignment\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\bunassigned\b/i.test(text)
  ) {
    return "unassign";
  }
  if (
    /\bassign\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\bassigned\b/i.test(text)
  ) {
    return "assign";
  }
  if (
    /\bde[-\s]?escalate\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\bde[-\s]?escalated\b/i.test(text)
  ) {
    return "deescalate";
  }
  if (
    /\bescalate\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\bescalated\b/i.test(text)
  ) {
    return "escalate";
  }
  if (
    /\bunlock\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\bunlocked\b/i.test(text)
  ) {
    return "unlock";
  }
  if (
    /\block\b/i.test(text) ||
    /\b(?:set|make|mark)\b.{0,40}\blocked\b/i.test(text)
  ) {
    return "lock";
  }
  if (
    /\bpause\s+(?:the\s+)?(?:automation|job|operation|pipeline|process|queue|record|request|schedule|service|subscription|sync|task|ticket|workflow)\b/i.test(
      text,
    )
  ) {
    return "pause";
  }
  if (
    /\bresume\s+(?:the\s+)?(?:automation|job|operation|pipeline|process|queue|record|request|schedule|service|subscription|sync|task|ticket|workflow)\b/i.test(
      text,
    )
  ) {
    return "resume";
  }
  if (
    /\brestart\s+(?:the\s+)?(?:automation|job|operation|pipeline|process|queue|record|request|schedule|service|subscription|sync|task|ticket|workflow)\b/i.test(
      text,
    )
  ) {
    return "restart";
  }
  if (
    /\brefresh\s+(?:the\s+)?(?:automation|cache|dashboard|data|dataset|job|list|operation|pipeline|queue|record|report|request|schedule|service|subscription|sync|table|task|ticket|view|workflow)\b/i.test(
      text,
    )
  ) {
    return "refresh";
  }
  if (
    /\bstart\s+(?:the\s+)?(?:automation|job|operation|pipeline|process|queue|record|request|schedule|service|subscription|sync|task|ticket|workflow)\b/i.test(
      text,
    )
  ) {
    return "start";
  }
  if (
    /\bstop\s+(?:the\s+)?(?:automation|job|operation|pipeline|process|queue|record|request|schedule|service|subscription|sync|task|ticket|workflow)\b/i.test(
      text,
    )
  ) {
    return "stop";
  }
  if (/\b(?:close|closed|resolve|resolved)\b/i.test(text)) return "close";
  if (/\b(?:dismiss|dismissed)\b/i.test(text)) return "dismiss";
  if (/\b(?:update|updated|change|changed|apply|applied)\b/i.test(text)) {
    return "update";
  }
  if (/\b(?:submit|submitted|submission)\b/i.test(text)) return "submit";
  if (isCompleteWorkflowRequest(text)) return "complete";
  return null;
}

function inferWorkflowConfirmationTargetLabel(
  value: string,
  action: WorkflowConfirmationAction,
): string | null {
  if (action === "complete") {
    const completeTarget = inferCompleteWorkflowTargetLabel(value);
    if (completeTarget) return completeTarget;
  }

  const actionPattern = workflowTargetActionPattern(action);
  if (!actionPattern) return null;
  const lines = value
    .split(/\n+/g)
    .map((line) => cleanLabel(line))
    .filter(Boolean);

  for (const line of lines) {
    if (!new RegExp(`\\b${actionPattern}\\b`, "i").test(line)) continue;

    const quoted = /["']([^"']{2,120})["']/.exec(line)?.[1];
    const quotedTarget = normalizeWorkflowTargetLabel(quoted ?? "", {
      quoted: true,
    });
    if (quotedTarget) return quotedTarget;

    const direct = new RegExp(
      `\\b${actionPattern}\\b\\s+(?:the\\s+)?(.+?)(?:[.;,]|$)`,
      "i",
    ).exec(line)?.[1];
    const directTarget = normalizeWorkflowTargetLabel(direct ?? "");
    if (directTarget) return directTarget;
  }

  return null;
}

function workflowTargetActionPattern(
  action: WorkflowConfirmationAction,
): string | null {
  switch (action) {
    case "delete":
      return "(?:delete|remove)";
    case "archive":
      return "(?:archive)";
    case "save":
      return "(?:save)";
    case "send":
      return "(?:send)";
    case "export":
      return "(?:export)";
    case "download":
      return "(?:download)";
    case "upload":
      return "(?:upload)";
    case "import":
      return "(?:import)";
    case "attach":
      return "(?:attach)";
    case "detach":
      return "(?:detach)";
    case "copy":
      return "(?:copy)";
    case "transfer":
      return "(?:transfer)";
    case "move":
      return "(?:move)";
    case "rename":
      return "(?:rename)";
    case "merge":
      return "(?:merge)";
    case "schedule":
      return "(?:schedule)";
    case "unschedule":
      return "(?:unschedule)";
    case "deploy":
      return "(?:deploy)";
    case "rollback":
      return "(?:roll\\s+back|rollback)";
    case "backup":
      return "(?:back\\s+up|backup)";
    case "reset":
      return "(?:reset)";
    case "suspend":
      return "(?:suspend)";
    case "unsuspend":
      return "(?:unsuspend)";
    case "block":
      return "(?:block)";
    case "unblock":
      return "(?:unblock)";
    case "link":
      return "(?:link)";
    case "unlink":
      return "(?:unlink)";
    case "tag":
      return "(?:tag)";
    case "untag":
      return "(?:untag)";
    case "flag":
      return "(?:flag)";
    case "unflag":
      return "(?:unflag)";
    case "duplicate":
      return "(?:duplicate|clone)";
    case "restore":
      return "(?:restore|recover|reinstate)";
    case "create":
      return "(?:create|add|register)";
    case "share":
      return "(?:share)";
    case "grant":
      return "(?:grant)";
    case "revoke":
      return "(?:revoke)";
    case "install":
      return "(?:install)";
    case "uninstall":
      return "(?:uninstall)";
    case "connect":
      return "(?:connect)";
    case "disconnect":
      return "(?:disconnect)";
    case "sync":
      return "(?:sync|resync|synchroni[sz]e)";
    case "invite":
      return "(?:invite)";
    case "subscribe":
      return "(?:subscribe(?:\\s+to)?)";
    case "unsubscribe":
      return "(?:unsubscribe(?:\\s+from)?)";
    case "pin":
      return "(?:pin)";
    case "unpin":
      return "(?:unpin)";
    case "mute":
      return "(?:mute)";
    case "unmute":
      return "(?:unmute)";
    case "follow":
      return "(?:follow)";
    case "unfollow":
      return "(?:unfollow)";
    case "bookmark":
      return "(?:bookmark)";
    case "unbookmark":
      return "(?:unbookmark)";
    case "favorite":
      return "(?:favorite)";
    case "unfavorite":
      return "(?:unfavorite)";
    case "watch":
      return "(?:watch)";
    case "unwatch":
      return "(?:unwatch)";
    case "star":
      return "(?:star)";
    case "unstar":
      return "(?:unstar)";
    case "post":
      return "(?:post|publish)";
    case "approve":
      return "(?:approve)";
    case "reject":
      return "(?:reject|deny)";
    case "close":
      return "(?:close|resolve)";
    case "reopen":
      return "(?:re[-\\s]?open)";
    case "cancel":
      return "(?:cancel)";
    case "enable":
      return "(?:enable|activate|turn\\s+on)";
    case "disable":
      return "(?:disable|deactivate|turn\\s+off)";
    case "assign":
      return "(?:assign)";
    case "unassign":
      return "(?:unassign)";
    case "escalate":
      return "(?:escalate)";
    case "deescalate":
      return "(?:de[-\\s]?escalate)";
    case "lock":
      return "(?:lock)";
    case "unlock":
      return "(?:unlock)";
    case "pause":
      return "(?:pause)";
    case "resume":
      return "(?:resume)";
    case "start":
      return "(?:start)";
    case "stop":
      return "(?:stop)";
    case "restart":
      return "(?:restart)";
    case "refresh":
      return "(?:refresh)";
    case "update":
      return "(?:update|change|apply)";
    case "submit":
      return "(?:submit)";
    case "complete":
      return "(?:complete|mark|set)";
    default:
      return null;
  }
}

function inferCompleteWorkflowTargetLabel(value: string): string | null {
  const lines = value
    .split(/\n+/g)
    .map((line) => cleanLabel(line))
    .filter(Boolean);

  for (const line of lines) {
    if (!isCompleteWorkflowRequest(line)) continue;

    const quoted = /["']([^"']{2,120})["']/.exec(line)?.[1];
    const quotedTarget = normalizeWorkflowTargetLabel(quoted ?? "", {
      quoted: true,
    });
    if (quotedTarget) return quotedTarget;

    const markTarget = /\b(?:mark|set)\s+(?:the\s+)?(.{2,120}?)\s+(?:as\s+)?complete(?:d)?\b/i.exec(
      line,
    )?.[1];
    const completeTarget = /\bcomplete(?:d)?\s+(?:the\s+)?(.{2,120}?)(?:[.;,]|$)/i.exec(
      line,
    )?.[1];
    const target = normalizeWorkflowTargetLabel(
      markTarget ?? completeTarget ?? "",
    );
    if (target) return target;
  }

  return null;
}

function normalizeWorkflowTargetLabel(
  value: string,
  options: { quoted?: boolean; allowShort?: boolean } = {},
): string | null {
  let target = cleanLabel(value);
  if (!target) return null;
  target = target.replace(
    /^(?:the|this|that|selected|current|visible)\s+/i,
    "",
  );
  target = target.replace(
    /\s+(?:and|then|after that)\s+(?:confirm|verify|make sure|ensure|check|click|press|select|open|go)\b.+$/i,
    "",
  );
  target = target.replace(/\s+(?:from|in|on|under|inside)\s+.+$/i, "");
  target = target.replace(/\s+(?:please|now)$/i, "");
  target = cleanLabel(target);
  if (!target) return null;

  const normalized = normalizeText(target);
  if (
    /^(?:record|item|row|entry|target|object|selection|selected|current|this|that|it|them)$/i.test(
      normalized,
    )
  ) {
    return null;
  }

  const tokens = tokenizeCompletionText(target);
  if (tokens.length === 0) return null;
  if (
    !options.quoted &&
    !options.allowShort &&
    tokens.length < 2 &&
    !/[\d_-]/.test(target)
  ) {
    return null;
  }
  return target.slice(0, 160);
}

function workflowConfirmationMatchesTarget(
  event: Extract<CompletionEvidence, { type: "confirmation_state" }>,
  targetLabel: string | undefined,
): boolean {
  if (!targetLabel) return true;
  if (event.detail.source === "target_disappearance") {
    return workflowTargetLabelCoveredByText(targetLabel, event.detail.text);
  }
  if (
    event.detail.source === "visible_text" &&
    isTargetAwareVisibleWorkflowAction(event.detail.action)
  ) {
    return visibleWorkflowConfirmationMatchesTarget(
      event.detail.text,
      event.detail.action,
      targetLabel,
    );
  }
  if (
    (event.detail.source === "status_change" ||
      event.detail.source === "control_label_change" ||
      event.detail.source === "control_state_change" ||
      event.detail.source === "dirty_indicator_cleared") &&
    event.detail.targetText
  ) {
    return workflowTargetLabelCoveredByText(targetLabel, event.detail.targetText);
  }
  return true;
}

function isTargetAwareVisibleWorkflowAction(
  action: WorkflowConfirmationAction | undefined,
): action is TargetAwareVisibleWorkflowAction {
  return (
    action === "delete" ||
    action === "archive" ||
    action === "save" ||
    action === "send" ||
    action === "export" ||
    action === "download" ||
    action === "upload" ||
    action === "import" ||
    action === "attach" ||
    action === "detach" ||
    action === "copy" ||
    action === "transfer" ||
    action === "move" ||
    action === "rename" ||
    action === "merge" ||
    action === "schedule" ||
    action === "unschedule" ||
    action === "deploy" ||
    action === "rollback" ||
    action === "backup" ||
    action === "reset" ||
    action === "suspend" ||
    action === "unsuspend" ||
    action === "block" ||
    action === "unblock" ||
    action === "link" ||
    action === "unlink" ||
    action === "tag" ||
    action === "untag" ||
    action === "flag" ||
    action === "unflag" ||
    action === "duplicate" ||
    action === "restore" ||
    action === "create" ||
    action === "share" ||
    action === "grant" ||
    action === "revoke" ||
    action === "install" ||
    action === "uninstall" ||
    action === "connect" ||
    action === "disconnect" ||
    action === "sync" ||
    action === "invite" ||
    action === "subscribe" ||
    action === "unsubscribe" ||
    action === "pin" ||
    action === "unpin" ||
    action === "mute" ||
    action === "unmute" ||
    action === "follow" ||
    action === "unfollow" ||
    action === "bookmark" ||
    action === "unbookmark" ||
    action === "favorite" ||
    action === "unfavorite" ||
    action === "watch" ||
    action === "unwatch" ||
    action === "star" ||
    action === "unstar" ||
    action === "post" ||
    action === "approve" ||
    action === "reject" ||
    action === "close" ||
    action === "reopen" ||
    action === "cancel" ||
    action === "enable" ||
    action === "disable" ||
    action === "assign" ||
    action === "unassign" ||
    action === "escalate" ||
    action === "deescalate" ||
    action === "lock" ||
    action === "unlock" ||
    action === "pause" ||
    action === "resume" ||
    action === "start" ||
    action === "stop" ||
    action === "restart" ||
    action === "refresh" ||
    action === "update" ||
    action === "submit" ||
    action === "complete"
  );
}

function workflowTargetLabelCoveredByText(
  targetLabel: string,
  text: string,
): boolean {
  const normalizedTarget = normalizeText(targetLabel);
  const normalizedText = normalizeText(text);
  if (normalizedTarget && normalizedText.includes(normalizedTarget)) {
    return true;
  }

  const targetTokens = tokenizeCompletionText(targetLabel);
  const meaningfulTargetTokens = targetTokens.filter(
    (token) =>
      !/^(?:record|item|row|entry|object|button|link|target)$/i.test(token),
  );
  if (
    meaningfulTargetTokens.length > 0 &&
    meaningfulTargetTokens.length < targetTokens.length &&
    meaningfulTargetTokens.every((token) =>
      valueTokenCoveredBySummary(normalizedText, token),
    )
  ) {
    return true;
  }
  return (
    targetTokens.length > 0 &&
    targetTokens.every((token) =>
      valueTokenCoveredBySummary(normalizedText, token),
    )
  );
}

function visibleWorkflowConfirmationMatchesTarget(
  text: string,
  action: TargetAwareVisibleWorkflowAction,
  targetLabel: string,
): boolean {
  const candidate = extractVisibleWorkflowConfirmationTarget(
    text,
    action,
    targetLabel,
  );
  if (!candidate) return true;
  return workflowTargetLabelCoveredByText(targetLabel, candidate);
}

function extractVisibleWorkflowConfirmationTarget(
  text: string,
  action: TargetAwareVisibleWorkflowAction,
  targetLabel: string,
): string | null {
  const normalizedText = cleanLabel(text);
  if (!normalizedText) return null;

  const targetTokens = tokenizeCompletionText(targetLabel);
  const targetTokenCount = Math.max(1, Math.min(targetTokens.length, 8));
  const resultTerms = workflowTargetVisibleResultPattern(action);
  const nounTerms = workflowTargetVisibleNounPattern(action);
  const beforeResult = new RegExp(
    `(.{2,180}?)\\s+(?:was\\s+)?${resultTerms}\\s+(?:successfully|complete|completed|confirmed)\\b`,
    "i",
  ).exec(normalizedText)?.[1];
  const beforeCandidate = normalizeWorkflowTargetTail(
    beforeResult ?? "",
    targetTokenCount,
  );
  if (beforeCandidate) return beforeCandidate;

  const afterResult = new RegExp(
    `\\b${resultTerms}\\s+(.{2,180}?)\\s+(?:successfully|complete|completed|confirmed)\\b`,
    "i",
  ).exec(normalizedText)?.[1];
  const afterCandidate = normalizeWorkflowTargetHead(
    afterResult ?? "",
    targetTokenCount,
  );
  if (afterCandidate) return afterCandidate;

  const beforeNoun = new RegExp(
    `(.{2,180}?)\\s+${nounTerms}\\s+(?:complete|completed|confirmed|successful)\\b`,
    "i",
  ).exec(normalizedText)?.[1];
  return normalizeWorkflowTargetTail(beforeNoun ?? "", targetTokenCount);
}

function workflowTargetVisibleResultPattern(
  action: TargetAwareVisibleWorkflowAction,
): string {
  switch (action) {
    case "delete":
      return "(?:deleted|removed)";
    case "archive":
      return "(?:archived)";
    case "save":
      return "(?:saved)";
    case "send":
      return "(?:sent)";
    case "export":
      return "(?:exported)";
    case "download":
      return "(?:downloaded)";
    case "upload":
      return "(?:uploaded)";
    case "import":
      return "(?:imported)";
    case "attach":
      return "(?:attached)";
    case "detach":
      return "(?:detached)";
    case "copy":
      return "(?:copied)";
    case "transfer":
      return "(?:transferred)";
    case "move":
      return "(?:moved)";
    case "rename":
      return "(?:renamed)";
    case "merge":
      return "(?:merged)";
    case "schedule":
      return "(?:scheduled)";
    case "unschedule":
      return "(?:unscheduled)";
    case "deploy":
      return "(?:deployed)";
    case "rollback":
      return "(?:rolled\\s+back|reverted)";
    case "backup":
      return "(?:backed\\s+up)";
    case "reset":
      return "(?:reset)";
    case "suspend":
      return "(?:suspended)";
    case "unsuspend":
      return "(?:unsuspended)";
    case "block":
      return "(?:blocked)";
    case "unblock":
      return "(?:unblocked)";
    case "link":
      return "(?:linked)";
    case "unlink":
      return "(?:unlinked)";
    case "tag":
      return "(?:tagged)";
    case "untag":
      return "(?:untagged)";
    case "flag":
      return "(?:flagged)";
    case "unflag":
      return "(?:unflagged)";
    case "duplicate":
      return "(?:duplicated|cloned)";
    case "restore":
      return "(?:restored|recovered|reinstated)";
    case "create":
      return "(?:created|added|registered)";
    case "share":
      return "(?:shared)";
    case "grant":
      return "(?:granted)";
    case "revoke":
      return "(?:revoked)";
    case "install":
      return "(?:installed)";
    case "uninstall":
      return "(?:uninstalled)";
    case "connect":
      return "(?:connected)";
    case "disconnect":
      return "(?:disconnected)";
    case "sync":
      return "(?:synced|resynced|synchroni[sz]ed)";
    case "invite":
      return "(?:invited)";
    case "subscribe":
      return "(?:subscribed)";
    case "unsubscribe":
      return "(?:unsubscribed)";
    case "pin":
      return "(?:pinned)";
    case "unpin":
      return "(?:unpinned)";
    case "mute":
      return "(?:muted)";
    case "unmute":
      return "(?:unmuted)";
    case "follow":
      return "(?:followed)";
    case "unfollow":
      return "(?:unfollowed)";
    case "bookmark":
      return "(?:bookmarked)";
    case "unbookmark":
      return "(?:unbookmarked)";
    case "favorite":
      return "(?:favorited)";
    case "unfavorite":
      return "(?:unfavorited)";
    case "watch":
      return "(?:watched)";
    case "unwatch":
      return "(?:unwatched)";
    case "star":
      return "(?:starred)";
    case "unstar":
      return "(?:unstarred)";
    case "post":
      return "(?:posted|published)";
    case "approve":
      return "(?:approved)";
    case "reject":
      return "(?:rejected|denied)";
    case "close":
      return "(?:closed|resolved)";
    case "reopen":
      return "(?:re[-\\s]?opened)";
    case "cancel":
      return "(?:cancell?ed)";
    case "enable":
      return "(?:enabled|activated)";
    case "disable":
      return "(?:disabled|deactivated)";
    case "assign":
      return "(?:assigned)";
    case "unassign":
      return "(?:unassigned|assignee\\s+(?:cleared|removed))";
    case "escalate":
      return "(?:escalated)";
    case "deescalate":
      return "(?:de[-\\s]?escalated)";
    case "lock":
      return "(?:locked)";
    case "unlock":
      return "(?:unlocked)";
    case "pause":
      return "(?:paused)";
    case "resume":
      return "(?:resumed)";
    case "start":
      return "(?:started)";
    case "stop":
      return "(?:stopped)";
    case "restart":
      return "(?:restarted)";
    case "refresh":
      return "(?:refreshed)";
    case "update":
      return "(?:updated|changed|applied)";
    case "submit":
      return "(?:submitted)";
    case "complete":
      return "(?:completed)";
  }
}

function workflowTargetVisibleNounPattern(
  action: TargetAwareVisibleWorkflowAction,
): string {
  switch (action) {
    case "delete":
      return "(?:deletion|removal)";
    case "archive":
      return "(?:archival)";
    case "save":
      return "(?:save)";
    case "send":
      return "(?:send)";
    case "export":
      return "(?:export)";
    case "download":
      return "(?:download)";
    case "upload":
      return "(?:upload)";
    case "import":
      return "(?:import)";
    case "attach":
      return "(?:attach|attachment)";
    case "detach":
      return "(?:detach|detachment)";
    case "copy":
      return "(?:copy)";
    case "transfer":
      return "(?:transfer)";
    case "move":
      return "(?:move)";
    case "rename":
      return "(?:rename)";
    case "merge":
      return "(?:merge)";
    case "schedule":
      return "(?:schedule)";
    case "unschedule":
      return "(?:unschedule)";
    case "deploy":
      return "(?:deploy|deployment)";
    case "rollback":
      return "(?:rollback|roll\\s+back|reversion)";
    case "backup":
      return "(?:backup|back\\s+up)";
    case "reset":
      return "(?:reset)";
    case "suspend":
      return "(?:suspend|suspension)";
    case "unsuspend":
      return "(?:unsuspend|unsuspension)";
    case "block":
      return "(?:block|blocking)";
    case "unblock":
      return "(?:unblock|unblocking)";
    case "link":
      return "(?:link|linking)";
    case "unlink":
      return "(?:unlink|unlinking)";
    case "tag":
      return "(?:tag|tagging)";
    case "untag":
      return "(?:untag|untagging)";
    case "flag":
      return "(?:flag|flagging)";
    case "unflag":
      return "(?:unflag|unflagging)";
    case "duplicate":
      return "(?:duplicate|duplication|clone)";
    case "restore":
      return "(?:restore|restoration|recover|recovery|reinstate|reinstatement)";
    case "create":
      return "(?:create|creation|add|registration|register)";
    case "share":
      return "(?:share|sharing)";
    case "grant":
      return "(?:grant|access|permission|role|license|licence|entitlement|membership)";
    case "revoke":
      return "(?:revoke|revocation|access|permission|role|license|licence|entitlement|membership)";
    case "install":
      return "(?:install|installation)";
    case "uninstall":
      return "(?:uninstall|uninstallation)";
    case "connect":
      return "(?:connect|connection)";
    case "disconnect":
      return "(?:disconnect|disconnection)";
    case "sync":
      return "(?:sync|resync|synchronization|synchronisation)";
    case "invite":
      return "(?:invite|invitation)";
    case "subscribe":
      return "(?:subscribe|subscription)";
    case "unsubscribe":
      return "(?:unsubscribe|unsubscription)";
    case "pin":
      return "(?:pin)";
    case "unpin":
      return "(?:unpin)";
    case "mute":
      return "(?:mute)";
    case "unmute":
      return "(?:unmute)";
    case "follow":
      return "(?:follow)";
    case "unfollow":
      return "(?:unfollow)";
    case "bookmark":
      return "(?:bookmark)";
    case "unbookmark":
      return "(?:unbookmark)";
    case "favorite":
      return "(?:favorite)";
    case "unfavorite":
      return "(?:unfavorite)";
    case "watch":
      return "(?:watch)";
    case "unwatch":
      return "(?:unwatch)";
    case "star":
      return "(?:star)";
    case "unstar":
      return "(?:unstar)";
    case "post":
      return "(?:post|publish)";
    case "approve":
      return "(?:approval)";
    case "reject":
      return "(?:rejection|denial)";
    case "close":
      return "(?:closure|resolution)";
    case "reopen":
      return "(?:re[-\\s]?opening|re[-\\s]?open)";
    case "cancel":
      return "(?:cancellation)";
    case "enable":
      return "(?:enable|activation)";
    case "disable":
      return "(?:disable|deactivation)";
    case "assign":
      return "(?:assignment)";
    case "unassign":
      return "(?:unassign|assignment)";
    case "escalate":
      return "(?:escalation|escalate)";
    case "deescalate":
      return "(?:de[-\\s]?escalation|de[-\\s]?escalate)";
    case "lock":
      return "(?:lock)";
    case "unlock":
      return "(?:unlock)";
    case "pause":
      return "(?:pause)";
    case "resume":
      return "(?:resume)";
    case "start":
      return "(?:start)";
    case "stop":
      return "(?:stop)";
    case "restart":
      return "(?:restart)";
    case "refresh":
      return "(?:refresh)";
    case "update":
      return "(?:update|change)";
    case "submit":
      return "(?:submission|submit)";
    case "complete":
      return "(?:completion|complete)";
  }
}

function normalizeWorkflowTargetTail(
  value: string,
  tokenCount: number,
): string | null {
  return normalizeWorkflowTargetTokenSlice(value, tokenCount, "tail");
}

function normalizeWorkflowTargetHead(
  value: string,
  tokenCount: number,
): string | null {
  return normalizeWorkflowTargetTokenSlice(value, tokenCount, "head");
}

function normalizeWorkflowTargetTokenSlice(
  value: string,
  tokenCount: number,
  side: "head" | "tail",
): string | null {
  const raw = cleanLabel(value);
  const allowGenericObjectShortTarget =
    /\b(?:record|item|row|entry|object|button|link)\b/i.test(raw);
  const cleaned = raw
    .replace(
      /\b(?:the|this|that|selected|current|visible|target|record|item|row|entry|object|button|link|delete|remove|archive|cancel|was|has|been)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const words = cleaned.split(/\s+/g).filter(Boolean);
  if (words.length === 0) return null;
  const selected =
    side === "head"
      ? words.slice(0, tokenCount)
      : words.slice(Math.max(0, words.length - tokenCount));
  return normalizeWorkflowTargetLabel(selected.join(" "), {
    allowShort: tokenCount <= 1 || allowGenericObjectShortTarget,
  });
}

function isBrowserManagementWorkflowRequest(value: string): boolean {
  return (
    /\b(?:tab|tabs|window|windows|browser)\b/i.test(value) &&
    /\b(?:close|closed|switch|open|re[-\s]?open|activate|focus|navigate)\b/i.test(
      value,
    )
  );
}

function isModalDismissalWorkflowRequest(value: string): boolean {
  return (
    /\b(?:modal|dialog|popup|pop-up|overlay|banner|toast|notice|alert)\b/i.test(
      value,
    ) &&
    /\b(?:dismiss|dismissed|close|closed|cancel|canceled|cancelled|hide|hidden|remove|removed|clear|cleared)\b/i.test(
      value,
    )
  );
}

function isDismissalPartOfLargerTask(value: string): boolean {
  const text = normalizeText(value);
  if (
    !/\b(?:dismiss|close|cancel|hide|remove|clear)\b/i.test(text) ||
    !/\b(?:and|then|after that|next|,)\b/i.test(text)
  ) {
    return false;
  }

  return /\b(?:and|then|after that|next|,)\s+(?:also\s+)?(?:fill|type|enter|select|choose|submit|send|post|delete|save|update|approve|reject|navigate|visit|go to|create|order|purchase|checkout|read|search|find)\b/i.test(
    text,
  );
}

function isCompleteWorkflowRequest(value: string): boolean {
  const text = normalizeText(value);
  return (
    /\b(?:mark(?:ed)?|set)\b.{0,40}\bcomplete(?:d)?\b/i.test(text) ||
    /\bcomplete(?:d)?\s+(?:the\s+)?(?:task|item|record|request|ticket|todo|to-do)\b/i.test(
      text,
    )
  );
}

function summaryConfirmsWorkflowAction(
  summary: string,
  action: WorkflowConfirmationAction,
): boolean {
  return textConfirmsWorkflowAction(summary, action, "summary");
}

function textConfirmsWorkflowAction(
  value: string,
  action: WorkflowConfirmationAction,
  mode: WorkflowConfirmationTextMode,
): boolean {
  const text = normalizeText(value);
  if (workflowActionTextIsNegated(text, action)) return false;

  switch (action) {
    case "delete":
      if (mode === "visible") {
        return (
          /\b(?:deleted|removed)\s+successfully\b/i.test(text) ||
          /\b(?:deletion|removal)\s+(?:complete|completed|confirmed|successful)\b/i.test(
            text,
          ) ||
          /\b(?:delete|remove)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:deleted|removed|deletion|removal|delete complete|delete completed|delete successful|remove complete|remove completed|remove successful)\b/i.test(
        text,
      );
    case "archive":
      if (mode === "visible") {
        return (
          /\barchived\s+successfully\b/i.test(text) ||
          /\barchival\s+(?:complete|completed|confirmed|successful)\b/i.test(
            text,
          ) ||
          /\barchive\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:archived|archival|archive complete|archive completed|archive successful)\b/i.test(
        text,
      );
    case "save":
      if (mode === "visible") {
        return (
          /\b(?:saved|changes saved)\s+successfully\b/i.test(text) ||
          /\bsuccessfully\s+saved\b/i.test(text) ||
          /\bsave\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:saved|save complete|save completed|save successful)\b/i.test(
        text,
      );
    case "send":
      if (mode === "visible") {
        return (
          /\b(?:sent)\s+successfully\b/i.test(text) ||
          /\b(?:message|email|notification)\s+sent\b/i.test(text) ||
          /\bsend\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:sent|send complete|send completed|send successful)\b/i.test(
        text,
      );
    case "export":
      if (mode === "visible") {
        return (
          /\bexported\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|csv|pdf|spreadsheet|data|dataset|results?|table|list|view|logs?)\s+exported\b/i.test(
            text,
          ) ||
          /\bexport\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:exported|export complete|export completed|export successful)\b/i.test(
        text,
      );
    case "download":
      if (mode === "visible") {
        return (
          /\bdownloaded\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|attachment|csv|pdf|spreadsheet|export|data|dataset|results?|invoice|receipt|logs?|archive)\s+downloaded\b/i.test(
            text,
          ) ||
          /\bdownload\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:downloaded|download complete|download completed|download successful)\b/i.test(
        text,
      );
    case "upload":
      if (mode === "visible") {
        return (
          /\buploaded\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|attachment|image|photo|csv|pdf|spreadsheet|data|dataset|results?|logs?|archive)\s+uploaded\b/i.test(
            text,
          ) ||
          /\bupload\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:uploaded|upload complete|upload completed|upload successful)\b/i.test(
        text,
      );
    case "import":
      if (mode === "visible") {
        return (
          /\bimported\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|csv|spreadsheet|data|dataset|results?|table|list|view|contacts?|records?|items?)\s+imported\b/i.test(
            text,
          ) ||
          /\bimport\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:imported|import complete|import completed|import successful)\b/i.test(
        text,
      );
    case "attach":
      if (mode === "visible") {
        return (
          /\battached\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|attachment|image|photo|invoice|receipt|log|logs|record|item|task|ticket|request|entry|row|comment|message|note|account|case|issue)\s+attached\b/i.test(
            text,
          ) ||
          /\battach(?:ment)?\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:attached|attach complete|attach completed|attach successful|attachment complete|attachment completed|attachment successful)\b/i.test(
        text,
      );
    case "detach":
      if (mode === "visible") {
        return (
          /\bdetached\s+successfully\b/i.test(text) ||
          /\b(?:file|report|document|attachment|image|photo|invoice|receipt|log|logs|record|item|task|ticket|request|entry|row|comment|message|note|account|case|issue)\s+detached\b/i.test(
            text,
          ) ||
          /\bdetach(?:ment)?\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:detached|detach complete|detach completed|detach successful|detachment complete|detachment completed|detachment successful)\b/i.test(
        text,
      );
    case "copy":
      if (mode === "visible") {
        return (
          /\bcopied\s+(?:successfully|to\s+clipboard|to\s+the\s+clipboard)\b/i.test(
            text,
          ) ||
          /\b(?:link|url|address|text|code|value|id|identifier|token|key|path|email|phone|file|report|document|message|comment|article|page|record|item|task|ticket|request|entry|row|table|list|view)\s+copied\b/i.test(
            text,
          ) ||
          /\bcopy\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:copied|copy complete|copy completed|copy successful)\b/i.test(
        text,
      );
    case "transfer":
      if (mode === "visible") {
        return (
          /\btransferred\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|workflow|rule|ownership|assignment)\s+transferred\b/i.test(
            text,
          ) ||
          /\btransfer\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:transferred|transfer complete|transfer completed|transfer successful)\b/i.test(
        text,
      );
    case "move":
      if (mode === "visible") {
        return (
          /\bmoved\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|message|comment|thread|conversation|card|column|list|board|workflow|rule)\s+moved\b/i.test(
            text,
          ) ||
          /\bmove\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:moved|move complete|move completed|move successful)\b/i.test(
        text,
      );
    case "rename":
      if (mode === "visible") {
        return (
          /\brenamed\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|folder|document|report|page|message|comment|thread|conversation|card|column|list|board|workflow|rule|profile|workspace)\s+renamed\b/i.test(
            text,
          ) ||
          /\brename\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:renamed|rename complete|rename completed|rename successful)\b/i.test(
        text,
      );
    case "merge":
      if (mode === "visible") {
        return (
          /\bmerged\s+successfully\b/i.test(text) ||
          /\b(?:pull\s+request|merge\s+request|pr|branch|record|item|task|ticket|request|entry|row|case|issue|incident|lead|contact|account|customer|project|file|document|report|page|message|comment|thread|conversation|workspace)\s+merged\b/i.test(
            text,
          ) ||
          /\bmerge\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:merged|merge complete|merge completed|merge successful)\b/i.test(
        text,
      );
    case "schedule":
      if (mode === "visible") {
        return (
          /\bscheduled\s+successfully\b/i.test(text) ||
          /\b(?:report|dashboard|job|task|ticket|request|entry|row|case|issue|incident|project|workflow|rule|automation|process|pipeline|message|email|notification|reminder|meeting|event|appointment|sync|backup|export|import|deployment|release)\s+scheduled\b/i.test(
            text,
          ) ||
          /\bschedule\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:scheduled|schedule complete|schedule completed|schedule successful)\b/i.test(
        text,
      );
    case "unschedule":
      if (mode === "visible") {
        return (
          /\bunscheduled\s+successfully\b/i.test(text) ||
          /\b(?:report|dashboard|job|task|ticket|request|entry|row|case|issue|incident|project|workflow|rule|automation|process|pipeline|message|email|notification|reminder|meeting|event|appointment|sync|backup|export|import|deployment|release)\s+unscheduled\b/i.test(
            text,
          ) ||
          /\bunschedule\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unscheduled|unschedule complete|unschedule completed|unschedule successful)\b/i.test(
        text,
      );
    case "deploy":
      if (mode === "visible") {
        return (
          /\bdeployed\s+successfully\b/i.test(text) ||
          /\b(?:app|application|service|site|release|build|version|environment|deployment|package|workflow|pipeline|branch|changes?)\s+deployed\b/i.test(
            text,
          ) ||
          /\bdeploy(?:ment)?\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:deployed|deploy complete|deploy completed|deploy successful|deployment complete|deployment completed|deployment successful)\b/i.test(
        text,
      );
    case "rollback":
      if (mode === "visible") {
        return (
          /\b(?:rolled\s+back|reverted)\s+successfully\b/i.test(text) ||
          /\b(?:app|application|service|site|release|build|version|environment|deployment|package|workflow|pipeline|branch|changes?)\s+(?:rolled\s+back|reverted)\b/i.test(
            text,
          ) ||
          /\b(?:rollback|roll\s+back|reversion)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:rolled\s+back|reverted|rollback complete|rollback completed|rollback successful|roll back complete|roll back completed|roll back successful|reversion complete|reversion completed|reversion successful)\b/i.test(
        text,
      );
    case "backup":
      if (mode === "visible") {
        return (
          /\bbacked\s+up\s+successfully\b/i.test(text) ||
          /\b(?:database|data|dataset|file|files|folder|folders|document|documents|record|records|settings|config|configuration|workspace|project|repository|repo|site|app|application|service|server|environment|system|account|profile|export|archive|backup)\s+backed\s+up\b/i.test(
            text,
          ) ||
          /\bbackup\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:backed\s+up|backup complete|backup completed|backup successful|back up complete|back up completed|back up successful)\b/i.test(
        text,
      );
    case "reset":
      if (mode === "visible") {
        return (
          /\breset\s+successfully\b/i.test(text) ||
          /\b(?:password|passcode|pin|mfa|2fa|credential|credentials|token|key|secret|settings?|config|configuration|preferences?|cache|session|account|profile|device|app|application|service|workflow|rule|job|pipeline|database|data|dataset|form|filters?|view|dashboard|report)(?:\s+[\w-]+){0,6}\s+reset\b/i.test(
            text,
          ) ||
          /\breset\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:reset|reset complete|reset completed|reset successful)\b/i.test(
        text,
      );
    case "suspend":
      if (mode === "visible") {
        return (
          /\bsuspended\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|service|subscription|plan|workspace|project|workflow|rule|job|pipeline|task|ticket|request|record|item|case|issue|incident|access|license|licence)(?:\s+[\w-]+){0,6}\s+suspended\b/i.test(
            text,
          ) ||
          /\b(?:suspend|suspension)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:suspended|suspension|suspend complete|suspend completed|suspend successful|suspension complete|suspension completed|suspension successful)\b/i.test(
        text,
      );
    case "unsuspend":
      if (mode === "visible") {
        return (
          /\bunsuspended\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|service|subscription|plan|workspace|project|workflow|rule|job|pipeline|task|ticket|request|record|item|case|issue|incident|access|license|licence)(?:\s+[\w-]+){0,6}\s+unsuspended\b/i.test(
            text,
          ) ||
          /\b(?:unsuspend|unsuspension)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:unsuspended|unsuspension|unsuspend complete|unsuspend completed|unsuspend successful|unsuspension complete|unsuspension completed|unsuspension successful)\b/i.test(
        text,
      );
    case "block":
      if (mode === "visible") {
        return (
          /\bblocked\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|contact|sender|email|domain|ip|address|device|app|application|service|site|url|workspace|project|task|ticket|request|record|item|case|issue|incident|access|license|licence)(?:\s+[\w-]+){0,6}\s+blocked\b/i.test(
            text,
          ) ||
          /\b(?:block|blocking)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:blocked|blocking|block complete|block completed|block successful|blocking complete|blocking completed|blocking successful)\b/i.test(
        text,
      );
    case "unblock":
      if (mode === "visible") {
        return (
          /\bunblocked\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|contact|sender|email|domain|ip|address|device|app|application|service|site|url|workspace|project|task|ticket|request|record|item|case|issue|incident|access|license|licence)(?:\s+[\w-]+){0,6}\s+unblocked\b/i.test(
            text,
          ) ||
          /\b(?:unblock|unblocking)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:unblocked|unblocking|unblock complete|unblock completed|unblock successful|unblocking complete|unblocking completed|unblocking successful)\b/i.test(
        text,
      );
    case "link":
      if (mode === "visible") {
        return (
          /\blinked\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|contact|record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|workflow|rule|integration|connector|service|app|application|device|domain|url)(?:\s+[\w-]+){0,6}\s+linked\b/i.test(
            text,
          ) ||
          /\b(?:link|linking)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:linked|linking|link complete|link completed|link successful|linking complete|linking completed|linking successful)\b/i.test(
        text,
      );
    case "unlink":
      if (mode === "visible") {
        return (
          /\bunlinked\s+successfully\b/i.test(text) ||
          /\b(?:account|profile|user|member|person|customer|client|contact|record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|workflow|rule|integration|connector|service|app|application|device|domain|url)(?:\s+[\w-]+){0,6}\s+unlinked\b/i.test(
            text,
          ) ||
          /\b(?:unlink|unlinking)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:unlinked|unlinking|unlink complete|unlink completed|unlink successful|unlinking complete|unlinking completed|unlinking successful)\b/i.test(
        text,
      );
    case "tag":
      if (mode === "visible") {
        return (
          /\btagged\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|user|member|profile)(?:\s+[\w-]+){0,6}\s+tagged\b/i.test(
            text,
          ) ||
          /\b(?:tag|tagging)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:tagged|tagging|tag complete|tag completed|tag successful|tagging complete|tagging completed|tagging successful)\b/i.test(
        text,
      );
    case "untag":
      if (mode === "visible") {
        return (
          /\buntagged\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|user|member|profile)(?:\s+[\w-]+){0,6}\s+untagged\b/i.test(
            text,
          ) ||
          /\b(?:untag|untagging)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:untagged|untagging|untag complete|untag completed|untag successful|untagging complete|untagging completed|untagging successful)\b/i.test(
        text,
      );
    case "flag":
      if (mode === "visible") {
        return (
          /\bflagged\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|email|user|member|profile)(?:\s+[\w-]+){0,6}\s+flagged\b/i.test(
            text,
          ) ||
          /\b(?:flag|flagging)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:flagged|flagging|flag complete|flag completed|flag successful|flagging complete|flagging completed|flagging successful)\b/i.test(
        text,
      );
    case "unflag":
      if (mode === "visible") {
        return (
          /\bunflagged\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|case|issue|incident|lead|opportunity|account|contact|customer|project|workspace|repository|repo|branch|file|folder|document|page|report|dashboard|view|list|message|comment|thread|conversation|article|post|email|user|member|profile)(?:\s+[\w-]+){0,6}\s+unflagged\b/i.test(
            text,
          ) ||
          /\b(?:unflag|unflagging)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:unflagged|unflagging|unflag complete|unflag completed|unflag successful|unflagging complete|unflagging completed|unflagging successful)\b/i.test(
        text,
      );
    case "duplicate":
      if (mode === "visible") {
        return (
          /\b(?:duplicated|cloned)\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile)\s+(?:duplicated|cloned)\b/i.test(
            text,
          ) ||
          /\b(?:duplicate|clone)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:duplicated|cloned|duplicate complete|duplicate completed|duplicate successful|clone complete|clone completed|clone successful)\b/i.test(
        text,
      );
    case "restore":
      if (mode === "visible") {
        return (
          /\b(?:restored|recovered|reinstated)\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|archive|version|backup)\s+(?:restored|recovered|reinstated)\b/i.test(
            text,
          ) ||
          /\b(?:restore|restoration|recover|recovery|reinstate|reinstatement)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:restored|recovered|reinstated|restore complete|restore completed|restore successful|restoration complete|restoration completed|restoration successful|recover complete|recover completed|recover successful|recovery complete|recovery completed|recovery successful|reinstate complete|reinstate completed|reinstate successful|reinstatement complete|reinstatement completed|reinstatement successful)\b/i.test(
        text,
      );
    case "create":
      if (mode === "visible") {
        return (
          /\b(?:created|added|registered)\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|order|case|issue|incident|project|contact|customer)\s+(?:created|added|registered)\b/i.test(
            text,
          ) ||
          /\b(?:create|creation|add|registration|register)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:created|added|registered|create complete|create completed|create successful|creation complete|creation completed|creation successful|add complete|add completed|add successful|registration complete|registration completed|registration successful|register complete|register completed|register successful)\b/i.test(
        text,
      );
    case "share":
      if (mode === "visible") {
        return (
          /\bshared\s+successfully\b/i.test(text) ||
          /\b(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|folder|workflow|rule|dashboard|view|list|policy|profile|link|board|project|invoice|receipt)\s+shared\b/i.test(
            text,
          ) ||
          /\bshar(?:e|ing)\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:shared|share complete|share completed|share successful|sharing complete|sharing completed|sharing successful)\b/i.test(
        text,
      );
    case "grant":
      if (mode === "visible") {
        return (
          /\bgranted\s+successfully\b/i.test(text) ||
          /\b(?:access|permission|permissions?|privilege|privileges?|role|roles?|license|licence|licenses|licences|entitlement|entitlements?|membership|admin|administrator|viewer|editor|owner)\s+granted\b/i.test(
            text,
          ) ||
          /\b(?:grant|access|permission)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:granted|grant complete|grant completed|grant successful|access granted|access complete|access completed|access successful|permission granted|permission complete|permission completed|permission successful)\b/i.test(
        text,
      );
    case "revoke":
      if (mode === "visible") {
        return (
          /\brevoked\s+successfully\b/i.test(text) ||
          /\b(?:access|permission|permissions?|privilege|privileges?|role|roles?|license|licence|licenses|licences|entitlement|entitlements?|membership|admin|administrator|viewer|editor|owner)\s+revoked\b/i.test(
            text,
          ) ||
          /\b(?:revoke|revocation|access|permission)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:revoked|revoke complete|revoke completed|revoke successful|revocation complete|revocation completed|revocation successful|access revoked|permission revoked)\b/i.test(
        text,
      );
    case "install":
      if (mode === "visible") {
        return (
          /\binstalled\s+successfully\b/i.test(text) ||
          /\b(?:app|application|extension|plugin|package|module|integration|connector|driver|dependency|tool|theme|add[-\s]?on|update|workflow|rule)\s+installed\b/i.test(
            text,
          ) ||
          /\binstallation\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:installed|install complete|install completed|install successful|installation complete|installation completed|installation successful)\b/i.test(
        text,
      );
    case "uninstall":
      if (mode === "visible") {
        return (
          /\buninstalled\s+successfully\b/i.test(text) ||
          /\b(?:app|application|extension|plugin|package|module|integration|connector|driver|dependency|tool|theme|add[-\s]?on|update|workflow|rule)\s+uninstalled\b/i.test(
            text,
          ) ||
          /\buninstallation\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:uninstalled|uninstall complete|uninstall completed|uninstall successful|uninstallation complete|uninstallation completed|uninstallation successful)\b/i.test(
        text,
      );
    case "connect":
      if (mode === "visible") {
        return (
          /\bconnected\s+successfully\b/i.test(text) ||
          /\b(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection)\s+connected\b/i.test(
            text,
          ) ||
          /\bconnect(?:ion)?\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:connected|connect complete|connect completed|connect successful|connection complete|connection completed|connection successful)\b/i.test(
        text,
      );
    case "disconnect":
      if (mode === "visible") {
        return (
          /\bdisconnected\s+successfully\b/i.test(text) ||
          /\b(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection)\s+disconnected\b/i.test(
            text,
          ) ||
          /\bdisconnect(?:ion)?\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:disconnected|disconnect complete|disconnect completed|disconnect successful|disconnection complete|disconnection completed|disconnection successful)\b/i.test(
        text,
      );
    case "sync":
      if (mode === "visible") {
        return (
          /\b(?:synced|resynced|synchroni[sz]ed)\s+successfully\b/i.test(
            text,
          ) ||
          /\b(?:account|app|application|integration|connector|service|provider|source|data\s+source|database|endpoint|api|server|device|repository|repo|workspace|project|channel|feed|webhook|connection|calendar|contacts?|files?|folders?|documents?|settings|config|configuration|backup|workflow|rule|job|pipeline|queue)\s+(?:synced|resynced|synchroni[sz]ed)\b/i.test(
            text,
          ) ||
          /\b(?:sync|resync|synchronization|synchronisation)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:synced|resynced|synchroni[sz]ed|sync complete|sync completed|sync successful|resync complete|resync completed|resync successful|synchronization complete|synchronization completed|synchronization successful|synchronisation complete|synchronisation completed|synchronisation successful)\b/i.test(
        text,
      );
    case "invite":
      if (mode === "visible") {
        return (
          /\binvited\s+successfully\b/i.test(text) ||
          /\b(?:user|member|person|contact|customer|client|guest|reviewer|approver|editor|viewer|admin|administrator|collaborator|teammate|team|group)\s+invited\b/i.test(
            text,
          ) ||
          /\binvitation\s+(?:complete|completed|successful|sent)\b/i.test(text)
        );
      }
      return /\b(?:invited|invite complete|invite completed|invite successful|invitation complete|invitation completed|invitation successful|invitation sent)\b/i.test(
        text,
      );
    case "subscribe":
      if (mode === "visible") {
        return (
          /\bsubscribed\s+successfully\b/i.test(text) ||
          /\b(?:channel|topic|list|newsletter|report|dashboard|board|project|queue|feed|service|plan|notification|notifications?|updates?|digest|subscription)\s+subscribed\b/i.test(
            text,
          ) ||
          /\bsubscription\s+(?:complete|completed|successful|active)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:subscribed|subscribe complete|subscribe completed|subscribe successful|subscription complete|subscription completed|subscription successful|subscription active)\b/i.test(
        text,
      );
    case "unsubscribe":
      if (mode === "visible") {
        return (
          /\bunsubscribed\s+successfully\b/i.test(text) ||
          /\b(?:channel|topic|list|newsletter|report|dashboard|board|project|queue|feed|service|plan|notification|notifications?|updates?|digest|subscription)\s+unsubscribed\b/i.test(
            text,
          ) ||
          /\bunsubscription\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unsubscribed|unsubscribe complete|unsubscribe completed|unsubscribe successful|unsubscription complete|unsubscription completed|unsubscription successful)\b/i.test(
        text,
      );
    case "pin":
      if (mode === "visible") {
        return (
          /\bpinned\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic)\s+pinned\b/i.test(
            text,
          ) ||
          /\bpin\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:pinned|pin complete|pin completed|pin successful)\b/i.test(
        text,
      );
    case "unpin":
      if (mode === "visible") {
        return (
          /\bunpinned\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic)\s+unpinned\b/i.test(
            text,
          ) ||
          /\bunpin\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unpinned|unpin complete|unpin completed|unpin successful)\b/i.test(
        text,
      );
    case "mute":
      if (mode === "visible") {
        return (
          /\bmuted\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|user|member|contact|notification|notifications?|alert|alerts?)\s+muted\b/i.test(
            text,
          ) ||
          /\bmute\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:muted|mute complete|mute completed|mute successful)\b/i.test(
        text,
      );
    case "unmute":
      if (mode === "visible") {
        return (
          /\bunmuted\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|user|member|contact|notification|notifications?|alert|alerts?)\s+unmuted\b/i.test(
            text,
          ) ||
          /\bunmute\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unmuted|unmute complete|unmute completed|unmute successful)\b/i.test(
        text,
      );
    case "follow":
      if (mode === "visible") {
        return (
          /\bfollowed\s+successfully\b/i.test(text) ||
          /\b(?:user|member|contact|account|profile|channel|topic|thread|conversation|project|board|list|report|dashboard|page|feed|newsletter|tag|repository|repo)\s+followed\b/i.test(
            text,
          ) ||
          /\bfollow\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:followed|follow complete|follow completed|follow successful)\b/i.test(
        text,
      );
    case "unfollow":
      if (mode === "visible") {
        return (
          /\bunfollowed\s+successfully\b/i.test(text) ||
          /\b(?:user|member|contact|account|profile|channel|topic|thread|conversation|project|board|list|report|dashboard|page|feed|newsletter|tag|repository|repo)\s+unfollowed\b/i.test(
            text,
          ) ||
          /\bunfollow\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unfollowed|unfollow complete|unfollow completed|unfollow successful)\b/i.test(
        text,
      );
    case "bookmark":
      if (mode === "visible") {
        return (
          /\bbookmarked\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site)\s+bookmarked\b/i.test(
            text,
          ) ||
          /\bbookmark\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:bookmarked|bookmark complete|bookmark completed|bookmark successful)\b/i.test(
        text,
      );
    case "unbookmark":
      if (mode === "visible") {
        return (
          /\bunbookmarked\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site)\s+unbookmarked\b/i.test(
            text,
          ) ||
          /\bunbookmark\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unbookmarked|unbookmark complete|unbookmark completed|unbookmark successful)\b/i.test(
        text,
      );
    case "favorite":
      if (mode === "visible") {
        return (
          /\bfavorited\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site|user|member|contact|account|profile|repository|repo)\s+favorited\b/i.test(
            text,
          ) ||
          /\bfavorite\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:favorited|favorite complete|favorite completed|favorite successful)\b/i.test(
        text,
      );
    case "unfavorite":
      if (mode === "visible") {
        return (
          /\bunfavorited\s+successfully\b/i.test(text) ||
          /\b(?:item|record|task|ticket|request|entry|row|report|dashboard|view|list|board|project|page|document|file|folder|message|comment|thread|conversation|channel|topic|article|link|url|site|user|member|contact|account|profile|repository|repo)\s+unfavorited\b/i.test(
            text,
          ) ||
          /\bunfavorite\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unfavorited|unfavorite complete|unfavorite completed|unfavorite successful)\b/i.test(
        text,
      );
    case "watch":
      if (mode === "visible") {
        return (
          /\bwatched\s+successfully\b/i.test(text) ||
          /\b(?:repository|repo|project|board|list|report|dashboard|page|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|queue|service|job|pipeline|workflow|record|item)\s+watched\b/i.test(
            text,
          ) ||
          /\bwatch\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:watched|watch complete|watch completed|watch successful)\b/i.test(
        text,
      );
    case "unwatch":
      if (mode === "visible") {
        return (
          /\bunwatched\s+successfully\b/i.test(text) ||
          /\b(?:repository|repo|project|board|list|report|dashboard|page|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|queue|service|job|pipeline|workflow|record|item)\s+unwatched\b/i.test(
            text,
          ) ||
          /\bunwatch\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unwatched|unwatch complete|unwatch completed|unwatch successful)\b/i.test(
        text,
      );
    case "star":
      if (mode === "visible") {
        return (
          /\bstarred\s+successfully\b/i.test(text) ||
          /\b(?:repository|repo|project|board|list|report|dashboard|page|document|file|folder|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|record|item|message|comment|article|link|site|user|member|contact|profile)\s+starred\b/i.test(
            text,
          ) ||
          /\bstar\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:starred|star complete|star completed|star successful)\b/i.test(
        text,
      );
    case "unstar":
      if (mode === "visible") {
        return (
          /\bunstarred\s+successfully\b/i.test(text) ||
          /\b(?:repository|repo|project|board|list|report|dashboard|page|document|file|folder|feed|newsletter|tag|channel|topic|thread|conversation|issue|ticket|request|record|item|message|comment|article|link|site|user|member|contact|profile)\s+unstarred\b/i.test(
            text,
          ) ||
          /\bunstar\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unstarred|unstar complete|unstar completed|unstar successful)\b/i.test(
        text,
      );
    case "post":
      if (mode === "visible") {
        return (
          /\b(?:posted|published)\s+successfully\b/i.test(text) ||
          /\b(?:comment|reply|post)\s+posted\b/i.test(text) ||
          /\b(?:post|publish)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:posted|published|post complete|post completed|post successful|publish complete|publish completed|publish successful)\b/i.test(
        text,
      );
    case "approve":
      if (mode === "visible") {
        return (
          /\bapproved\s+successfully\b/i.test(text) ||
          /\bapproval\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:approved|approval complete|approval completed|approval successful)\b/i.test(
        text,
      );
    case "reject":
      if (mode === "visible") {
        return (
          /\b(?:rejected|denied)\s+successfully\b/i.test(text) ||
          /\brejection\s+(?:complete|completed|successful)\b/i.test(text) ||
          /\bdenial\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:rejected|rejection complete|rejection completed|rejection successful|denied|denial complete|denial completed|denial successful)\b/i.test(
        text,
      );
    case "close":
      if (mode === "visible") {
        return (
          /\b(?:closed|resolved)\s+successfully\b/i.test(text) ||
          /\bresolution\s+(?:complete|completed|successful)\b/i.test(text) ||
          /\b(?:close|closure)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:closed|resolved|close complete|close completed|close successful|closure complete|closure completed|closure successful)\b/i.test(
        text,
      );
    case "reopen":
      if (mode === "visible") {
        return (
          /\bre[-\s]?opened\s+successfully\b/i.test(text) ||
          /\bre[-\s]?open\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:re[-\s]?opened|re[-\s]?open complete|re[-\s]?open completed|re[-\s]?open successful)\b/i.test(
        text,
      );
    case "cancel":
      if (mode === "visible") {
        return (
          /\bcancell?ed\s+successfully\b/i.test(text) ||
          /\bcancel(?:lation)?\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:cancell?ed|cancel complete|cancel completed|cancel successful|cancellation complete|cancellation completed|cancellation successful)\b/i.test(
        text,
      );
    case "enable":
      if (mode === "visible") {
        return (
          /\b(?:enabled|activated)\s+successfully\b/i.test(text) ||
          /\b(?:enable|activation)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:enabled|activated|enable complete|enable completed|enable successful|activation complete|activation completed|activation successful)\b/i.test(
        text,
      );
    case "disable":
      if (mode === "visible") {
        return (
          /\b(?:disabled|deactivated)\s+successfully\b/i.test(text) ||
          /\b(?:disable|deactivation)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:disabled|deactivated|disable complete|disable completed|disable successful|deactivation complete|deactivation completed|deactivation successful)\b/i.test(
        text,
      );
    case "assign":
      if (mode === "visible") {
        return (
          /\bassigned\s+successfully\b/i.test(text) ||
          /\bassignment\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:assigned|assignment complete|assignment completed|assignment successful)\b/i.test(
        text,
      );
    case "unassign":
      if (mode === "visible") {
        return (
          /\bunassigned\s+successfully\b/i.test(text) ||
          /\bunassign\s+(?:complete|completed|successful)\b/i.test(text) ||
          /\bassignee\s+(?:cleared|removed)\b/i.test(text)
        );
      }
      return /\b(?:unassigned|unassign complete|unassign completed|unassign successful|assignee cleared|assignee removed)\b/i.test(
        text,
      );
    case "escalate":
      if (mode === "visible") {
        return (
          /\bescalated\s+successfully\b/i.test(text) ||
          /\bescalat(?:e|ion)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:escalated|escalate complete|escalate completed|escalate successful|escalation complete|escalation completed|escalation successful)\b/i.test(
        text,
      );
    case "deescalate":
      if (mode === "visible") {
        return (
          /\bde[-\s]?escalated\s+successfully\b/i.test(text) ||
          /\bde[-\s]?escalat(?:e|ion)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:de[-\s]?escalated|de[-\s]?escalate complete|de[-\s]?escalate completed|de[-\s]?escalate successful|de[-\s]?escalation complete|de[-\s]?escalation completed|de[-\s]?escalation successful)\b/i.test(
        text,
      );
    case "lock":
      if (mode === "visible") {
        return (
          /\blocked\s+successfully\b/i.test(text) ||
          /\block\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:locked|lock complete|lock completed|lock successful)\b/i.test(
        text,
      );
    case "unlock":
      if (mode === "visible") {
        return (
          /\bunlocked\s+successfully\b/i.test(text) ||
          /\bunlock\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:unlocked|unlock complete|unlock completed|unlock successful)\b/i.test(
        text,
      );
    case "pause":
      if (mode === "visible") {
        return (
          /\bpaused\s+successfully\b/i.test(text) ||
          /\bpause\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:paused|pause complete|pause completed|pause successful)\b/i.test(
        text,
      );
    case "resume":
      if (mode === "visible") {
        return (
          /\bresumed\s+successfully\b/i.test(text) ||
          /\bresume\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:resumed|resume complete|resume completed|resume successful)\b/i.test(
        text,
      );
    case "start":
      if (mode === "visible") {
        return (
          /\bstarted\s+successfully\b/i.test(text) ||
          /\bstart\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:started|running|active|start complete|start completed|start successful)\b/i.test(
        text,
      );
    case "stop":
      if (mode === "visible") {
        return (
          /\bstopped\s+successfully\b/i.test(text) ||
          /\bstop\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:stopped|inactive|stop complete|stop completed|stop successful)\b/i.test(
        text,
      );
    case "restart":
      if (mode === "visible") {
        return (
          /\brestarted\s+successfully\b/i.test(text) ||
          /\brestart\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:restarted|restart complete|restart completed|restart successful)\b/i.test(
        text,
      );
    case "refresh":
      if (mode === "visible") {
        return (
          /\brefreshed\s+successfully\b/i.test(text) ||
          /\brefresh\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:refreshed|refresh complete|refresh completed|refresh successful)\b/i.test(
        text,
      );
    case "dismiss":
      if (mode === "visible") {
        return (
          /\b(?:dismissed|hidden|cleared)\s+successfully\b/i.test(text) ||
          /\b(?:dismiss|dismissal|hide|clear)\s+(?:complete|completed|successful)\b/i.test(
            text,
          )
        );
      }
      return /\b(?:dismissed|closed|canceled|cancelled|removed|hidden|cleared|dismiss complete|dismiss completed|dismiss successful|dismissal complete|dismissal completed|dismissal successful|hide complete|hide completed|hide successful|clear complete|clear completed|clear successful)\b/i.test(
        text,
      );
    case "update":
      if (mode === "visible") {
        return (
          /\b(?:updated|changed|applied)\s+successfully\b/i.test(text) ||
          /\b(?:changes|settings)\s+(?:updated|applied)\b/i.test(text) ||
          /\bupdate\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:updated|changed|applied|update complete|update completed|update successful)\b/i.test(
        text,
      );
    case "submit":
      if (mode === "visible") {
        return (
          /\bsubmitted\s+successfully\b/i.test(text) ||
          /\bsuccessfully\s+submitted\b/i.test(text) ||
          /\bsubmission\s+(?:complete|completed|successful)\b/i.test(text) ||
          /\bsubmit\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return /\b(?:submitted|submission|submit complete|submit completed|submit successful)\b/i.test(
        text,
      );
    case "complete":
      if (mode === "visible") {
        return (
          /\bmark(?:ed)?\b.{0,40}\bcomplete(?:d)?\b/i.test(text) ||
          /\bcompleted\s+successfully\b/i.test(text) ||
          /\b(?:task|item|record|request|ticket|todo|to-do)\s+completed\b/i.test(
            text,
          ) ||
          /\bcompletion\s+(?:complete|completed|successful)\b/i.test(text)
        );
      }
      return (
        /\bmark(?:ed)?\b.{0,40}\bcomplete(?:d)?\b/i.test(text) ||
        /\b(?:completed|completion complete|completion completed|completion successful)\b/i.test(
          text,
        )
      );
  }
  return false;
}

function workflowActionTextIsNegated(
  text: string,
  action: WorkflowConfirmationAction,
): boolean {
  const actionTerms = workflowActionTermPattern(action);
  const noAction = new RegExp(
    `\\bno\\s+(?:successful\\s+)?${actionTerms}\\b`,
  );
  if (noAction.test(text)) return true;

  const negationBeforeAction = new RegExp(
    `\\b(?:not|never|failed\\s+to|fails?\\s+to|did\\s+not|didn't|does\\s+not|doesn't|was\\s+not|wasn't|is\\s+not|isn't|has\\s+not|hasn't|have\\s+not|haven't|cannot|can't|could\\s+not|couldn't|unable\\s+to)\\b.{0,60}\\b${actionTerms}\\b`,
  );
  if (negationBeforeAction.test(text)) return true;

  const failureAfterAction = new RegExp(
    `\\b${actionTerms}\\b.{0,60}\\b(?:failed|unsuccessful|not\\s+successful|did\\s+not\\s+complete|didn't\\s+complete|was\\s+not\\s+completed|wasn't\\s+completed|could\\s+not\\s+complete|couldn't\\s+complete)\\b`,
  );
  return failureAfterAction.test(text);
}

function workflowActionTermPattern(action: WorkflowConfirmationAction): string {
  switch (action) {
    case "delete":
      return "(?:deleted|removed|deletion|removal|delete|remove)";
    case "archive":
      return "(?:archived|archival|archive)";
    case "save":
      return "(?:saved|save)";
    case "send":
      return "(?:sent|send)";
    case "export":
      return "(?:exported|export)";
    case "download":
      return "(?:downloaded|download)";
    case "upload":
      return "(?:uploaded|upload)";
    case "import":
      return "(?:imported|import)";
    case "attach":
      return "(?:attached|attach|attachment)";
    case "detach":
      return "(?:detached|detach|detachment)";
    case "copy":
      return "(?:copied|copy)";
    case "transfer":
      return "(?:transferred|transfer)";
    case "move":
      return "(?:moved|move)";
    case "rename":
      return "(?:renamed|rename)";
    case "merge":
      return "(?:merged|merge)";
    case "schedule":
      return "(?:scheduled|schedule)";
    case "unschedule":
      return "(?:unscheduled|unschedule)";
    case "deploy":
      return "(?:deployed|deploy|deployment)";
    case "rollback":
      return "(?:rolled\\s+back|reverted|rollback|roll\\s+back|reversion)";
    case "backup":
      return "(?:backed\\s+up|backup|back\\s+up)";
    case "reset":
      return "(?:reset)";
    case "suspend":
      return "(?:suspended|suspension|suspend)";
    case "unsuspend":
      return "(?:unsuspended|unsuspension|unsuspend)";
    case "block":
      return "(?:blocked|blocking|block)";
    case "unblock":
      return "(?:unblocked|unblocking|unblock)";
    case "link":
      return "(?:linked|linking|link)";
    case "unlink":
      return "(?:unlinked|unlinking|unlink)";
    case "tag":
      return "(?:tagged|tagging|tag)";
    case "untag":
      return "(?:untagged|untagging|untag)";
    case "flag":
      return "(?:flagged|flagging|flag)";
    case "unflag":
      return "(?:unflagged|unflagging|unflag)";
    case "duplicate":
      return "(?:duplicated|cloned|duplicate|duplication|clone)";
    case "restore":
      return "(?:restored|recovered|reinstated|restore|restoration|recover|recovery|reinstate|reinstatement)";
    case "create":
      return "(?:created|added|registered|create|creation|add|registration|register)";
    case "share":
      return "(?:shared|share|sharing)";
    case "grant":
      return "(?:granted|grant|access|permission)";
    case "revoke":
      return "(?:revoked|revoke|revocation)";
    case "install":
      return "(?:installed|install|installation)";
    case "uninstall":
      return "(?:uninstalled|uninstall|uninstallation)";
    case "connect":
      return "(?:connected|connect|connection)";
    case "disconnect":
      return "(?:disconnected|disconnect|disconnection)";
    case "sync":
      return "(?:synced|resynced|synchroni[sz]ed|sync|resync|synchronization|synchronisation)";
    case "invite":
      return "(?:invited|invite|invitation)";
    case "subscribe":
      return "(?:subscribed|subscribe|subscription)";
    case "unsubscribe":
      return "(?:unsubscribed|unsubscribe|unsubscription)";
    case "pin":
      return "(?:pinned|pin)";
    case "unpin":
      return "(?:unpinned|unpin)";
    case "mute":
      return "(?:muted|mute)";
    case "unmute":
      return "(?:unmuted|unmute)";
    case "follow":
      return "(?:followed|follow)";
    case "unfollow":
      return "(?:unfollowed|unfollow)";
    case "bookmark":
      return "(?:bookmarked|bookmark)";
    case "unbookmark":
      return "(?:unbookmarked|unbookmark)";
    case "favorite":
      return "(?:favorited|favorite)";
    case "unfavorite":
      return "(?:unfavorited|unfavorite)";
    case "watch":
      return "(?:watched|watch)";
    case "unwatch":
      return "(?:unwatched|unwatch)";
    case "star":
      return "(?:starred|star)";
    case "unstar":
      return "(?:unstarred|unstar)";
    case "post":
      return "(?:posted|published|post|publish)";
    case "approve":
      return "(?:approved|approval|approve)";
    case "reject":
      return "(?:rejected|denied|rejection|denial|reject|deny)";
    case "close":
      return "(?:closed|resolved|closure|resolution|close|resolve)";
    case "reopen":
      return "(?:re[-\\s]?opened|re[-\\s]?open)";
    case "cancel":
      return "(?:cancell?ed|cancellation|cancel)";
    case "enable":
      return "(?:enabled|activated|activation|enable|activate)";
    case "disable":
      return "(?:disabled|deactivated|deactivation|disable|deactivate)";
    case "assign":
      return "(?:assigned|assignment|assign)";
    case "unassign":
      return "(?:unassigned|unassign|assignee\\s+cleared|assignee\\s+removed)";
    case "escalate":
      return "(?:escalated|escalation|escalate)";
    case "deescalate":
      return "(?:de[-\\s]?escalated|de[-\\s]?escalation|de[-\\s]?escalate)";
    case "lock":
      return "(?:locked|lock)";
    case "unlock":
      return "(?:unlocked|unlock)";
    case "pause":
      return "(?:paused|pause)";
    case "resume":
      return "(?:resumed|resume)";
    case "start":
      return "(?:started|start|running|active)";
    case "stop":
      return "(?:stopped|stop|inactive)";
    case "restart":
      return "(?:restarted|restart)";
    case "refresh":
      return "(?:refreshed|refresh)";
    case "dismiss":
      return "(?:dismissed|closed|canceled|cancelled|removed|hidden|cleared|dismissal|dismiss|hide|clear)";
    case "update":
      return "(?:updated|changed|applied|update|change|apply)";
    case "submit":
      return "(?:submitted|submission|submit)";
    case "complete":
      return "(?:completed|completion|complete)";
  }
}

function extractFeedbackEvidence(
  snapshot: DomSnapshot,
  turn: number,
): CompletionEvidence[] {
  const text = [snapshot.visibleContent, snapshot.pageContent]
    .filter(Boolean)
    .join("\n")
    .slice(0, 20_000);
  const questionNumber = extractVisibleQuestionNumber(snapshot);
  if (
    /\b(?:your answer|answer is|feedback|result|marked)\b.{0,80}\b(?:incorrect|wrong answer|not correct)\b/i.test(
      text,
    )
  ) {
    return [
      {
        type: "validation_error",
        confidence: "medium",
        logicalKey: `quiz:q${questionNumber ?? "current"}:feedback`,
        observedAtTurn: turn,
        detail: {
          text: "Visible quiz feedback indicates the answer is incorrect.",
        },
      },
    ];
  }
  if (
    /\b(?:your answer|answer is|feedback|result|marked)\b.{0,80}\b(?:correct|well done|nice work)\b/i.test(
      text,
    ) ||
    /\bcorrect!\b/i.test(text)
  ) {
    return [
      {
        type: "correct_feedback",
        confidence: "medium",
        logicalKey: `quiz:q${questionNumber ?? "current"}:feedback`,
        observedAtTurn: turn,
        detail: {
          ...(questionNumber != null ? { questionNumber } : {}),
          text: "Visible quiz feedback indicates the answer is correct.",
        },
      },
    ];
  }
  return [];
}

function extractValidationErrorEvidence(
  snapshot: DomSnapshot,
  turn: number,
): CompletionEvidence[] {
  if (extractFormFieldObservations(snapshot).length === 0) return [];
  const text = [snapshot.visibleContent, snapshot.pageContent]
    .filter(Boolean)
    .join("\n")
    .slice(0, 20_000);
  if (
    !/\b(?:error|invalid|missing|please fill|please enter|is required|are required|required field|cannot be blank|can't be blank|must be filled)\b/i.test(
      text,
    )
  ) {
    return [];
  }
  return [
    {
      type: "validation_error",
      confidence: "medium",
      logicalKey: "form:validation",
      observedAtTurn: turn,
      detail: {
        text: "Visible form validation indicates required or invalid fields.",
      },
    },
  ];
}

function extractFormConfirmationEvidence(
  snapshot: DomSnapshot,
  turn: number,
): CompletionEvidence[] {
  const text = [
    snapshot.title,
    snapshot.url,
    snapshot.visibleContent,
    snapshot.pageContent,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 20_000);
  const hasStrongConfirmation =
    /\b(?:submission complete|submitted successfully|request has been submitted|thank you,? your request|request received|form submitted|order confirmed)\b/i.test(
      text,
    );
  const hasReferenceConfirmation =
    /\b(?:reference number|confirmation number)\b/i.test(text) &&
    /\b(?:submission|submitted|complete|thank you|received|confirmation)\b/i.test(
      text,
    );
  if (!hasStrongConfirmation && !hasReferenceConfirmation) {
    return [];
  }
  return [
    {
      type: "confirmation_state",
      confidence: "medium",
      logicalKey: "form:confirmation",
      observedAtTurn: turn,
      detail: {
        text: cleanLabel(
          snapshot.visibleContent || snapshot.pageContent || snapshot.title,
        ).slice(0, 1000),
        source: "visible_text",
        ...(snapshot.url ? { url: snapshot.url } : {}),
      },
    },
  ];
}

function extractWorkflowConfirmationEvidence(
  snapshot: DomSnapshot,
  turn: number,
): CompletionEvidence[] {
  const text = [
    snapshot.title,
    snapshot.url,
    snapshot.visibleContent,
    snapshot.pageContent,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 20_000);
  const actions = new Set<WorkflowConfirmationAction>();

  for (const action of WORKFLOW_CONFIRMATION_ACTIONS) {
    if (textConfirmsWorkflowAction(text, action, "visible")) {
      actions.add(action);
    }
  }

  return [...actions].map((action) => ({
    type: "confirmation_state" as const,
    confidence: "medium" as const,
    logicalKey: `workflow:confirmation:${action}`,
    observedAtTurn: turn,
    detail: {
      text: workflowConfirmationEvidenceText(snapshot, action),
      action,
      source: "visible_text",
      ...(snapshot.url ? { url: snapshot.url } : {}),
    },
  }));
}

function workflowConfirmationEvidenceText(
  snapshot: DomSnapshot,
  action: WorkflowConfirmationAction,
): string {
  const source = cleanLabel(
    snapshot.visibleContent || snapshot.pageContent || snapshot.title,
  );
  return (
    extractWorkflowConfirmationSnippet(source, action) ?? source
  ).slice(0, 1000);
}

function extractWorkflowConfirmationSnippet(
  value: string,
  action: WorkflowConfirmationAction,
): string | null {
  const text = cleanLabel(value);
  if (!text) return null;

  const sentence = text
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((candidate) => cleanLabel(candidate))
    .find((candidate) => textConfirmsWorkflowAction(candidate, action, "visible"));
  if (sentence) return sentence;

  const actionTerms = workflowActionTermPattern(action);
  const match = new RegExp(`.{0,120}\\b${actionTerms}\\b.{0,120}`, "i").exec(
    text,
  )?.[0];
  return match ? cleanLabel(match) : null;
}

function extractModalDismissalEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (!isModalDismissalToolOutcome(params)) return [];

  const dismissed = findModalLikeDescriptors(pre);
  if (dismissed.length === 0) return [];
  if (findModalLikeDescriptors(current).length > 0) return [];

  const label = dismissed
    .map((descriptor) => descriptor.label)
    .filter(Boolean)
    .join(" | ")
    .slice(0, 240);
  const identity = compactKey(
    dismissed
      .map((descriptor) => descriptor.key)
      .filter(Boolean)
      .join("-") || label || "modal",
  );

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:dismiss:${identity || "modal"}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Modal dismissed${label ? `: ${label}` : ""}`,
        action: "dismiss",
        source: "modal_disappearance",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function extractTargetDisappearanceEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];
  const action = inferTargetDisappearanceAction(element);
  if (!action) return [];

  const target = extractDisappearingTargetFromControl(element, action);
  if (!target) return [];
  const targetText = normalizeText(target);
  if (!targetText || !snapshotContainsNormalizedText(pre, targetText)) {
    return [];
  }
  if (snapshotContainsNormalizedText(current, targetText)) {
    return [];
  }

  const key = compactKey(target) || `tag-${element.tag}`;
  const actionLabel =
    action === "flag"
      ? "Flagged"
      : action === "tag"
      ? "Tagged"
      : action === "link"
        ? "Linked"
        : action === "delete"
          ? "Deleted"
          : action === "archive"
            ? "Archived"
            : action === "attach"
              ? "Attached"
              : action === "detach"
                ? "Detached"
                : action === "disconnect"
                  ? "Disconnected"
                  : action === "connect"
                    ? "Connected"
                    : action === "sync"
                      ? "Synced"
                      : action === "transfer"
                        ? "Transferred"
                        : action === "move"
                          ? "Moved"
                          : action === "rename"
                            ? "Renamed"
                            : action === "merge"
                              ? "Merged"
                  : action === "unlink"
                    ? "Unlinked"
                    : action === "untag"
                      ? "Untagged"
                      : action === "unflag"
                        ? "Unflagged"
                        : action === "unsubscribe"
                          ? "Unsubscribed"
                          : action === "subscribe"
                            ? "Subscribed"
                            : action === "unfollow"
                              ? "Unfollowed"
                              : action === "follow"
                                ? "Followed"
                                : action === "unwatch"
                                  ? "Unwatched"
                                  : action === "watch"
                                    ? "Watched"
                                    : action === "unstar"
                                      ? "Unstarred"
                                      : action === "star"
                                        ? "Starred"
                                        : action === "unbookmark"
                                          ? "Unbookmarked"
                                          : action === "bookmark"
                                            ? "Bookmarked"
                                            : action === "unfavorite"
                                              ? "Unfavorited"
                                              : action === "favorite"
                                                ? "Favorited"
                                                : action === "unpin"
                                                  ? "Unpinned"
                                                  : action === "pin"
                                                    ? "Pinned"
                                                    : action === "unmute"
                                                      ? "Unmuted"
                                                      : action === "mute"
                                                        ? "Muted"
                                                        : action === "unschedule"
                                                          ? "Unscheduled"
                                                          : action === "schedule"
                                                      ? "Scheduled"
                                                      : action === "unassign"
                                                        ? "Unassigned"
                                                        : action === "assign"
                                            ? "Assigned"
                                            : action === "cancel"
                                              ? "Canceled"
                                              : action === "unlock"
                                              ? "Unlocked"
                                              : action === "lock"
                                                ? "Locked"
                                                : action === "enable"
                                                  ? "Enabled"
                                                  : action === "disable"
                                                    ? "Disabled"
                                                    : action === "pause"
                                                      ? "Paused"
                                                      : action === "resume"
                                                        ? "Resumed"
                                                        : action === "start"
                                                          ? "Started"
                                                          : action === "stop"
                                                            ? "Stopped"
                                                            : action === "revoke"
                                                              ? "Revoked"
                                                              : action === "approve"
                                                                ? "Approved"
                                                                : action === "reject"
                                                                  ? "Rejected"
                                                                  : action === "close"
                                                                    ? "Closed"
                                                                    : action === "reopen"
                                                                      ? "Reopened"
                                                                      : action === "escalate"
                                                                        ? "Escalated"
                                                                      : action === "deescalate"
                                                                        ? "De-escalated"
                                                                        : action === "complete"
                                                                        ? "Completed"
                                                                        : action === "submit"
                                                                          ? "Submitted"
                                                                          : action === "update"
                                                                            ? "Updated"
                                                                            : action === "save"
                                                                              ? "Saved"
                                                                              : action === "export"
                                                                                ? "Exported"
                                                                                : action === "download"
                                                                                  ? "Downloaded"
                                                                                  : action === "upload"
                                                                                    ? "Uploaded"
                                                              : action === "unblock"
                                                                ? "Unblocked"
                                                                : action === "block"
                                                                  ? "Blocked"
                                                                  : action === "unsuspend"
                                                                    ? "Unsuspended"
                                                                    : action === "suspend"
                                                                      ? "Suspended"
                                                                      : action === "backup"
                                                                        ? "Backed up"
                                                                      : action === "deploy"
                                                                        ? "Deployed"
                                                                        : action === "rollback"
                                                                          ? "Rolled back"
                                                                        : action === "grant"
                                                                          ? "Granted"
                                                                          : action === "reset"
                                                                            ? "Reset"
                                                                            : action === "install"
                                                                              ? "Installed"
                                                                              : "Uninstalled";
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `${actionLabel} target no longer visible: ${target}`,
        action,
        source: "target_disappearance",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function extractDraftSubmissionEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];

  const action = inferDraftSubmissionAction(element);
  if (!action) return [];

  const draft = extractDraftEvidence(pre, params.turn)
    .filter(
      (event): event is Extract<CompletionEvidence, { type: "draft_state" }> =>
        event.type === "draft_state" &&
        !event.detail.submitted &&
        tokenizeCompletionText(event.detail.text).length >= 3 &&
        cleanLabel(event.detail.text).length >= 12,
    )
    .sort((a, b) => b.detail.text.length - a.detail.text.length)[0];
  if (!draft) return [];

  const normalizedDraftText = normalizeText(draft.detail.text);
  if (!snapshotContainsNormalizedText(pre, normalizedDraftText)) return [];
  if (snapshotContainsNormalizedText(current, normalizedDraftText)) return [];

  const key =
    compactKey(draft.detail.target) ||
    compactKey(draft.detail.text) ||
    `tag-${id}`;
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:draft:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `${action === "send" ? "Sent" : "Posted"} draft no longer visible: ${draft.detail.target}`,
        action,
        source: "draft_disappearance",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function extractStatusChangeEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];

  const action = inferStatusChangeAction(element);
  if (!action) return [];

  const currentStatus = findWorkflowStatusChangeText(current, action);
  if (!currentStatus) return [];
  if (findWorkflowStatusChangeText(pre, action)) return [];
  const targetText = findWorkflowStatusChangeTargetText(current, currentStatus);

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:status:${compactKey(currentStatus)}`,
      observedAtTurn: params.turn,
      detail: {
        text: currentStatus,
        action,
        source: "status_change",
        ...(targetText ? { targetText } : {}),
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function extractControlLabelChangeEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];

  const action = inferControlLabelChangeAction(element);
  if (!action) return [];

  const identity = stableControlIdentity(element);
  if (!identity) return [];

  const currentElement = current.elements.find(
    (candidate) =>
      candidate.isVisible && stableControlIdentity(candidate) === identity,
  );
  if (!currentElement) return [];

  const beforeText = elementControlText(element);
  const afterText = elementControlText(currentElement);
  if (normalizeText(beforeText) === normalizeText(afterText)) return [];
  if (controlLabelConfirmsWorkflowAction(beforeText, action)) return [];
  if (!controlLabelConfirmsWorkflowAction(afterText, action)) return [];
  const targetText = inferWorkflowTargetTextFromControl(element, action);

  const label = cleanLabel(
    currentElement.text ||
      currentElement.attributes.label ||
      currentElement.attributes["aria-label"] ||
      afterText,
  );

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:control:${compactKey(identity)}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Control label changed to confirmed state: ${label}`,
        action,
        source: "control_label_change",
        ...(targetText ? { targetText } : {}),
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function extractControlStateChangeEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];

  const action = inferControlStateChangeAction(element);
  if (!action) return [];

  const identity = stableControlIdentity(element);
  if (!identity) return [];

  const currentElement = current.elements.find(
    (candidate) =>
      candidate.isVisible && stableControlIdentity(candidate) === identity,
  );
  if (!currentElement) return [];

  const beforeState = readControlState(element);
  const afterState = readControlState(currentElement);
  if (beforeState == null || afterState == null) return [];
  if (beforeState === afterState) return [];
  if (!controlStateChangeMatchesAction(action, beforeState, afterState)) {
    return [];
  }

  const label = cleanLabel(
    currentElement.text ||
      currentElement.attributes.label ||
      currentElement.attributes["aria-label"] ||
      element.text ||
      element.attributes.label ||
      element.attributes["aria-label"] ||
      elementControlText(element),
  );
  const targetText = inferWorkflowTargetTextFromControl(element, action);

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:control-state:${compactKey(identity)}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Control state changed to ${controlStateCompletionWord(action)}${label ? `: ${label}` : ""}`,
        action,
        source: "control_state_change",
        ...(targetText ? { targetText } : {}),
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function extractDirtyIndicatorClearedEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];

  const action = inferSaveUpdateAction(element);
  if (!action) return [];
  if (!hasDirtyStateIndicator(pre)) return [];
  if (hasDirtyStateIndicator(current)) return [];
  const targetText = inferWorkflowTargetTextFromControl(element, action);

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:dirty-indicator-cleared`,
      observedAtTurn: params.turn,
      detail: {
        text: "Unsaved-changes indicator is no longer visible.",
        action,
        source: "dirty_indicator_cleared",
        ...(targetText ? { targetText } : {}),
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function extractReadAnswerEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  if (params.toolName !== "read_page") return [];
  return readAnswerToolEvidence({
    result: params.result,
    snapshot: params.currentSnapshot ?? params.preActionSnapshot,
    observedAtTurn: params.turn,
  });
}

function isModalDismissalToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
}): boolean {
  if (params.toolName === "dismiss_overlays") {
    return /\bdismissed\s+[1-9][0-9]*\s+overlay/i.test(params.result);
  }

  if (params.toolName === "press_key") {
    const key = String(params.args.key ?? params.args.keys ?? "").trim();
    return /^(?:escape|esc)$/i.test(key);
  }

  if (params.toolName !== "click_element") return false;
  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return false;
  const element = params.preActionSnapshot?.elements.find(
    (candidate) => candidate.tag === id,
  );
  if (!element) return false;
  return isDismissalControl(element);
}

function inferTargetDisappearanceAction(
  element: TaggedElement,
): Extract<
  WorkflowConfirmationAction,
  | "delete"
  | "archive"
  | "attach"
  | "detach"
  | "disconnect"
  | "connect"
  | "sync"
  | "transfer"
  | "move"
  | "rename"
  | "merge"
  | "unlink"
  | "link"
  | "untag"
  | "tag"
  | "unflag"
  | "flag"
  | "unsubscribe"
  | "subscribe"
  | "unfollow"
  | "follow"
  | "unwatch"
  | "watch"
  | "unstar"
  | "star"
  | "unbookmark"
  | "bookmark"
  | "unfavorite"
  | "favorite"
  | "unpin"
  | "pin"
  | "unmute"
  | "mute"
  | "unschedule"
  | "schedule"
  | "unassign"
  | "assign"
  | "cancel"
  | "unlock"
  | "lock"
  | "enable"
  | "disable"
  | "pause"
  | "resume"
  | "start"
  | "stop"
  | "approve"
  | "reject"
  | "close"
  | "reopen"
  | "escalate"
  | "deescalate"
  | "complete"
  | "submit"
  | "update"
  | "save"
  | "export"
  | "download"
  | "upload"
  | "grant"
  | "revoke"
  | "unblock"
  | "block"
  | "unsuspend"
  | "suspend"
  | "backup"
  | "deploy"
  | "rollback"
  | "reset"
  | "install"
  | "uninstall"
> | null {
  const text = normalizeText(elementControlText(element));
  if (/\buninstall(?:ed|ation)?\b/i.test(text)) return "uninstall";
  if (/\binstall(?:ed|ing|ation)?\b/i.test(text)) return "install";
  if (/\b(?:back\s+up|backup|backed\s+up|backing\s+up)\b/i.test(text)) {
    return "backup";
  }
  if (/\bdeploy(?:ed|ing|ment)?\b/i.test(text)) return "deploy";
  if (/\b(?:rollback|roll\s+back|rolled\s+back|rolling\s+back|revert(?:ed|ing)?|reversion)\b/i.test(text)) {
    return "rollback";
  }
  if (/\breset(?:ting)?\b/i.test(text)) return "reset";
  if (/\bunsuspend(?:ed|ing|sion)?\b/i.test(text)) return "unsuspend";
  if (/\bsuspend(?:ed|ing|sion)?\b/i.test(text)) return "suspend";
  if (/\bdisconnect(?:ed|ing|ion)?\b/i.test(text)) return "disconnect";
  if (/\bconnect(?:ed|ing|ion)?\b/i.test(text)) return "connect";
  if (/\bsync(?:ed|ing|hroniz(?:e|ed|ing|ation))?\b/i.test(text)) {
    return "sync";
  }
  if (/\btransfer(?:red|ring)?\b/i.test(text)) return "transfer";
  if (/\bmove(?:d|ing)?\b/i.test(text)) return "move";
  if (/\brename(?:d|ing)?\b/i.test(text)) return "rename";
  if (/\b(?:merge|merged|merging)\b/i.test(text)) return "merge";
  if (/\bunblock(?:ed|ing)?\b/i.test(text)) return "unblock";
  if (/\bblock(?:ed|ing)?\b/i.test(text)) return "block";
  if (/\buntag(?:ged|ging)?\b/i.test(text)) return "untag";
  if (/\btag(?:ged|ging)?\b/i.test(text)) return "tag";
  if (/\bunflag(?:ged|ging)?\b/i.test(text)) return "unflag";
  if (/\bflag(?:ged|ging)?\b/i.test(text)) return "flag";
  if (/\bunsubscribe(?:d|s|r|rs|ing|tion)?\b/i.test(text)) {
    return "unsubscribe";
  }
  if (/\bsubscribe(?:d|s|r|rs|ing|tion)?\b/i.test(text)) {
    return "subscribe";
  }
  if (/\bunfollow(?:ed|ing)?\b/i.test(text)) return "unfollow";
  if (/\bfollow(?:ed|ing|s|er|ers)?\b/i.test(text)) return "follow";
  if (/\bunwatch(?:ed|ing)?\b/i.test(text)) return "unwatch";
  if (/\bwatch(?:ed|ing|es|er|ers)?\b/i.test(text)) return "watch";
  if (/\bunstar(?:red|ring)?\b/i.test(text)) return "unstar";
  if (/\bstar(?:red|ring|s)?\b/i.test(text)) return "star";
  if (/\bunbookmark(?:ed|ing)?\b/i.test(text)) return "unbookmark";
  if (/\bbookmark(?:ed|ing|s)?\b/i.test(text)) return "bookmark";
  if (/\bunfavorite(?:d|ing)?\b/i.test(text)) return "unfavorite";
  if (/\bfavorite(?:d|ing|s)?\b/i.test(text)) return "favorite";
  if (/\bunpin(?:ned|ning)?\b/i.test(text)) return "unpin";
  if (/\bpin(?:ned|ning|s)?\b/i.test(text)) return "pin";
  if (/\bunmute(?:d|ing)?\b/i.test(text)) return "unmute";
  if (/\bmute(?:d|ing|s)?\b/i.test(text)) return "mute";
  if (/\bunschedule(?:d|ing)?\b/i.test(text)) return "unschedule";
  if (/\bschedule(?:d|ing)?\b/i.test(text)) return "schedule";
  if (/\bunassign(?:ed|ing)?\b/i.test(text)) return "unassign";
  if (/\bassign(?:ed|ing)?\b/i.test(text)) return "assign";
  if (/\b(?:cancel|canceled|cancelled|cancellation)\b/i.test(text)) {
    return "cancel";
  }
  if (/\bunlock(?:ed|ing)?\b/i.test(text)) return "unlock";
  if (/\block(?:ed|ing)?\b/i.test(text)) return "lock";
  if (/\b(?:enable|enabled|activate|activated)\b/i.test(text)) {
    return "enable";
  }
  if (/\b(?:disable|disabled|deactivate|deactivated)\b/i.test(text)) {
    return "disable";
  }
  if (/\bpause(?:d|ing)?\b/i.test(text)) return "pause";
  if (/\bresume(?:d|ing)?\b/i.test(text)) return "resume";
  if (/\bstart(?:ed|ing)?\b/i.test(text)) return "start";
  if (/\bstop(?:ped|ping)?\b/i.test(text)) return "stop";
  if (/\b(?:approve|approved|approving|approval)\b/i.test(text)) {
    return "approve";
  }
  if (
    /\b(?:reject|rejected|rejecting|rejection|deny|denied|denial)\b/i.test(
      text,
    )
  ) {
    return "reject";
  }
  if (
    /\b(?:close|closed|closing|closure|resolve|resolved|resolving|resolution)\b/i.test(
      text,
    )
  ) {
    return "close";
  }
  if (/\bre[-\s]?open(?:ed|ing)?\b/i.test(text)) return "reopen";
  if (/\bde[-\s]?escalat(?:e|ed|ing|ion)\b/i.test(text)) {
    return "deescalate";
  }
  if (/\bescalat(?:e|ed|ing|ion)\b/i.test(text)) return "escalate";
  if (isCompleteWorkflowRequest(text)) return "complete";
  if (/\b(?:submit|submitted|submission)\b/i.test(text)) return "submit";
  if (/\b(?:update|updated|updating|apply|applied|applying)\b/i.test(text)) {
    return "update";
  }
  if (/\b(?:save|saved|saving)\b/i.test(text)) return "save";
  if (/\bexport(?:ed|ing)?\b/i.test(text)) return "export";
  if (/\bdownload(?:ed|ing)?\b/i.test(text)) return "download";
  if (/\bupload(?:ed|ing)?\b/i.test(text)) return "upload";
  if (/\bgrant(?:ed|ing)?\b/i.test(text)) return "grant";
  if (/\battach(?:ed|ing|ment)?\b/i.test(text)) return "attach";
  if (/\bunlink(?:ed|ing)?\b/i.test(text)) return "unlink";
  if (/\blink(?:ed|ing)?\b/i.test(text)) return "link";
  if (/\bdetach(?:ed|ment)?\b/i.test(text)) return "detach";
  if (/\brevok(?:e|ed|ing|ation)\b/i.test(text)) return "revoke";
  if (/\b(?:delete|remove)\b/i.test(text)) return "delete";
  if (/\barchive\b/i.test(text)) return "archive";
  return null;
}

function inferDraftSubmissionAction(
  element: TaggedElement,
): Extract<WorkflowConfirmationAction, "send" | "post"> | null {
  const text = normalizeText(elementControlText(element));
  if (!text) return null;
  if (/\b(?:post|publish)\b/i.test(text)) return "post";
  if (/\b(?:send|email)\b/i.test(text)) return "send";
  if (/\b(?:comment|reply)\b/i.test(text)) return "post";
  if (/\bmessage\b/i.test(text)) return "send";
  return null;
}

type StatusChangeWorkflowAction = Extract<
  WorkflowConfirmationAction,
  | "approve"
  | "reject"
  | "post"
  | "close"
  | "reopen"
  | "cancel"
  | "enable"
  | "disable"
  | "assign"
  | "unassign"
  | "escalate"
  | "deescalate"
  | "lock"
  | "unlock"
  | "pause"
  | "resume"
  | "start"
  | "stop"
  | "submit"
  | "complete"
>;

function inferStatusChangeAction(
  element: TaggedElement,
): StatusChangeWorkflowAction | null {
  const text = normalizeText(elementControlText(element));
  if (!text) return null;
  if (/\b(?:approve|approved)\b/i.test(text)) return "approve";
  if (/\b(?:reject|rejected|deny|denied)\b/i.test(text)) return "reject";
  if (/\b(?:post|posted|publish|published)\b/i.test(text)) return "post";
  if (/\bre[-\s]?open(?:ed)?\b/i.test(text)) return "reopen";
  if (/\b(?:cancel|canceled|cancelled|cancellation)\b/i.test(text)) {
    return "cancel";
  }
  if (/\b(?:enable|enabled|activate|activated)\b/i.test(text)) {
    return "enable";
  }
  if (/\b(?:disable|disabled|deactivate|deactivated)\b/i.test(text)) {
    return "disable";
  }
  if (/\bunassign(?:ed)?\b/i.test(text)) return "unassign";
  if (/\bassign(?:ed)?\b/i.test(text)) return "assign";
  if (/\bde[-\s]?escalat(?:e|ed)\b/i.test(text)) return "deescalate";
  if (/\bescalat(?:e|ed)\b/i.test(text)) return "escalate";
  if (/\bunlock(?:ed)?\b/i.test(text)) return "unlock";
  if (/\block(?:ed)?\b/i.test(text)) return "lock";
  if (/\bpause(?:d)?\b/i.test(text)) return "pause";
  if (/\bresume(?:d)?\b/i.test(text)) return "resume";
  if (/\bstart(?:ed)?\b/i.test(text)) return "start";
  if (/\bstop(?:ped)?\b/i.test(text)) return "stop";
  if (/\b(?:close|closed|resolve|resolved)\b/i.test(text)) return "close";
  if (/\b(?:submit|submitted)\b/i.test(text)) return "submit";
  if (isCompleteWorkflowRequest(text)) return "complete";
  return null;
}

function inferSaveUpdateAction(
  element: TaggedElement,
): Extract<WorkflowConfirmationAction, "save" | "update"> | null {
  const text = normalizeText(elementControlText(element));
  if (!text) return null;
  if (/\b(?:update|apply changes|apply)\b/i.test(text)) return "update";
  if (/\b(?:save|save changes)\b/i.test(text)) return "save";
  return null;
}

function inferControlLabelChangeAction(
  element: TaggedElement,
): WorkflowConfirmationAction | null {
  return (
    inferStatusChangeAction(element) ??
    inferSaveUpdateAction(element) ??
    inferDraftSubmissionAction(element) ??
    inferTargetDisappearanceAction(element) ??
    (isDismissalControl(element) ? "dismiss" : null)
  );
}

function inferControlStateChangeAction(
  element: TaggedElement,
): ControlStateWorkflowAction | null {
  const text = normalizeText(elementControlText(element));
  if (!text) return null;
  if (/\b(?:enable|activate|turn\s+on)\b/i.test(text)) return "enable";
  if (/\b(?:disable|deactivate|turn\s+off)\b/i.test(text)) return "disable";
  if (/\bunlock(?:ed)?\b/i.test(text)) return "unlock";
  if (/\block(?:ed)?\b/i.test(text)) return "lock";
  return null;
}

type ControlStateWorkflowAction = Extract<
  WorkflowConfirmationAction,
  "enable" | "disable" | "lock" | "unlock"
>;

function controlStateChangeMatchesAction(
  action: ControlStateWorkflowAction,
  beforeState: boolean,
  afterState: boolean,
): boolean {
  switch (action) {
    case "enable":
    case "lock":
      return beforeState === false && afterState === true;
    case "disable":
    case "unlock":
      return beforeState === true && afterState === false;
  }
}

function controlStateCompletionWord(action: ControlStateWorkflowAction): string {
  switch (action) {
    case "enable":
      return "enabled";
    case "disable":
      return "disabled";
    case "lock":
      return "locked";
    case "unlock":
      return "unlocked";
  }
}

function controlLabelConfirmsWorkflowAction(
  value: string,
  action: WorkflowConfirmationAction,
): boolean {
  const text = normalizeText(value);
  switch (action) {
    case "delete":
      return /\b(?:deleted|removed)\b/i.test(text);
    case "archive":
      return /\barchived\b/i.test(text);
    case "save":
      return /\bsaved\b/i.test(text);
    case "send":
      return /\bsent\b/i.test(text);
    case "export":
      return /\bexported\b/i.test(text);
    case "download":
      return /\bdownloaded\b/i.test(text);
    case "upload":
      return /\buploaded\b/i.test(text);
    case "import":
      return /\bimported\b/i.test(text);
    case "attach":
      return /\battached\b/i.test(text);
    case "detach":
      return /\bdetached\b/i.test(text);
    case "copy":
      return /\bcopied\b/i.test(text);
    case "transfer":
      return /\btransferred\b/i.test(text);
    case "move":
      return /\bmoved\b/i.test(text);
    case "rename":
      return /\brenamed\b/i.test(text);
    case "merge":
      return /\bmerged\b/i.test(text);
    case "schedule":
      return /\bscheduled\b/i.test(text);
    case "unschedule":
      return /\bunscheduled\b/i.test(text);
    case "deploy":
      return /\bdeployed\b/i.test(text);
    case "rollback":
      return /\b(?:rolled\s+back|reverted)\b/i.test(text);
    case "backup":
      return /\bbacked\s+up\b/i.test(text);
    case "reset":
      return /\breset\b/i.test(text);
    case "suspend":
      return /\bsuspended\b/i.test(text);
    case "unsuspend":
      return /\bunsuspended\b/i.test(text);
    case "block":
      return /\bblocked\b/i.test(text);
    case "unblock":
      return /\bunblocked\b/i.test(text);
    case "link":
      return /\blinked\b/i.test(text);
    case "unlink":
      return /\bunlinked\b/i.test(text);
    case "tag":
      return /\btagged\b/i.test(text);
    case "untag":
      return /\buntagged\b/i.test(text);
    case "flag":
      return /\bflagged\b/i.test(text);
    case "unflag":
      return /\bunflagged\b/i.test(text);
    case "duplicate":
      return /\b(?:duplicated|cloned)\b/i.test(text);
    case "restore":
      return /\b(?:restored|recovered|reinstated)\b/i.test(text);
    case "create":
      return /\b(?:created|added|registered)\b/i.test(text);
    case "share":
      return /\bshared\b/i.test(text);
    case "grant":
      return /\bgranted\b/i.test(text);
    case "revoke":
      return /\brevoked\b/i.test(text);
    case "install":
      return /\binstalled\b/i.test(text);
    case "uninstall":
      return /\buninstalled\b/i.test(text);
    case "connect":
      return /\bconnected\b/i.test(text);
    case "disconnect":
      return /\bdisconnected\b/i.test(text);
    case "sync":
      return /\b(?:synced|resynced|synchroni[sz]ed)\b/i.test(text);
    case "invite":
      return /\binvited\b/i.test(text);
    case "subscribe":
      return /\bsubscribed\b/i.test(text);
    case "unsubscribe":
      return /\bunsubscribed\b/i.test(text);
    case "pin":
      return /\bpinned\b/i.test(text);
    case "unpin":
      return /\bunpinned\b/i.test(text);
    case "mute":
      return /\bmuted\b/i.test(text);
    case "unmute":
      return /\bunmuted\b/i.test(text);
    case "follow":
      return /\bfollowed\b/i.test(text);
    case "unfollow":
      return /\bunfollowed\b/i.test(text);
    case "bookmark":
      return /\bbookmarked\b/i.test(text);
    case "unbookmark":
      return /\bunbookmarked\b/i.test(text);
    case "favorite":
      return /\bfavorited\b/i.test(text);
    case "unfavorite":
      return /\bunfavorited\b/i.test(text);
    case "watch":
      return /\bwatched\b/i.test(text);
    case "unwatch":
      return /\bunwatched\b/i.test(text);
    case "star":
      return /\bstarred\b/i.test(text);
    case "unstar":
      return /\bunstarred\b/i.test(text);
    case "post":
      return /\b(?:posted|published)\b/i.test(text);
    case "approve":
      return /\bapproved\b/i.test(text);
    case "reject":
      return /\b(?:rejected|denied)\b/i.test(text);
    case "close":
      return /\b(?:closed|resolved)\b/i.test(text);
    case "reopen":
      return /\bre[-\s]?opened\b/i.test(text);
    case "cancel":
      return /\bcancell?ed\b/i.test(text);
    case "enable":
      return /\b(?:enabled|activated)\b/i.test(text);
    case "disable":
      return /\b(?:disabled|deactivated)\b/i.test(text);
    case "assign":
      return /\bassigned\b/i.test(text);
    case "unassign":
      return /\bunassigned\b/i.test(text);
    case "escalate":
      return /\bescalated\b/i.test(text);
    case "deescalate":
      return /\bde[-\s]?escalated\b/i.test(text);
    case "lock":
      return /\blocked\b/i.test(text);
    case "unlock":
      return /\bunlocked\b/i.test(text);
    case "pause":
      return /\bpaused\b/i.test(text);
    case "resume":
      return /\bresumed\b/i.test(text);
    case "start":
      return /\b(?:started|running|active)\b/i.test(text);
    case "stop":
      return /\b(?:stopped|inactive)\b/i.test(text);
    case "restart":
      return /\brestarted\b/i.test(text);
    case "refresh":
      return /\brefreshed\b/i.test(text);
    case "dismiss":
      return /\b(?:dismissed|hidden|cleared)\b/i.test(text);
    case "update":
      return /\b(?:updated|changed|applied|up[-\s]+to[-\s]+date)\b/i.test(text);
    case "submit":
      return /\bsubmitted\b/i.test(text);
    case "complete":
      return /\bcompleted\b/i.test(text);
  }
  return false;
}

function stableControlIdentity(element: TaggedElement): string | null {
  const identity =
    element.attributes.control ||
    element.attributes.id ||
    element.attributes.name ||
    element.attributes["data-testid"];
  return identity ? normalizeText(identity) : null;
}

function hasDirtyStateIndicator(snapshot: DomSnapshot): boolean {
  const text = normalizeText(snapshotCompletionText(snapshot));
  return /\b(?:unsaved(?: changes)?|changes not saved|changes have not been saved|not saved|pending changes|you have unsaved)\b/i.test(
    text,
  );
}

function findWorkflowStatusChangeText(
  snapshot: DomSnapshot,
  action: StatusChangeWorkflowAction,
): string | null {
  const text = snapshotCompletionText(snapshot);
  const statusWord =
    action === "approve"
      ? "(?:approved|approval complete|approval completed|approval successful)"
      : action === "reject"
        ? "(?:rejected|rejection complete|rejection completed|rejection successful|denied|denial complete|denial completed|denial successful)"
        : action === "post"
          ? "(?:posted|published|post complete|post completed|post successful|publish complete|publish completed|publish successful)"
          : action === "close"
            ? "(?:closed|resolved)"
            : action === "reopen"
              ? "(?:open|reopened|re-opened)"
              : action === "cancel"
                ? "(?:canceled|cancelled|cancellation complete|cancellation completed|cancellation successful)"
                : action === "enable"
                  ? "(?:enabled|activated|activation complete|activation completed|activation successful)"
                  : action === "disable"
                    ? "(?:disabled|deactivated|deactivation complete|deactivation completed|deactivation successful)"
                    : action === "assign"
                      ? "(?:assigned|assignment complete|assignment completed|assignment successful)"
                      : action === "unassign"
                        ? "(?:unassigned|unassign complete|unassign completed|unassign successful)"
                        : action === "escalate"
                          ? "(?:escalated|escalation complete|escalation completed|escalation successful)"
                          : action === "deescalate"
                            ? "(?:de[-\\s]?escalated|de[-\\s]?escalation complete|de[-\\s]?escalation completed|de[-\\s]?escalation successful)"
                            : action === "lock"
                              ? "(?:locked|lock complete|lock completed|lock successful)"
                              : action === "unlock"
                                ? "(?:unlocked|unlock complete|unlock completed|unlock successful)"
                                : action === "pause"
                                  ? "(?:paused|pause complete|pause completed|pause successful)"
                                  : action === "resume"
                                    ? "(?:resumed|running|active|resume complete|resume completed|resume successful)"
                                    : action === "start"
                                      ? "(?:started|running|active|start complete|start completed|start successful)"
                                      : action === "stop"
                                        ? "(?:stopped|inactive|stop complete|stop completed|stop successful)"
                                        : action === "submit"
                                          ? "(?:submitted|submission complete|submission completed|submission successful)"
                                          : "(?:complete|completed)";
  const patterns = [
    new RegExp(
      `\\b(?:status|state|stage)\\s*(?::|=|-|is|now)?\\s*${statusWord}\\b`,
      "i",
    ),
    new RegExp(
      `\\b${statusWord}\\s+(?:by|on|at|status|state|stage)\\b`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[0]) return cleanLabel(match[0]);
  }
  return null;
}

function findWorkflowStatusChangeTargetText(
  snapshot: DomSnapshot,
  statusText: string,
): string | null {
  const status = cleanLabel(statusText);
  if (!status) return null;
  const normalizedStatus = normalizeText(status);

  for (const segment of statusTargetTextSegments(snapshot)) {
    const text = cleanLabel(segment);
    const index = normalizeText(text).indexOf(normalizedStatus);
    if (index <= 0) continue;

    const prefix = cleanLabel(text.slice(0, index).replace(/[,:=-]+$/g, ""));
    if (!prefix || /\b(?:status|state|stage)\b/i.test(prefix)) continue;

    const target = normalizeWorkflowTargetLabel(prefix, {
      allowShort: /[\d_-]/.test(prefix),
    });
    if (target) return target;
  }
  return null;
}

function statusTargetTextSegments(snapshot: DomSnapshot): string[] {
  const segments: string[] = [];
  const seen = new Set<string>();
  for (const value of [
    snapshot.visibleContent,
    snapshot.pageContent,
    snapshot.title,
  ]) {
    if (!value) continue;
    for (const segment of value
      .replace(/([.!?;])\s+/g, "$1\n")
      .split(/[\r\n]+/g)) {
      const text = cleanLabel(segment);
      const key = normalizeText(text);
      if (!text || seen.has(key)) continue;
      seen.add(key);
      segments.push(text);
    }
  }
  return segments;
}

function inferWorkflowTargetTextFromControl(
  element: TaggedElement,
  action: WorkflowConfirmationAction,
): string | null {
  const candidates = [
    element.text,
    element.attributes.label,
    element.attributes["aria-label"],
    element.attributes.title,
    element.attributes.value,
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const value of [candidate, candidate.replace(/[-_]+/g, " ")]) {
      const text = cleanLabel(value);
      const key = normalizeText(text);
      if (!text || seen.has(key)) continue;
      seen.add(key);

      const target = inferWorkflowConfirmationTargetLabel(text, action);
      if (target) return target;
    }
  }
  return null;
}

function snapshotCompletionText(snapshot: DomSnapshot): string {
  return cleanLabel(
    [
      snapshot.title,
      snapshot.visibleContent,
      snapshot.pageContent,
      ...snapshot.elements.flatMap((element) => [
        element.text,
        element.attributes.label,
        element.attributes["aria-label"],
        element.attributes.title,
        element.attributes.name,
        element.attributes.id,
        element.attributes.value,
      ]),
    ]
      .filter(Boolean)
      .join(" "),
  ).slice(0, 20_000);
}

function extractDisappearingTargetFromControl(
  element: TaggedElement,
  action: Extract<
    WorkflowConfirmationAction,
    | "delete"
    | "archive"
    | "attach"
    | "detach"
    | "disconnect"
    | "connect"
    | "sync"
    | "transfer"
    | "move"
    | "rename"
    | "merge"
    | "unlink"
    | "link"
    | "untag"
    | "tag"
    | "unflag"
    | "flag"
    | "unsubscribe"
    | "subscribe"
    | "unfollow"
    | "follow"
    | "unwatch"
    | "watch"
    | "unstar"
    | "star"
    | "unbookmark"
    | "bookmark"
    | "unfavorite"
    | "favorite"
    | "unpin"
    | "pin"
    | "unmute"
    | "mute"
    | "unschedule"
    | "schedule"
    | "unassign"
    | "assign"
    | "cancel"
    | "unlock"
    | "lock"
    | "enable"
    | "disable"
    | "pause"
    | "resume"
    | "start"
    | "stop"
    | "approve"
    | "reject"
    | "close"
    | "reopen"
    | "escalate"
    | "deescalate"
    | "complete"
    | "submit"
    | "update"
    | "save"
    | "export"
    | "download"
    | "upload"
    | "grant"
    | "revoke"
    | "unblock"
    | "block"
    | "unsuspend"
    | "suspend"
    | "backup"
    | "deploy"
    | "rollback"
    | "reset"
    | "install"
    | "uninstall"
  >,
): string | null {
  const candidates = [
    element.text,
    element.attributes.label,
    element.attributes["aria-label"],
    element.attributes.title,
    element.attributes.name,
    element.attributes.id,
  ].map((value) => cleanLabel(value ?? ""));

  for (const candidate of candidates) {
    if (!candidate) continue;
    const actionPattern =
      action === "link"
        ? "link"
        : action === "tag"
          ? "tag"
          : action === "flag"
            ? "flag"
          : action === "delete"
            ? "(?:delete|remove)"
            : action === "archive"
              ? "archive"
              : action === "attach"
                ? "attach"
                : action === "detach"
                  ? "detach"
                : action === "disconnect"
                  ? "disconnect"
                  : action === "connect"
                    ? "connect"
                    : action === "sync"
                      ? "(?:sync|synchronize)"
                    : action === "transfer"
                      ? "transfer"
                    : action === "move"
                      ? "move"
                    : action === "rename"
                      ? "rename"
                    : action === "merge"
                      ? "merge"
                    : action === "unlink"
                      ? "unlink"
                      : action === "untag"
                        ? "untag"
                        : action === "unflag"
                          ? "unflag"
                      : action === "unsubscribe"
                        ? "(?:unsubscribe(?:\\s+from)?)"
                        : action === "subscribe"
                          ? "(?:subscribe(?:\\s+to)?)"
                        : action === "unfollow"
                          ? "unfollow"
                          : action === "follow"
                          ? "follow"
                          : action === "unwatch"
                            ? "unwatch"
                            : action === "watch"
                              ? "watch"
                            : action === "unstar"
                              ? "unstar"
                              : action === "star"
                                ? "star"
                                : action === "unbookmark"
                                  ? "unbookmark"
                                  : action === "bookmark"
                                    ? "bookmark"
                                    : action === "unfavorite"
                                      ? "unfavorite"
                                      : action === "favorite"
                                        ? "favorite"
                                        : action === "unpin"
                                          ? "unpin"
                                          : action === "pin"
                                            ? "pin"
                                            : action === "unmute"
                                              ? "unmute"
                                              : action === "mute"
                                                ? "mute"
                                                : action === "unschedule"
                                                  ? "unschedule"
                                                  : action === "schedule"
                                              ? "schedule"
                                              : action === "unassign"
                                                ? "unassign"
                                                : action === "assign"
                                              ? "assign"
                                              : action === "cancel"
                                                ? "cancel"
                                                : action === "unlock"
                                                  ? "unlock"
                                                  : action === "lock"
                                                    ? "lock"
                                                    : action === "enable"
                                                      ? "(?:enable|activate)"
                                                      : action === "disable"
                                                        ? "(?:disable|deactivate)"
                                                        : action === "pause"
                                                          ? "pause"
                                                          : action === "resume"
                                                            ? "resume"
                                                              : action === "start"
                                                                ? "start"
                                                                : action === "stop"
                                                                  ? "stop"
                                                                  : action === "approve"
                                                                    ? "approve"
                                                                    : action === "reject"
                                                                      ? "(?:reject|deny)"
                                                                      : action === "close"
                                                                        ? "(?:close|resolve)"
                                                                        : action === "reopen"
                                                                          ? "(?:re[-\\s]?open)"
                                                                          : action === "escalate"
                                                                            ? "escalate"
                                                                            : action === "deescalate"
                                                                              ? "(?:de[-\\s]?escalate)"
                                                                              : action === "complete"
                                                                                ? "(?:complete|mark|set)"
                                                                                : action === "submit"
                                                                                  ? "submit"
                                                                                  : action === "update"
                                                                                    ? "(?:update|apply(?:\\s+changes)?(?:\\s+to)?)"
                                                                                    : action === "save"
                                                                                      ? "save"
                                                                                      : action === "export"
                                                                                        ? "export"
                                                                                        : action === "download"
                                                                                          ? "download"
                                                                                          : action === "upload"
                                                                                            ? "upload"
                                                                  : action === "grant"
                                                                    ? "grant"
                                                                    : action === "revoke"
                                                                      ? "(?:revoke|revocation)"
                                                                      : action === "unblock"
                                                                        ? "unblock"
                                                                        : action === "block"
                                                                          ? "block"
                                                                          : action === "unsuspend"
                                                                            ? "unsuspend"
                                                                            : action === "suspend"
                                                                              ? "suspend"
                                                                              : action === "backup"
                                                                                ? "(?:back\\s+up|backup)"
                                                                                : action === "deploy"
                                                                                  ? "deploy"
                                                                                  : action === "rollback"
                                                                                    ? "(?:roll\\s+back|rollback|revert|reversion)"
                                                                                  : action === "reset"
                                                                                    ? "reset"
                                                                                    : action === "install"
                                                                                      ? "install"
                                                                                      : "uninstall";
    const explicit = new RegExp(
      `\\b${actionPattern}\\b\\s+(?:the\\s+)?(.{3,120})`,
      "i",
    ).exec(candidate);
    if (!explicit?.[1]) continue;
    let target = cleanLabel(explicit[1])
      .replace(
        /\b(?:button|link|action|delete|remove|archive|attach|attached|attaching|detach|disconnect|disconnection|connect|connected|connecting|connection|sync|synced|syncing|synchronize|synchronized|synchronizing|synchronization|transfer|transferred|transferring|move|moved|moving|rename|renamed|renaming|merge|merged|merging|unlink|untag|untagging|tag|tagged|tagging|unflag|unflagging|flag|flagged|flagging|unsubscribe|unsubscribed|unsubscription|subscribe|subscribed|subscription|unfollow|unfollowed|follow|followed|unwatch|unwatched|watch|watched|watching|unstar|unstarred|star|starred|starring|unbookmark|unbookmarked|bookmark|bookmarked|bookmarking|unfavorite|unfavorited|favorite|favorited|favoriting|unpin|unpinned|pin|pinned|pinning|unmute|unmuted|mute|muted|muting|unschedule|unscheduled|schedule|scheduled|scheduling|unassign|unassigned|assign|assigned|assignment|assignee|cancel|canceled|cancelled|cancellation|unlock|unlocked|lock|locked|enable|enabled|activate|activated|activation|disable|disabled|deactivate|deactivated|deactivation|pause|paused|pausing|resume|resumed|resuming|start|started|starting|stop|stopped|stopping|approve|approved|approving|approval|reject|rejected|rejecting|rejection|deny|denied|denial|close|closed|closing|closure|resolve|resolved|resolving|resolution|re[-\s]?open|re[-\s]?opened|re[-\s]?opening|de[-\s]?escalate|de[-\s]?escalated|de[-\s]?escalating|de[-\s]?escalation|escalate|escalated|escalating|escalation|complete|completed|completing|completion|submit|submitted|submission|update|updated|updating|save|saved|saving|export|exported|exporting|download|downloaded|downloading|upload|uploaded|uploading|grant|granted|granting|revoke|revocation|unblock|block|blocking|unsuspend|suspend|suspension|back\s+up|backup|backed\s+up|backing\s+up|deploy|deployed|deploying|deployment|rollback|rolled\s+back|rolling\s+back|revert|reverted|reverting|reversion|reset|resetting|install|installed|installing|installation|uninstall)\b/gi,
        " ",
      )
      .replace(/\b(?:item|entry|row|record)\b/gi, " ")
      .replace(/^["'`]+|["'`]+$/g, "");
    target = cleanLabel(target);
    if (!target) continue;

    const tokens = tokenizeCompletionText(target).filter(
      (token) =>
        ![
          "account",
          "add",
          "add-on",
          "addon",
          "admin",
          "administrator",
          "app",
          "application",
          "approval",
          "approve",
          "approved",
          "approving",
          "denial",
          "denied",
          "deny",
          "attach",
          "attached",
          "attaching",
          "activate",
          "activated",
          "activation",
          "archive",
          "assign",
          "assigned",
          "assignee",
          "assignment",
          "attachment",
          "backup",
          "backed",
          "backing",
          "button",
          "cancel",
          "canceled",
          "cancelled",
          "cancellation",
          "case",
          "block",
          "blocking",
          "bookmark",
          "bookmarked",
          "bookmarking",
          "change",
          "changes",
          "channel",
          "connector",
          "connect",
          "connected",
          "connecting",
          "connection",
          "close",
          "closed",
          "closing",
          "closure",
          "complete",
          "completed",
          "completing",
          "completion",
          "csv",
          "data",
          "dataset",
          "datasets",
          "delete",
          "deactivate",
          "deactivated",
          "deactivation",
          "deescalate",
          "deescalated",
          "deescalating",
          "deescalation",
          "deploy",
          "deployed",
          "deploying",
          "deployment",
          "detach",
          "detachment",
          "disable",
          "disabled",
          "dialog",
          "disconnect",
          "disconnection",
          "download",
          "downloaded",
          "downloading",
          "upload",
          "uploaded",
          "uploading",
          "dependency",
          "document",
          "draft",
          "drafts",
          "driver",
          "endpoint",
          "enable",
          "enabled",
          "entry",
          "entitlement",
          "escalate",
          "escalated",
          "escalating",
          "escalation",
          "export",
          "exported",
          "exporting",
          "extension",
          "file",
          "flag",
          "flagged",
          "flagging",
          "feed",
          "favorite",
          "favorited",
          "favoriting",
          "grant",
          "granted",
          "granting",
          "integration",
          "install",
          "installation",
          "installed",
          "installing",
          "incident",
          "incidents",
          "item",
          "license",
          "licence",
          "link",
          "linked",
          "list",
          "membership",
          "modal",
          "module",
          "move",
          "moved",
          "moving",
          "rename",
          "renamed",
          "renaming",
          "reopen",
          "reopened",
          "reopening",
          "merge",
          "merged",
          "merging",
          "mute",
          "muted",
          "muting",
          "newsletter",
          "overlay",
          "package",
          "panel",
          "pause",
          "paused",
          "pausing",
          "permission",
          "plugin",
          "pop-up",
          "popup",
          "pin",
          "pinned",
          "pinning",
          "provider",
          "privilege",
          "profile",
          "record",
          "report",
          "reports",
          "repository",
          "remove",
          "request",
          "result",
          "results",
          "reject",
          "rejected",
          "rejecting",
          "rejection",
          "resolve",
          "resolved",
          "resolving",
          "resolution",
          "rollback",
          "revert",
          "reverted",
          "reversion",
          "reset",
          "resetting",
          "resume",
          "resumed",
          "resuming",
          "revoke",
          "revocation",
          "role",
          "row",
          "save",
          "saved",
          "saving",
          "schedule",
          "scheduled",
          "service",
          "source",
          "spreadsheet",
          "spreadsheets",
          "star",
          "starred",
          "start",
          "started",
          "starting",
          "stop",
          "stopped",
          "stopping",
          "subscription",
          "subscribe",
          "subscribed",
          "subscriber",
          "subscribers",
          "submit",
          "submitted",
          "submission",
          "update",
          "updated",
          "updating",
          "suspend",
          "suspension",
          "sync",
          "synced",
          "syncing",
          "synchronization",
          "synchronize",
          "synchronized",
          "synchronizing",
          "transfer",
          "transferred",
          "transferring",
          "theme",
          "ticket",
          "tool",
          "topic",
          "tag",
          "tagged",
          "tagging",
          "table",
          "tables",
          "task",
          "tasks",
          "unblock",
          "unblocking",
          "unbookmark",
          "unbookmarked",
          "unfavorite",
          "unfavorited",
          "unpin",
          "unpinned",
          "unmute",
          "unmuted",
          "unschedule",
          "unscheduled",
          "unlink",
          "unlinking",
          "unflag",
          "unflagging",
          "untag",
          "untagging",
          "unsubscribe",
          "unsubscribed",
          "unsubscription",
          "unassign",
          "unassigned",
          "unlock",
          "unlocked",
          "lock",
          "locked",
          "follow",
          "followed",
          "follower",
          "followers",
          "unfollow",
          "unfollowed",
          "watch",
          "watched",
          "watcher",
          "watchers",
          "watching",
          "unwatch",
          "unwatched",
          "unstar",
          "unstarred",
          "starring",
          "unsuspend",
          "unsuspension",
          "uninstall",
          "uninstallation",
          "view",
          "views",
          "workflow",
        ].includes(token),
    );
    if (tokens.length > 0) return target;
  }
  return null;
}

function elementControlText(element: TaggedElement): string {
  return [
    element.text,
    element.attributes.label,
    element.attributes["aria-label"],
    element.attributes.title,
    element.attributes.name,
    element.attributes.id,
    element.attributes.value,
  ]
    .filter(Boolean)
    .join(" ");
}

function snapshotContainsNormalizedText(
  snapshot: DomSnapshot,
  normalizedNeedle: string,
): boolean {
  if (!normalizedNeedle) return false;
  return normalizeText(
    [
      snapshot.title,
      snapshot.visibleContent,
      snapshot.pageContent,
      ...snapshot.elements.flatMap((element) => [
        element.text,
        element.attributes.label,
        element.attributes["aria-label"],
        element.attributes.title,
        element.attributes.name,
        element.attributes.id,
        element.attributes.value,
      ]),
    ]
      .filter(Boolean)
      .join(" "),
  ).includes(normalizedNeedle);
}

function isDismissalControl(element: TaggedElement): boolean {
  const text = normalizeText(elementControlText(element));
  if (!text) return false;
  return /\b(?:close|dismiss|no thanks|not now|cancel|got it|ok|okay|done|hide|skip|continue)\b/i.test(
    text,
  );
}

function findModalLikeDescriptors(snapshot: DomSnapshot): Array<{
  key: string;
  label: string;
}> {
  const descriptors: Array<{ key: string; label: string }> = [];
  const overlayTagIds = new Set(
    snapshot.survivingOverlays?.map((overlay) => overlay.tagId) ?? [],
  );

  for (const element of snapshot.elements) {
    if (!element.isVisible) continue;
    const role = normalizeText(element.role || "");
    const tagName = normalizeText(element.tagName || "");
    const attrs = element.attributes;
    const attrText = normalizeText(
      [
        attrs.role,
        attrs["aria-modal"],
        attrs["aria-label"],
        attrs.label,
        attrs.id,
        attrs.name,
        attrs.class,
        element.text,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const isSemanticDialog =
      role === "dialog" ||
      role === "alertdialog" ||
      tagName === "dialog" ||
      attrs["aria-modal"] === "true";
    const isKnownOverlay = overlayTagIds.has(element.tag);
    const isActionControl =
      role === "button" ||
      role === "link" ||
      tagName === "button" ||
      tagName === "a" ||
      tagName === "input";
    const isNamedModal =
      !isActionControl &&
      /\b(?:modal|dialog|popup|pop-up|overlay|banner|toast|notice|alert)\b/i.test(
        attrText,
      ) && (element.rect.width > 0 || element.rect.height > 0);

    if (!isSemanticDialog && !isKnownOverlay && !isNamedModal) continue;

    const label = cleanLabel(
      [
        element.text,
        attrs["aria-label"],
        attrs.label,
        attrs.name,
        attrs.id,
      ]
        .filter(Boolean)
        .join(" "),
    );
    descriptors.push({
      key:
        compactKey(
          [
            role || tagName,
            attrs.id,
            attrs.name,
            attrs["aria-label"],
            element.text,
          ]
            .filter(Boolean)
            .join(" "),
        ) || `tag-${element.tag}`,
      label: label || role || tagName || `overlay ${element.tag}`,
    });
  }

  if (descriptors.length === 0) {
    for (const overlay of snapshot.survivingOverlays ?? []) {
      descriptors.push({
        key: `overlay-${overlay.tagId}`,
        label: `overlay ${overlay.tagId}`,
      });
    }
  }

  return descriptors;
}

function samePageUrl(before: string, after: string): boolean {
  if (!before || !after) return before === after;
  try {
    const beforeUrl = new URL(before);
    const afterUrl = new URL(after);
    return (
      beforeUrl.origin === afterUrl.origin &&
      beforeUrl.pathname === afterUrl.pathname &&
      beforeUrl.search === afterUrl.search
    );
  } catch {
    return before === after;
  }
}

function extractNavigationEvidence(
  snapshot: DomSnapshot,
  turn: number,
): CompletionEvidence[] {
  return navigationStateEvidence(snapshot, turn);
}

function getChoiceKind(element: TaggedElement): ChoiceKind | null {
  const type = normalizeText(element.attributes.type || "");
  const role = normalizeText(element.role || "");
  if (type === "checkbox" || role === "checkbox") return "checkbox";
  if (type === "radio" || role === "radio") return "radio";
  return null;
}

function choiceStableKey(element: TaggedElement): string {
  return (
    element.attributes.control ||
    element.attributes.id ||
    element.attributes.name ||
    `tag:${element.tag}`
  );
}

function readChecked(element: TaggedElement): boolean | null {
  const checked =
    element.attributes.checked ??
    element.attributes["aria-checked"] ??
    element.attributes.selected;
  if (checked == null) return null;
  if (/^(?:true|checked|selected|1)$/i.test(checked)) return true;
  if (/^(?:false|0)$/i.test(checked)) return false;
  return null;
}

function readControlState(element: TaggedElement): boolean | null {
  const state =
    element.attributes.checked ??
    element.attributes["aria-checked"] ??
    element.attributes["aria-pressed"];
  if (state == null) return null;
  if (/^(?:true|checked|pressed|selected|1)$/i.test(state)) return true;
  if (/^(?:false|0)$/i.test(state)) return false;
  return null;
}

function bestChoiceLabel(
  element: TaggedElement,
  associated?: string,
): string {
  const candidates = [
    associated,
    element.attributes.label,
    element.text,
    element.attributes["aria-label"],
    element.attributes.name,
    element.attributes.value,
  ];
  return (
    candidates
      .map((value) => cleanLabel(value ?? ""))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] ?? ""
  );
}

function inferSelectionCardinality(
  snapshot: DomSnapshot,
): number | "one_or_more" | undefined {
  const text = snapshotText(snapshot);
  if (/\bselect\s+all\s+that\s+apply\b/i.test(text)) return "one_or_more";
  const numeric = text.match(/\bselect\s+(?:the\s+)?(\d)\b/i)?.[1];
  if (numeric) return Number(numeric);
  const word = text.match(
    /\bselect\s+(?:the\s+)?(one|two|three|four|five|six)\b/i,
  )?.[1];
  return word ? NUMBER_WORDS.get(word.toLowerCase()) : undefined;
}

function extractVisibleQuestionNumber(
  snapshot: DomSnapshot | null | undefined,
): number | undefined {
  if (!snapshot) return undefined;
  return extractExplicitQuestionNumber(snapshotText(snapshot));
}

function extractExplicitQuestionNumber(text: string): number | undefined {
  const question = /\bquestion\s*#?\s*(\d{1,4})\b/i.exec(text)?.[1];
  if (question) return Number(question);
  const fraction = /\b(\d{1,4})\s*\/\s*\d{1,4}\b/.exec(text)?.[1];
  return fraction ? Number(fraction) : undefined;
}

function hasQuizSelectionIntent(text: string): boolean {
  return (
    /\b(?:select|choose|pick|answer|option|what should i choose)\b/i.test(
      text,
    ) && /\b(?:correct|answer|option|quiz|question|choice)\b/i.test(text)
  );
}

function matchesQuizTarget(
  event: Extract<CompletionEvidence, { type: "selected_state" }>,
  contract: QuizSelectionContract,
  visibleQuestionNumber: number | undefined,
): boolean {
  const eventQuestion = event.detail.questionNumber ?? visibleQuestionNumber;
  if (contract.target.kind === "current_visible_question") {
    return (
      contract.target.questionNumber == null ||
      eventQuestion == null ||
      eventQuestion === contract.target.questionNumber
    );
  }
  return eventQuestion === contract.target.questionNumber;
}

function matchesFeedbackTarget(
  event: Extract<CompletionEvidence, { type: "correct_feedback" }>,
  contract: QuizSelectionContract,
  visibleQuestionNumber: number | undefined,
): boolean {
  const eventQuestion = event.detail.questionNumber ?? visibleQuestionNumber;
  if (contract.target.kind === "current_visible_question") {
    return (
      contract.target.questionNumber == null ||
      eventQuestion == null ||
      eventQuestion === contract.target.questionNumber
    );
  }
  return eventQuestion === contract.target.questionNumber;
}

function expectedSelectionsMatch(
  expectedSelections: string[],
  selected: Array<Extract<CompletionEvidence, { type: "selected_state" }>>,
): boolean {
  const selectedText = normalizeText(
    selected.map((event) => event.detail.label).join("\n"),
  );
  return expectedSelections.every((expected) =>
    importantLabelTokens(expected).some((token) => selectedText.includes(token)),
  );
}

function selectedLabelsCoveredBySummary(
  selected: Array<Extract<CompletionEvidence, { type: "selected_state" }>>,
  summary: string,
): boolean {
  const summaryText = normalizeText(summary);
  return selected.every((event) =>
    importantLabelTokens(event.detail.label).some((token) =>
      summaryText.includes(token),
    ),
  );
}

function matchesExpectedField(
  event: Extract<CompletionEvidence, { type: "field_value" }>,
  expected: FormFillFieldExpectation,
): boolean {
  if (
    expected.elementId != null &&
    event.detail.elementId === expected.elementId
  ) {
    return true;
  }
  if (
    expected.stableKey &&
    event.detail.stableKey &&
    expected.stableKey === event.detail.stableKey
  ) {
    return true;
  }
  const observedLabel = compactKey(event.detail.label);
  const expectedLabel = compactKey(expected.label);
  if (observedLabel && observedLabel === expectedLabel) return true;

  const observedTokens = importantLabelTokens(event.detail.label);
  const expectedTokens = importantLabelTokens(expected.label);
  return (
    observedTokens.length > 0 &&
    expectedTokens.length > 0 &&
    expectedTokens.every((token) => observedTokens.includes(token))
  );
}

function formValueMatches(observed: string, expected: string): boolean {
  const expectedBoolean = parseBooleanLike(expected);
  if (expectedBoolean != null) {
    return parseBooleanLike(observed) === expectedBoolean;
  }

  const observedText = normalizeText(observed.replace(/^["']|["']$/g, ""));
  const expectedText = normalizeText(expected.replace(/^["']|["']$/g, ""));
  if (!expectedText) return observedText === "";
  return (
    observedText === expectedText ||
    (expectedText.length >= 3 && observedText.includes(expectedText))
  );
}

function parseBooleanLike(value: string): boolean | null {
  const text = normalizeText(value);
  if (/^(?:true|yes|on|checked|selected|enabled|1)$/.test(text)) return true;
  if (
    /^(?:false|no|off|unchecked|unselected|disabled|0|)$/.test(text)
  ) {
    return false;
  }
  return null;
}

function compareEvidenceRecency(
  a: CompletionEvidence,
  b: CompletionEvidence,
): number {
  return (
    b.observedAtTurn - a.observedAtTurn ||
    evidenceConfidenceRank(b) - evidenceConfidenceRank(a)
  );
}

function latestObservedTurn(evidence: CompletionEvidence[]): number {
  return evidence.reduce(
    (latest, event) => Math.max(latest, event.observedAtTurn),
    0,
  );
}

function importantLabelTokens(label: string): string[] {
  return [
    ...new Set(
      normalizeText(label)
        .match(/[a-z0-9][a-z0-9-]{3,}/g)
        ?.filter((token) => !LABEL_STOPWORDS.has(token))
        .slice(0, 12) ?? [],
    ),
  ];
}

function snapshotText(snapshot: DomSnapshot): string {
  return [
    snapshot.title,
    snapshot.url,
    snapshot.visibleContent,
    snapshot.pageContent,
    ...snapshot.elements.map((element) =>
      [
        element.text,
        element.attributes.label,
        element.attributes["aria-label"],
        element.attributes.name,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

function extractNavigationTarget(value: string): URL | null {
  const explicitUrl =
    value.match(/\bhttps?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[),.;]+$/g, "") ??
    null;
  if (explicitUrl) return parseNavigationTarget(explicitUrl);

  const domain =
    value
      .match(
        /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|ai|app|dev|test|local|co|uk|de|fr|ca|us)\b(?:\/[^\s"'<>]*)?/i,
      )?.[0]
      ?.replace(/[),.;]+$/g, "") ?? null;
  return domain ? parseNavigationTarget(`https://${domain}`) : null;
}

function parseNavigationTarget(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function navigationTargetMatches(
  current: URL,
  contract: NavigationContract,
): boolean {
  if (current.host.toLowerCase() !== contract.targetHost.toLowerCase()) {
    return false;
  }

  const target = parseNavigationTarget(contract.targetUrl);
  if (!target) return false;
  const targetPath = normalizeNavigationPath(target);
  if (targetPath === "/") return true;
  return normalizeNavigationPath(current) === targetPath;
}

function normalizeNavigationPath(url: URL): string {
  const path = url.pathname.replace(/\/+$/g, "") || "/";
  const search = url.searchParams.toString();
  return search ? `${path}?${search}` : path;
}

function hasPageReadAnswerIntent(
  text: string,
  snapshot?: DomSnapshot | null,
): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const trivialPageQuestions = [
    /\bwhat(?:'s| is) the title\b/,
    /\bwhat(?:'s| is) the url\b/,
    /\bwhat page is this\b/,
    /\bwhich page is this\b/,
    /\bwhat site is this\b/,
    /\bwhat domain is this\b/,
  ];
  if (trivialPageQuestions.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const chartValueExtraction =
    /\b(chart|dashboard|graph|plot|highcharts|visualization)\b/.test(
      normalized,
    ) &&
    /\b(value|count|percentage|percent|number|label|maximum|minimum|highest|lowest|largest|smallest)\b/.test(
      normalized,
    );
  const wholePageReadIntent = [
    /\bsummari[sz]e\b/,
    /\bsummary\b/,
    /\bdescribe (?:this|the) page\b/,
    /\breport (?:on|about) (?:this|the) page\b/,
    /\breview (?:this|the) page\b/,
    /\bmain points?\b/,
    /\bkey points?\b/,
    /\bheadlines?\b/,
    /\bwhat does (?:this|the) page say\b/,
    /\bread (?:this|the) page\b/,
    /\b(article|post|document|readme|page content)\b.+\b(summarize|summary|describe|report|extract)\b/,
  ].some((pattern) => pattern.test(normalized));
  if (chartValueExtraction && !wholePageReadIntent) return false;

  const pageReadTasks = [
    /\bsummari[sz]e\b/,
    /\bsummary\b/,
    /\bdescribe (?:this|the) page\b/,
    /\breport (?:on|about) (?:this|the) page\b/,
    /\breview (?:this|the) page\b/,
    /\bextract\b.+\b(page|article|post|document|readme|content)\b/,
    /\b(?:find|identify|locate|tell me|what(?:'s| is))\b.{0,120}\b(?:source|reference|citation)\b.{0,50}\b(?:referenced|cited|cites?)\b.{0,120}\b(?:article|document|page|post|readme)\b/,
    /\b(?:find|identify|locate|tell me|what(?:'s| is))\b.{0,120}\bfootnote\b.{0,120}\b(?:article|document|page|post|readme)\b/,
    /\bmain points?\b/,
    /\bkey points?\b/,
    /\bheadlines?\b/,
    /\bwhat does (?:this|the) page say\b/,
    /\b(?:what(?:'s| is)|who(?:'s| is)|when|where|which|how many|how much|tell me|find|identify|locate)\b.{0,140}\b(?:on|in|according to) (?:this|the) (?:page|article|document|post|readme)\b/,
    /\b(?:on|in|according to) (?:this|the) (?:page|article|document|post|readme)\b.{0,140}\b(?:what(?:'s| is)|who(?:'s| is)|when|where|which|how many|how much)\b/,
    /\bread (?:this|the) page\b/,
    /\bfrom (?:this|the) page\b/,
    /\b(article|post|document|readme|page content)\b.+\b(summarize|summary|describe|report|extract)\b/,
  ];

  if (pageReadTasks.some((pattern) => pattern.test(normalized))) return true;

  return hasGroundedDirectPageQuestion(normalized, snapshot);
}

const DIRECT_PAGE_QUESTION_STOPWORDS = new Set([
  ...LABEL_STOPWORDS,
  "about",
  "according",
  "answer",
  "current",
  "does",
  "existing",
  "from",
  "give",
  "how",
  "latest",
  "many",
  "much",
  "my",
  "our",
  "page",
  "please",
  "tell",
  "what",
  "whats",
  "when",
  "where",
  "which",
  "who",
  "whose",
  "your",
]);

const EXPLANATORY_LABEL_VALUE_START_WORDS = new Set([
  "available",
  "covered",
  "described",
  "documented",
  "explained",
  "included",
  "listed",
  "mentioned",
  "provided",
  "shown",
  "specified",
  "visible",
]);

function hasGroundedDirectPageQuestion(
  normalizedQuestion: string,
  snapshot?: DomSnapshot | null,
): boolean {
  if (!snapshot) return false;
  const hasBroadQuestionStarter =
    /\b(?:what(?:'s| is)?|who(?:'s| is)?|when|where|which|how many|how much)\b/.test(
      normalizedQuestion,
    );
  const hasBooleanLabelQuestionStarter =
    /^(?:please\s+)?(?:is|are|was|were)\b/.test(normalizedQuestion);
  if (!hasBroadQuestionStarter && !hasBooleanLabelQuestionStarter) {
    return false;
  }

  const pageText = snapshotPageText(snapshot);
  if (!hasSubstantiveReadAnswerEvidence(pageText)) return false;
  if (findGroundedLabelValueQuestionLabel(normalizedQuestion, pageText)) {
    return true;
  }
  if (hasBooleanLabelQuestionStarter) return false;

  const questionTokens = tokenizeCompletionText(normalizedQuestion).filter(
    (token) => !DIRECT_PAGE_QUESTION_STOPWORDS.has(token),
  );
  if (questionTokens.length < 2) return false;

  const pageTokens = new Set(tokenizeCompletionText(pageText));
  const overlap = questionTokens.filter((token) => pageTokens.has(token));
  return overlap.length >= Math.min(3, questionTokens.length);
}

function getGroundedLabelValueQuestionLabel(
  question: string,
  snapshot?: DomSnapshot | null,
): string | null {
  if (!snapshot) return null;
  const pageText = snapshotPageText(snapshot);
  if (!hasSubstantiveReadAnswerEvidence(pageText)) return null;
  return findGroundedLabelValueQuestionLabel(normalizeText(question), pageText);
}

function findGroundedLabelValueQuestionLabel(
  normalizedQuestion: string,
  pageText: string,
): string | null {
  const label = extractDirectQuestionLabel(normalizedQuestion);
  if (!label) return null;

  const labelTokens = tokenizeLabelValueQuestionLabel(label);
  if (labelTokens.length < 1 || labelTokens.length > 3) return null;

  const labelPattern = labelTokens.map(escapeRegExp).join("\\s+");
  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:([:=-])|\\b(is)\\b)\\s*([^.;\\n]{1,160})`,
    "i",
  ).exec(pageText);
  if (!match) return null;
  if (
    labelValueSeparatorNeedsAnswerShape(match[1], match[2]) &&
    !labelValueLooksAnswerLike(match[3] ?? "")
  ) {
    return null;
  }
  return cleanLabel(labelTokens.join(" "));
}

function tokenizeLabelValueQuestionLabel(label: string): string[] {
  return [
    ...new Set(normalizeText(label).match(/[a-z0-9$@._-]+/g) ?? []),
  ].filter(
    (token) =>
      (token.length >= 3 || token === "id") &&
      !DIRECT_PAGE_QUESTION_STOPWORDS.has(token),
  );
}

function labelValueSeparatorNeedsAnswerShape(
  symbolSeparator?: string,
  wordSeparator?: string,
): boolean {
  return symbolSeparator === "-" || normalizeText(wordSeparator ?? "") === "is";
}

function labelValueLooksAnswerLike(value: string): boolean {
  const tokens = tokenizeCompletionText(value);
  if (tokens.length === 0) return false;
  return !EXPLANATORY_LABEL_VALUE_START_WORDS.has(tokens[0]);
}

function extractDirectQuestionLabel(normalizedQuestion: string): string | null {
  const match =
    /^(?:please\s+)?(?:tell me\s+)?(?:what(?:'s| is| are)|who(?:'s| is)|when|where|which|how many|how much)\s+(?:is|are|was|were)?\s*(?:the\s+)?(.+?)(?:\?|$)/i.exec(
      normalizedQuestion,
    );
  const booleanMatch =
    /^(?:please\s+)?(?:is|are|was|were)\s+(?:the\s+)?(.+?)(?:\?|$)/i.exec(
      normalizedQuestion,
    );
  const label = cleanLabel(
    (match?.[1] ?? booleanMatch?.[1])
      ?.replace(
        /\b(?:on|in|according to|from) (?:this|the) (?:page|article|document|post|readme)\b.*$/i,
        "",
      )
      .replace(/\b(?:is|are|was|were)\s+there$/i, "")
      .replace(/^(?:total\s+)?(?:number|count|quantity)\s+of\s+/i, "")
      .replace(/[?.!]+$/g, "") ?? "",
  );
  return label || null;
}

function snapshotPageText(snapshot: DomSnapshot): string {
  return cleanLabel(
    [snapshot.pageContent, snapshot.visibleContent].filter(Boolean).join(" "),
  );
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

function cleanReadAnswerEvidenceText(value: string): string {
  return cleanLabel(
    value
      .replace(/^Page\s+(?:content|text|read)\s*:\s*/i, "")
      .replace(/^Result\s*:\s*/i, ""),
  );
}

function hasSubstantiveReadAnswerEvidence(value: string): boolean {
  return tokenizeCompletionText(value).length >= 12 && cleanLabel(value).length > 100;
}

function readAnswerSummaryGroundedInEvidence(
  summary: string,
  evidence: Extract<CompletionEvidence, { type: "answer_state" }>,
  expectedAnswerLabel?: string,
): boolean {
  if (
    expectedAnswerLabel
  ) {
    return readAnswerSummaryMatchesExpectedLabelValue(
      summary,
      evidence.detail.evidenceText,
      expectedAnswerLabel,
    );
  }

  const sourceTokens = new Set(
    tokenizeCompletionText(evidence.detail.evidenceText),
  );
  if (sourceTokens.size < 12) return false;

  const summaryTokens = tokenizeCompletionText(summary);
  if (summaryTokens.length < 4) return false;
  const overlap = new Set(
    summaryTokens.filter((token) => sourceTokens.has(token)),
  ).size;
  const requiredOverlap = Math.min(
    5,
    Math.max(3, Math.ceil(summaryTokens.length * 0.25)),
  );
  return overlap >= requiredOverlap;
}

function readAnswerSummaryMatchesExpectedLabelValue(
  summary: string,
  evidenceText: string,
  expectedAnswerLabel: string,
): boolean {
  const labelTokens = tokenizeLabelValueQuestionLabel(expectedAnswerLabel);
  if (labelTokens.length < 1 || labelTokens.length > 3) return false;

  const labelPattern = labelTokens.map(escapeRegExp).join("\\s+");
  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:([:=-])|\\b(is)\\b)\\s*([^.;\\n]{1,160})`,
    "i",
  ).exec(evidenceText);
  if (
    match &&
    labelValueSeparatorNeedsAnswerShape(match[1], match[2]) &&
    !labelValueLooksAnswerLike(match[3] ?? "")
  ) {
    return false;
  }
  if (
    !labelCanHaveCoordinatePairValue(expectedAnswerLabel) &&
    labelValueStartsWithCoordinatePair(evidenceText, labelPattern)
  ) {
    return false;
  }
  if (
    !labelCanHaveDateRangeValue(expectedAnswerLabel) &&
    labelValueStartsWithDateRange(evidenceText, labelPattern)
  ) {
    return false;
  }
  const rawValue = cleanLabel(match?.[3] ?? "");
  if (!rawValue) return false;
  if (
    !labelCanHaveColorValue(expectedAnswerLabel) &&
    /\b(?:rgba?|hsla?)\s*\(/i.test(rawValue)
  ) {
    return false;
  }
  if (
    !labelCanHaveCoordinatePairValue(expectedAnswerLabel) &&
    isCoordinatePairValue(rawValue)
  ) {
    return false;
  }
  if (
    !labelCanHaveDateRangeValue(expectedAnswerLabel) &&
    isDateRangeValue(rawValue)
  ) {
    return false;
  }

  const valueWords = rawValue.split(/\s+/).filter(Boolean);
  if (valueWords.length === 0) return false;

  const normalizedSummary = normalizeText(summary);
  const preciseConciseValue = extractPreciseConciseLabelValue(
    evidenceText,
    labelPattern,
    expectedAnswerLabel,
  );
  if (preciseConciseValue) {
    if (isMacAddressValue(preciseConciseValue)) {
      return preciseMacAddressValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isIpv6AddressValue(preciseConciseValue)) {
      return preciseIpv6ValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isIpv6CidrValue(preciseConciseValue)) {
      return preciseIpv6CidrValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isCidrValue(preciseConciseValue)) {
      return preciseCidrValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isPathValue(preciseConciseValue)) {
      return precisePathValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDomainNameValue(preciseConciseValue)) {
      return preciseDomainValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDottedVersionValue(preciseConciseValue)) {
      return preciseVersionValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isHashValue(preciseConciseValue)) {
      return preciseHashValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isHexColorValue(preciseConciseValue)) {
      return preciseHexColorValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isCssRgbColorValue(preciseConciseValue)) {
      return preciseCssRgbColorValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isCssHslColorValue(preciseConciseValue)) {
      return preciseCssHslColorValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isCssNamedColorValue(preciseConciseValue)) {
      return preciseCssNamedColorValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDurationValue(preciseConciseValue)) {
      return preciseDurationValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDataSizeValue(preciseConciseValue)) {
      return preciseDataSizeValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDataRateValue(preciseConciseValue)) {
      return preciseDataRateValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isPhysicalSpeedValue(preciseConciseValue)) {
      return precisePhysicalSpeedValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isTemperatureValue(preciseConciseValue)) {
      return preciseTemperatureValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isElectricalValue(preciseConciseValue)) {
      return preciseElectricalValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isMassValue(preciseConciseValue)) {
      return preciseMassValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isLengthValue(preciseConciseValue)) {
      return preciseLengthValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isAreaValue(preciseConciseValue)) {
      return preciseAreaValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isVolumeValue(preciseConciseValue)) {
      return preciseVolumeValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isPressureValue(preciseConciseValue)) {
      return precisePressureValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isFrequencyValue(preciseConciseValue)) {
      return preciseFrequencyValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isDateRangeValue(preciseConciseValue)) {
      return preciseDateRangeValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isTimeRangeValue(preciseConciseValue)) {
      return preciseTimeRangeValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isTimezoneValue(preciseConciseValue)) {
      return preciseTimezoneValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isLocaleCodeValue(preciseConciseValue)) {
      return preciseLocaleCodeValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    if (isCoordinatePairValue(preciseConciseValue)) {
      return preciseCoordinatePairValueCoveredBySummary(
        normalizedSummary,
        normalizeText(preciseConciseValue),
      );
    }
    return valueTokenCoveredBySummary(
      normalizedSummary,
      normalizeText(preciseConciseValue),
    );
  }

  if (valueWords.length >= 2) {
    return labelValuePhraseCoveredBySummary(normalizedSummary, valueWords);
  }

  const normalizedValue = normalizeText(valueWords[0]);
  if (isIdentifierCodeValue(rawValue)) {
    return preciseIdentifierCodeValueCoveredBySummary(
      normalizedSummary,
      normalizedValue,
    );
  }
  if (
    (isConciseSingleTokenLabelValue(rawValue) ||
      isConcisePriorityLabelValue(rawValue, expectedAnswerLabel)) &&
    valueTokenCoveredBySummary(normalizedSummary, normalizedValue)
  ) {
    return true;
  }

  const normalizedLabel = normalizeText(expectedAnswerLabel);
  return (
    normalizedSummary.includes(normalizedLabel) &&
    normalizedSummary.includes(normalizedValue)
  );
}

function labelValuePhraseCoveredBySummary(
  normalizedSummary: string,
  valueWords: string[],
): boolean {
  const requiredWords =
    valueWords.length <= 4 ? valueWords : valueWords.slice(0, 2);
  const phrase = normalizeText(requiredWords.join(" "));
  if (!phrase) return false;
  if (valueWords.length > 4) return normalizedSummary.includes(phrase);
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(phrase)}(?=$|[.,;:!?)]|\\s+(?:and|are|as|for|from|in|is|on|was|were|with)\\b)`,
  ).test(normalizedSummary);
}

function labelValueStartsWithCoordinatePair(
  evidenceText: string,
  labelPattern: string,
): boolean {
  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(\\(?\\s*[+-]?(?:(?:[0-8]?\\d)(?:\\.\\d+)?|90(?:\\.0+)?)\\s*,\\s*[+-]?(?:(?:(?:[0-9]?\\d)|(?:1[0-7]\\d))(?:\\.\\d+)?|180(?:\\.0+)?)\\s*\\)?)`,
    "i",
  ).exec(evidenceText);
  const candidate = cleanLabel(match?.[1] ?? "");
  return candidate ? isCoordinatePairValue(candidate) : false;
}

function labelValueStartsWithDateRange(
  evidenceText: string,
  labelPattern: string,
): boolean {
  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${dateRangeValuePattern()})`,
    "i",
  ).exec(evidenceText);
  const candidate = cleanLabel(match?.[1] ?? "");
  return candidate ? isDateRangeValue(candidate) : false;
}

function extractPreciseConciseLabelValue(
  evidenceText: string,
  labelPattern: string,
  expectedAnswerLabel: string,
): string | null {
  const urlMatch = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(https?:\\/\\/[^\\s<>"']+)`,
    "i",
  ).exec(evidenceText);
  if (urlMatch) {
    return cleanLabel((urlMatch[1] ?? "").replace(/[),.;!?]+$/g, "")) || null;
  }

  if (labelCanHavePathValue(expectedAnswerLabel)) {
    const uncPathMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(\\\\\\\\[^\\s,;!)]{1,160})(?=$|[\\s,;!)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (uncPathMatch) {
      return (
        cleanLabel(
          (uncPathMatch[1] ?? "")
            .replace(/[),;!?]+$/g, "")
            .replace(/\.$/g, ""),
        ) || null
      );
    }

    const windowsPathMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z]:\\\\[^\\s,;!)]{1,160})(?=$|[\\s,;!)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (windowsPathMatch) {
      return (
        cleanLabel(
          (windowsPathMatch[1] ?? "")
            .replace(/[),;!?]+$/g, "")
            .replace(/\.$/g, ""),
        ) || null
      );
    }

    const pathMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\.{1,2})?\\/[^\\s,;!)]{1,160})(?=$|[\\s,;!)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (pathMatch) {
      return (
        cleanLabel((pathMatch[1] ?? "").replace(/[),;!?]+$/g, "").replace(/\.$/g, "")) ||
        null
      );
    }
  }

  const emailMatch = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
    "i",
  ).exec(evidenceText);
  if (emailMatch) return cleanLabel(emailMatch[1] ?? "") || null;

  const phoneMatch = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:\\+?\\d{1,3}[\\s.-]?)?(?:\\(?\\d{3}\\)?[\\s.-]?)\\d{3}[\\s.-]?\\d{4}(?:\\s*(?:x|ext\\.?|extension)\\s*\\d{1,6})?)`,
    "i",
  ).exec(evidenceText);
  if (phoneMatch) return cleanLabel(phoneMatch[1] ?? "") || null;

  const ipv4Octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  if (labelCanHaveCidrValue(expectedAnswerLabel)) {
    const cidrMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}\\/(?:[0-9]|[12][0-9]|3[0-2]))(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (cidrMatch) return cleanLabel(cidrMatch[1] ?? "") || null;
  }

  const ipv4Match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet})(?=$|[^\\d./])`,
    "i",
  ).exec(evidenceText);
  if (ipv4Match) return cleanLabel(ipv4Match[1] ?? "") || null;

  if (labelCanHaveMacAddressValue(expectedAnswerLabel)) {
    const macAddressMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (macAddressMatch) return cleanLabel(macAddressMatch[1] ?? "") || null;
  }

  if (
    labelCanHaveIpv6AddressValue(expectedAnswerLabel) ||
    labelCanHaveCidrValue(expectedAnswerLabel)
  ) {
    const ipv6CidrMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?:%[a-z0-9_.-]+)?\\/(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const ipv6CidrCandidate = cleanLabel(ipv6CidrMatch?.[1] ?? "");
    if (ipv6CidrCandidate && isIpv6CidrValue(ipv6CidrCandidate)) {
      return ipv6CidrCandidate;
    }
  }

  if (labelCanHaveIpv6AddressValue(expectedAnswerLabel)) {
    const ipv6Match = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?:%[a-z0-9_.-]+)?)(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(ipv6Match?.[1] ?? "");
    if (candidate && isIpv6AddressValue(candidate)) return candidate;
  }

  if (labelCanHaveDomainValue(expectedAnswerLabel)) {
    const domainMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (domainMatch) return cleanLabel(domainMatch[1] ?? "") || null;
  }

  if (labelCanHaveUuidValue(expectedAnswerLabel)) {
    const uuidMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (uuidMatch) return cleanLabel(uuidMatch[1] ?? "") || null;
  }

  if (labelCanHaveHashValue(expectedAnswerLabel)) {
    const hashMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-f0-9]{128}|[a-f0-9]{96}|[a-f0-9]{64}|[a-f0-9]{56}|[a-f0-9]{40}|[a-f0-9]{32})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (hashMatch) return cleanLabel(hashMatch[1] ?? "") || null;
  }

  if (labelCanHaveColorValue(expectedAnswerLabel)) {
    const colorMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(#[a-f0-9]{3}(?:[a-f0-9]{3})?(?:[a-f0-9]{2})?)(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (colorMatch) return cleanLabel(colorMatch[1] ?? "") || null;

    const rgbChannel = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
    const rgbAlpha = "(?:0(?:\\.\\d+)?|1(?:\\.0+)?|\\.\\d+|(?:[1-9]\\d?|100)%)";
    const rgbMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:rgba?|RGBA?)\\(\\s*${rgbChannel}\\s*,\\s*${rgbChannel}\\s*,\\s*${rgbChannel}(?:\\s*,\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (rgbMatch) return cleanLabel(rgbMatch[1] ?? "") || null;
    const modernRgbMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:rgba?|RGBA?)\\(\\s*${rgbChannel}\\s+${rgbChannel}\\s+${rgbChannel}(?:\\s*\\/\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (modernRgbMatch) {
      return cleanLabel(modernRgbMatch[1] ?? "") || null;
    }

    const hslHue = "(?:360|3[0-5]\\d|[12]?\\d?\\d)";
    const hslPercent = "(?:100|[1-9]?\\d)%";
    const hslMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:hsla?|HSLA?)\\(\\s*${hslHue}\\s*,\\s*${hslPercent}\\s*,\\s*${hslPercent}(?:\\s*,\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (hslMatch) return cleanLabel(hslMatch[1] ?? "") || null;
    const modernHslMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:hsla?|HSLA?)\\(\\s*${hslHue}\\s+${hslPercent}\\s+${hslPercent}(?:\\s*\\/\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (modernHslMatch) {
      return cleanLabel(modernHslMatch[1] ?? "") || null;
    }

    const namedColorMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z][a-z]+)(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const namedColor = cleanLabel(namedColorMatch?.[1] ?? "");
    if (isCssNamedColorValue(namedColor)) return namedColor;
  }

  if (/\b(?:version|build|release|revision|rev)\b/i.test(expectedAnswerLabel)) {
    const versionMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:v(?:ersion)?\\s*)?\\d+(?:\\.\\d+){1,5}(?:[-+][a-z0-9][a-z0-9.-]*)?)(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (versionMatch) return cleanLabel(versionMatch[1] ?? "") || null;
  }

  if (labelCanHaveDurationValue(expectedAnswerLabel)) {
    const durationMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:ms|msec|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (durationMatch) return cleanLabel(durationMatch[1] ?? "") || null;
  }

  if (labelCanHaveDataSizeValue(expectedAnswerLabel)) {
    const dataSizeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib|pb|pib))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (dataSizeMatch) return cleanLabel(dataSizeMatch[1] ?? "") || null;
  }

  if (labelCanHaveDataRateValue(expectedAnswerLabel)) {
    const dataRateMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:bps|kbps|mbps|gbps|tbps|kbit\\/s|mbit\\/s|gbit\\/s|tbit\\/s|kb\\/s|kib\\/s|mb\\/s|mib\\/s|gb\\/s|gib\\/s|tb\\/s|tib\\/s|bytes?\\/s|bytes?\\s+per\\s+second))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (dataRateMatch) return cleanLabel(dataRateMatch[1] ?? "") || null;
  }

  if (labelCanHavePhysicalSpeedValue(expectedAnswerLabel)) {
    const physicalSpeedMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mph|mi\\/h|kph|kmph|km\\/h|m\\/s|meters?\\s+per\\s+second|metres?\\s+per\\s+second|ft\\/s|feet\\s+per\\s+second|knots?|kt|kts))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (physicalSpeedMatch) {
      return cleanLabel(physicalSpeedMatch[1] ?? "") || null;
    }
  }

  if (labelCanHaveTemperatureValue(expectedAnswerLabel)) {
    const temperatureMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*[+-]?\\d+(?:\\.\\d+)?\\s*(?:\\u00b0\\s*)?(?:c|f|k|celsius|fahrenheit|kelvin))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (temperatureMatch) return cleanLabel(temperatureMatch[1] ?? "") || null;
  }

  if (labelCanHaveElectricalValue(expectedAnswerLabel)) {
    const electricalMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mv|v|kv|ma|a|ka|mw|w|kw|wh|kwh|mwh|va|kva|mah|ah))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (electricalMatch) return cleanLabel(electricalMatch[1] ?? "") || null;
  }

  if (labelCanHaveMassValue(expectedAnswerLabel)) {
    const massMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mg|milligrams?|g|grams?|kg|kgs|kilograms?|lb|lbs|pounds?|oz|ounces?|tons?|tonnes?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (massMatch) return cleanLabel(massMatch[1] ?? "") || null;
  }

  if (labelCanHaveLengthValue(expectedAnswerLabel)) {
    const lengthMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mm|millimeters?|millimetres?|cm|centimeters?|centimetres?|m|meters?|metres?|km|kilometers?|kilometres?|in|inch|inches|ft|foot|feet|yd|yards?|mi|miles?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (lengthMatch) return cleanLabel(lengthMatch[1] ?? "") || null;
  }

  if (labelCanHaveAreaValue(expectedAnswerLabel)) {
    const areaMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mm2|cm2|m2|km2|in2|ft2|yd2|mi2|sq\\.?\\s*(?:mm|cm|m|km|in|ft|feet|yd|mi)|square\\s+(?:millimeters?|millimetres?|centimeters?|centimetres?|meters?|metres?|kilometers?|kilometres?|inches|feet|yards?|miles?)|acres?|hectares?|ha))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (areaMatch) return cleanLabel(areaMatch[1] ?? "") || null;
  }

  if (labelCanHaveVolumeValue(expectedAnswerLabel)) {
    const volumeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:ml|milliliters?|millilitres?|l|liters?|litres?|gal|gallons?|qt|quarts?|pt|pints?|fl\\s*oz|fluid\\s+ounces?|m3|cm3|cubic\\s+meters?|cubic\\s+metres?|cubic\\s+centimeters?|cubic\\s+centimetres?|cu\\s*ft|cubic\\s+feet))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (volumeMatch) return cleanLabel(volumeMatch[1] ?? "") || null;
  }

  if (labelCanHavePressureValue(expectedAnswerLabel)) {
    const pressureMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:pa|kpa|mpa|gpa|psi|psig|psia|bar|mbar|millibars?|atm|atmospheres?|pascals?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (pressureMatch) return cleanLabel(pressureMatch[1] ?? "") || null;
  }

  if (labelCanHaveFrequencyValue(expectedAnswerLabel)) {
    const frequencyMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:hz|khz|mhz|ghz|thz|rpm|rps|cycles?\\s+per\\s+second))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (frequencyMatch) return cleanLabel(frequencyMatch[1] ?? "") || null;
  }

  if (labelCanHaveDateRangeValue(expectedAnswerLabel)) {
    const dateRangeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${dateRangeValuePattern()})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(dateRangeMatch?.[1] ?? "");
    if (candidate && isDateRangeValue(candidate)) return candidate;
  }

  if (labelCanHaveTimeRangeValue(expectedAnswerLabel)) {
    const timeRangeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${timeRangeValuePattern()})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(timeRangeMatch?.[1] ?? "");
    if (candidate && isTimeRangeValue(candidate)) return candidate;
  }

  if (labelCanHaveTimezoneValue(expectedAnswerLabel)) {
    const timezoneMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${timezoneValuePattern()})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(timezoneMatch?.[1] ?? "");
    if (candidate && isTimezoneValue(candidate)) return candidate;
  }

  if (labelCanHaveLocaleValue(expectedAnswerLabel)) {
    const localeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z]{2,3}(?:[-_][a-z0-9]{2,8}){1,3})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(localeMatch?.[1] ?? "");
    if (candidate && isLocaleCodeValue(candidate)) return candidate;
  }

  if (labelCanHaveCoordinatePairValue(expectedAnswerLabel)) {
    const coordinatePairMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(\\(?\\s*[+-]?(?:(?:[0-8]?\\d)(?:\\.\\d+)?|90(?:\\.0+)?)\\s*,\\s*[+-]?(?:(?:(?:[0-9]?\\d)|(?:1[0-7]\\d))(?:\\.\\d+)?|180(?:\\.0+)?)\\s*\\)?)(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(coordinatePairMatch?.[1] ?? "");
    if (candidate && isCoordinatePairValue(candidate)) return candidate;
  }

  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:[~\\u2248]?\\s*\\$\\d[\\d,]*(?:\\.\\d+)?)|(?:[~\\u2248]?\\s*\\d[\\d,]*(?:\\.\\d+%?|%)))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
    "i",
  ).exec(evidenceText);
  return cleanLabel(match?.[1] ?? "") || null;
}

function labelCanHaveMacAddressValue(expectedAnswerLabel: string): boolean {
  return /\b(?:mac address|hardware address|ethernet address|bssid)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveIpv6AddressValue(expectedAnswerLabel: string): boolean {
  return /\b(?:ipv6|ip|address|gateway|router|resolver|dns|nameserver|endpoint|host|server)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveCidrValue(expectedAnswerLabel: string): boolean {
  return /\b(?:cidr|subnet|network|netblock|address|address block|ip block|prefix|route)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHavePathValue(expectedAnswerLabel: string): boolean {
  return /\b(?:path|file|folder|directory|dir|route)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveDomainValue(expectedAnswerLabel: string): boolean {
  return /\b(?:domain|host|hostname|site|server|endpoint)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveUuidValue(expectedAnswerLabel: string): boolean {
  return /\b(?:id|identifier|uuid|session|request|trace|run|correlation|result)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveHashValue(expectedAnswerLabel: string): boolean {
  return /\b(?:hash|checksum|digest|sha(?:-?\d+)?|md5)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveColorValue(expectedAnswerLabel: string): boolean {
  return /\b(?:color|colour|hex|palette|theme|background|foreground|accent|brand|fill|stroke)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveDurationValue(expectedAnswerLabel: string): boolean {
  return /\b(?:duration|timeout|latency|delay|ttl|interval|sla|window|period|retention|expiry|expiration|rto|rpo)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveDataSizeValue(expectedAnswerLabel: string): boolean {
  return /\b(?:size|capacity|quota|limit|storage|memory|disk|upload|download|payload|artifact|file|bundle|cache)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveDataRateValue(expectedAnswerLabel: string): boolean {
  return /\b(?:bandwidth|throughput|speed|bitrate|transfer|download|upload|network|connection|link)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHavePhysicalSpeedValue(expectedAnswerLabel: string): boolean {
  return /\b(?:speed|velocity|pace|wind|cruise|travel|groundspeed|airspeed|knots?)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveTemperatureValue(expectedAnswerLabel: string): boolean {
  return /\b(?:temperature|temp|thermal|ambient)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveElectricalValue(expectedAnswerLabel: string): boolean {
  return /\b(?:voltage|volt|current|amp|amperage|power|watt|energy|battery|charge|load|draw|consumption|input|output|electrical)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveMassValue(expectedAnswerLabel: string): boolean {
  return /\b(?:weight|mass|payload|tare|gross|net)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveLengthValue(expectedAnswerLabel: string): boolean {
  return /\b(?:length|height|width|depth|distance|radius|diameter|dimension|span|clearance|offset|elevation|altitude)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveAreaValue(expectedAnswerLabel: string): boolean {
  return /\b(?:area|surface|footprint|coverage|square footage|floor space|acreage|plot|parcel)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveVolumeValue(expectedAnswerLabel: string): boolean {
  return /\b(?:volume|capacity|displacement|tank|reservoir|fluid|liquid|container|bottle|dose|dosage)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHavePressureValue(expectedAnswerLabel: string): boolean {
  return /\b(?:pressure|psi|pascal|bar|hydraulic|pneumatic|vacuum|gauge|tire)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveFrequencyValue(expectedAnswerLabel: string): boolean {
  return /\b(?:frequency|hertz|hz|refresh|sample|sampling|clock|oscillator|cycle|rpm|rotation)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveDateRangeValue(expectedAnswerLabel: string): boolean {
  return /\b(?:date range|date window|dates?|window|schedule|scheduled|period|validity|effective|coverage|start date|end date)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveTimeRangeValue(expectedAnswerLabel: string): boolean {
  return /\b(?:time range|time window|window|schedule|scheduled|maintenance|service hours|business hours|office hours|hours|shift|slot|period)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveTimezoneValue(expectedAnswerLabel: string): boolean {
  return /\b(?:timezone|time zone|tz|utc|gmt)\b/i.test(expectedAnswerLabel);
}

function labelCanHaveLocaleValue(expectedAnswerLabel: string): boolean {
  return /\b(?:locale|language|lang|i18n|regional format|region format)\b/i.test(
    expectedAnswerLabel,
  );
}

function labelCanHaveCoordinatePairValue(expectedAnswerLabel: string): boolean {
  return /\b(?:coordinates?|coordinate pair|gps|geo|geolocation|lat(?:itude)?\s*(?:\/|and|,)?\s*(?:lon|lng|longitude)|location)\b/i.test(
    expectedAnswerLabel,
  );
}

function isDomainNameValue(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
    cleanLabel(value),
  );
}

function isMacAddressValue(value: string): boolean {
  return /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(cleanLabel(value));
}

function isIpv6AddressValue(value: string): boolean {
  const cleaned = cleanLabel(value);
  if (!/^[0-9a-f:]+(?:%[a-z0-9_.-]+)?$/i.test(cleaned)) return false;
  const address = cleaned.split("%", 1)[0] ?? "";
  if (!address || address.includes(":::")) return false;

  const validGroup = (part: string) => /^[0-9a-f]{1,4}$/i.test(part);
  if (address.includes("::")) {
    if (address.indexOf("::") !== address.lastIndexOf("::")) return false;
    const [leftText = "", rightText = ""] = address.split("::");
    const left = leftText ? leftText.split(":") : [];
    const right = rightText ? rightText.split(":") : [];
    if (![...left, ...right].every(validGroup)) return false;
    return left.length + right.length < 8;
  }

  const groups = address.split(":");
  return groups.length === 8 && groups.every(validGroup);
}

function isIpv6CidrValue(value: string): boolean {
  const cleaned = cleanLabel(value);
  const match = /^(.+)\/(\d{1,3})$/.exec(cleaned);
  if (!match) return false;
  const prefix = Number(match[2]);
  return prefix >= 0 && prefix <= 128 && isIpv6AddressValue(match[1] ?? "");
}

function isCidrValue(value: string): boolean {
  const cleaned = cleanLabel(value);
  const match = /^(\d{1,3})(?:\.(\d{1,3})){3}\/(\d{1,2})$/.exec(cleaned);
  if (!match) return false;
  const prefix = Number(match[3]);
  if (prefix < 0 || prefix > 32) return false;
  return cleaned
    .split("/", 1)[0]
    .split(".")
    .every((part) => {
      const octet = Number(part);
      return Number.isInteger(octet) && octet >= 0 && octet <= 255;
    });
}

function preciseMacAddressValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9:-])${escapeRegExp(normalizedValue)}(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function preciseIpv6ValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9:%])${escapeRegExp(normalizedValue)}(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function preciseIpv6CidrValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9:%./])${escapeRegExp(normalizedValue)}(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function preciseCidrValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9./])${escapeRegExp(normalizedValue)}(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isPathValue(value: string): boolean {
  return /^(?:(?:~|\.{1,2})?\/|[a-z]:\\|\\\\)\S+$/i.test(
    cleanLabel(value),
  );
}

function precisePathValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[\\s"'(])${escapeRegExp(normalizedValue)}(?=$|[\\s,;!?)"']|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function preciseDomainValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9.-])${escapeRegExp(normalizedValue)}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isDottedVersionValue(value: string): boolean {
  return /^(?:v(?:ersion)?\s*)?\d+(?:\.\d+){1,5}(?:[-+][a-z0-9][a-z0-9.-]*)?$/i.test(
    cleanLabel(value),
  );
}

function preciseVersionValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedValue)}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isHashValue(value: string): boolean {
  return /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{56}|[a-f0-9]{64}|[a-f0-9]{96}|[a-f0-9]{128})$/i.test(
    cleanLabel(value),
  );
}

function preciseHashValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedValue)}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isHexColorValue(value: string): boolean {
  return /^#[a-f0-9]{3}(?:[a-f0-9]{3})?(?:[a-f0-9]{2})?$/i.test(
    cleanLabel(value),
  );
}

function preciseHexColorValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9.])${escapeRegExp(normalizedValue)}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isCssRgbColorValue(value: string): boolean {
  const channel = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  const alpha = "(?:0(?:\\.\\d+)?|1(?:\\.0+)?|\\.\\d+|(?:[1-9]\\d?|100)%)";
  const legacy = `rgba?\\(\\s*${channel}\\s*,\\s*${channel}\\s*,\\s*${channel}(?:\\s*,\\s*${alpha})?\\s*\\)`;
  const modern = `rgba?\\(\\s*${channel}\\s+${channel}\\s+${channel}(?:\\s*\\/\\s*${alpha})?\\s*\\)`;
  return new RegExp(
    `^(?:${legacy}|${modern})$`,
    "i",
  ).test(cleanLabel(value));
}

function preciseCssRgbColorValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  const compactValue = normalizedValue.replace(/\s+/g, "");
  if (!compactValue) return false;
  const compactSummary = normalizedSummary.replace(/\s+/g, "");
  return new RegExp(
    `(^|[^a-z0-9.#])${escapeRegExp(compactValue)}(?=$|[^a-z0-9])`,
  ).test(compactSummary);
}

function isCssHslColorValue(value: string): boolean {
  const hue = "(?:360|3[0-5]\\d|[12]?\\d?\\d)";
  const percent = "(?:100|[1-9]?\\d)%";
  const alpha = "(?:0(?:\\.\\d+)?|1(?:\\.0+)?|\\.\\d+|(?:[1-9]\\d?|100)%)";
  const legacy = `hsla?\\(\\s*${hue}\\s*,\\s*${percent}\\s*,\\s*${percent}(?:\\s*,\\s*${alpha})?\\s*\\)`;
  const modern = `hsla?\\(\\s*${hue}\\s+${percent}\\s+${percent}(?:\\s*\\/\\s*${alpha})?\\s*\\)`;
  return new RegExp(
    `^(?:${legacy}|${modern})$`,
    "i",
  ).test(cleanLabel(value));
}

function preciseCssHslColorValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  const compactValue = normalizedValue.replace(/\s+/g, "");
  if (!compactValue) return false;
  const compactSummary = normalizedSummary.replace(/\s+/g, "");
  return new RegExp(
    `(^|[^a-z0-9.#])${escapeRegExp(compactValue)}(?=$|[^a-z0-9])`,
  ).test(compactSummary);
}

const CSS_NAMED_COLOR_VALUES = new Set(
  [
    "aliceblue",
    "antiquewhite",
    "aqua",
    "aquamarine",
    "azure",
    "beige",
    "bisque",
    "black",
    "blanchedalmond",
    "blue",
    "blueviolet",
    "brown",
    "burlywood",
    "cadetblue",
    "chartreuse",
    "chocolate",
    "coral",
    "cornflowerblue",
    "cornsilk",
    "crimson",
    "cyan",
    "darkblue",
    "darkcyan",
    "darkgoldenrod",
    "darkgray",
    "darkgreen",
    "darkgrey",
    "darkkhaki",
    "darkmagenta",
    "darkolivegreen",
    "darkorange",
    "darkorchid",
    "darkred",
    "darksalmon",
    "darkseagreen",
    "darkslateblue",
    "darkslategray",
    "darkslategrey",
    "darkturquoise",
    "darkviolet",
    "deeppink",
    "deepskyblue",
    "dimgray",
    "dimgrey",
    "dodgerblue",
    "firebrick",
    "floralwhite",
    "forestgreen",
    "fuchsia",
    "gainsboro",
    "ghostwhite",
    "gold",
    "goldenrod",
    "gray",
    "green",
    "greenyellow",
    "grey",
    "honeydew",
    "hotpink",
    "indianred",
    "indigo",
    "ivory",
    "khaki",
    "lavender",
    "lavenderblush",
    "lawngreen",
    "lemonchiffon",
    "lightblue",
    "lightcoral",
    "lightcyan",
    "lightgoldenrodyellow",
    "lightgray",
    "lightgreen",
    "lightgrey",
    "lightpink",
    "lightsalmon",
    "lightseagreen",
    "lightskyblue",
    "lightslategray",
    "lightslategrey",
    "lightsteelblue",
    "lightyellow",
    "lime",
    "limegreen",
    "linen",
    "magenta",
    "maroon",
    "mediumaquamarine",
    "mediumblue",
    "mediumorchid",
    "mediumpurple",
    "mediumseagreen",
    "mediumslateblue",
    "mediumspringgreen",
    "mediumturquoise",
    "mediumvioletred",
    "midnightblue",
    "mintcream",
    "mistyrose",
    "moccasin",
    "navajowhite",
    "navy",
    "oldlace",
    "olive",
    "olivedrab",
    "orange",
    "orangered",
    "orchid",
    "palegoldenrod",
    "palegreen",
    "paleturquoise",
    "palevioletred",
    "papayawhip",
    "peachpuff",
    "peru",
    "pink",
    "plum",
    "powderblue",
    "purple",
    "rebeccapurple",
    "red",
    "rosybrown",
    "royalblue",
    "saddlebrown",
    "salmon",
    "sandybrown",
    "seagreen",
    "seashell",
    "sienna",
    "silver",
    "skyblue",
    "slateblue",
    "slategray",
    "slategrey",
    "snow",
    "springgreen",
    "steelblue",
    "tan",
    "teal",
    "thistle",
    "tomato",
    "transparent",
    "turquoise",
    "violet",
    "wheat",
    "white",
    "whitesmoke",
    "yellow",
    "yellowgreen",
  ],
);

function isCssNamedColorValue(value: string): boolean {
  return CSS_NAMED_COLOR_VALUES.has(normalizeText(cleanLabel(value)));
}

function preciseCssNamedColorValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9_-])${escapeRegExp(normalizedValue)}($|[^a-z0-9_-])`,
  ).test(normalizedSummary);
}

function isDurationValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:ms|msec|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?)$/i.test(
    cleanLabel(value),
  );
}

function preciseDurationValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9.])${escapeRegExp(normalizedValue)}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isDataSizeValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib|pb|pib)$/i.test(
    cleanLabel(value),
  );
}

function preciseDataSizeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isDataRateValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:bps|kbps|mbps|gbps|tbps|kbit\/s|mbit\/s|gbit\/s|tbit\/s|kb\/s|kib\/s|mb\/s|mib\/s|gb\/s|gib\/s|tb\/s|tib\/s|bytes?\/s|bytes?\s+per\s+second)$/i.test(
    cleanLabel(value),
  );
}

function preciseDataRateValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isPhysicalSpeedValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:mph|mi\/h|kph|kmph|km\/h|m\/s|meters?\s+per\s+second|metres?\s+per\s+second|ft\/s|feet\s+per\s+second|knots?|kt|kts)$/i.test(
    cleanLabel(value),
  );
}

function precisePhysicalSpeedValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isTemperatureValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*[+-]?\d+(?:\.\d+)?\s*(?:\u00b0\s*)?(?:c|f|k|celsius|fahrenheit|kelvin)$/i.test(
    cleanLabel(value),
  );
}

function preciseTemperatureValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const summary = normalizedSummary.replace(/\u00b0/g, "");
  const valuePattern = escapeRegExp(normalizedValue.replace(/\u00b0/g, "")).replace(
    /\s+/g,
    "\\s*",
  );
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(summary);
}

function isElectricalValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:mv|v|kv|ma|a|ka|mw|w|kw|wh|kwh|mwh|va|kva|mah|ah)$/i.test(
    cleanLabel(value),
  );
}

function preciseElectricalValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isMassValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:mg|milligrams?|g|grams?|kg|kgs|kilograms?|lb|lbs|pounds?|oz|ounces?|tons?|tonnes?)$/i.test(
    cleanLabel(value),
  );
}

function preciseMassValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isLengthValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:mm|millimeters?|millimetres?|cm|centimeters?|centimetres?|m|meters?|metres?|km|kilometers?|kilometres?|in|inch|inches|ft|foot|feet|yd|yards?|mi|miles?)$/i.test(
    cleanLabel(value),
  );
}

function preciseLengthValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isAreaValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:mm2|cm2|m2|km2|in2|ft2|yd2|mi2|sq\.?\s*(?:mm|cm|m|km|in|ft|feet|yd|mi)|square\s+(?:millimeters?|millimetres?|centimeters?|centimetres?|meters?|metres?|kilometers?|kilometres?|inches|feet|yards?|miles?)|acres?|hectares?|ha)$/i.test(
    cleanLabel(value),
  );
}

function preciseAreaValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isVolumeValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:ml|milliliters?|millilitres?|l|liters?|litres?|gal|gallons?|qt|quarts?|pt|pints?|fl\s*oz|fluid\s+ounces?|m3|cm3|cubic\s+meters?|cubic\s+metres?|cubic\s+centimeters?|cubic\s+centimetres?|cu\s*ft|cubic\s+feet)$/i.test(
    cleanLabel(value),
  );
}

function preciseVolumeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isPressureValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:pa|kpa|mpa|gpa|psi|psig|psia|bar|mbar|millibars?|atm|atmospheres?|pascals?)$/i.test(
    cleanLabel(value),
  );
}

function precisePressureValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isFrequencyValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:hz|khz|mhz|ghz|thz|rpm|rps|cycles?\s+per\s+second)$/i.test(
    cleanLabel(value),
  );
}

function preciseFrequencyValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function dateRangeValuePattern(): string {
  const date = "\\d{4}-\\d{2}-\\d{2}";
  return `${date}\\s*(?:-|to|through)\\s*${date}`;
}

function canonicalDateRangeValue(value: string): string | null {
  const date = "\\d{4}-\\d{2}-\\d{2}";
  const parts = new RegExp(
    `^(${date})\\s*(?:-|to|through)\\s*(${date})$`,
    "i",
  ).exec(cleanLabel(value));
  if (!parts) return null;
  const start = parts[1] ?? "";
  const end = parts[2] ?? "";
  return isIsoDateValue(start) && isIsoDateValue(end)
    ? `${start}-${end}`
    : null;
}

function isIsoDateValue(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanLabel(value));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isDateRangeValue(value: string): boolean {
  return canonicalDateRangeValue(value) !== null;
}

function preciseDateRangeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  const value = canonicalDateRangeValue(normalizedValue);
  if (!value) return false;
  const start = value.slice(0, 10);
  const end = value.slice(11, 21);
  if (!start || !end) return false;
  return new RegExp(
    `(^|[^0-9-])${escapeRegExp(start)}\\s*(?:-|to|through)\\s*${escapeRegExp(end)}(?=$|[^0-9-])`,
    "i",
  ).test(normalizedSummary);
}

function timeRangeValuePattern(): string {
  const time = "(?:[01]?\\d|2[0-3]):[0-5]\\d";
  return `${time}\\s*(?:-|to)\\s*${time}`;
}

function canonicalTimeRangeValue(value: string): string | null {
  const time = "(?:[01]?\\d|2[0-3]):[0-5]\\d";
  const parts = new RegExp(`^(${time})\\s*(?:-|to)\\s*(${time})$`, "i").exec(
    cleanLabel(value),
  );
  if (!parts) return null;
  const start = canonicalClockTime(parts[1] ?? "");
  const end = canonicalClockTime(parts[2] ?? "");
  return start && end ? `${start}-${end}` : null;
}

function canonicalClockTime(value: string): string | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(cleanLabel(value));
  if (!match) return null;
  return `${Number(match[1])}:${match[2]}`;
}

function isTimeRangeValue(value: string): boolean {
  return canonicalTimeRangeValue(value) !== null;
}

function clockTimeSummaryPattern(canonicalTime: string): string {
  const [hour, minute] = canonicalTime.split(":");
  if (hour === undefined || minute === undefined) return "";
  const hourPattern =
    Number(hour) < 10 ? `0?${escapeRegExp(hour)}` : escapeRegExp(hour);
  return `${hourPattern}:${escapeRegExp(minute)}`;
}

function preciseTimeRangeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  const value = canonicalTimeRangeValue(normalizedValue);
  if (!value) return false;
  const [start, end] = value.split("-");
  if (!start || !end) return false;
  const startPattern = clockTimeSummaryPattern(start);
  const endPattern = clockTimeSummaryPattern(end);
  if (!startPattern || !endPattern) return false;
  return new RegExp(
    `(^|[^0-9:])${startPattern}\\s*(?:-|to)\\s*${endPattern}(?=$|[^0-9:])`,
    "i",
  ).test(normalizedSummary);
}

function timezoneValuePattern(): string {
  const offset = "(?:[01]?\\d|2[0-3])(?::?[0-5]\\d)?";
  const offsetZone = `(?:(?:utc|gmt)(?:\\s*[+-]\\s*${offset})?|z|[+-]\\s*${offset})`;
  const ianaZone =
    "[a-z]+(?:[_+-][a-z0-9]+)*\\/[a-z0-9]+(?:[_+-][a-z0-9]+)*(?:\\/[a-z0-9]+(?:[_+-][a-z0-9]+)*)?";
  const abbreviation = "[a-z]{2,5}(?:[+-]\\d{1,2})?";
  return `(?:${offsetZone}|${ianaZone}|${abbreviation})`;
}

function isTimezoneValue(value: string): boolean {
  const cleaned = cleanLabel(value);
  const offset = "(?:[01]?\\d|2[0-3])(?::?[0-5]\\d)?";
  const offsetZone = new RegExp(
    `^(?:(?:utc|gmt)(?:\\s*[+-]\\s*${offset})?|z|[+-]\\s*${offset})$`,
    "i",
  );
  const ianaZone =
    /^[a-z]+(?:[_+-][a-z0-9]+)*\/[a-z0-9]+(?:[_+-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[_+-][a-z0-9]+)*)?$/i;
  const abbreviation = /^[A-Z]{2,5}(?:[+-]\d{1,2})?$/;
  return (
    offsetZone.test(cleaned) ||
    ianaZone.test(cleaned) ||
    abbreviation.test(cleaned)
  );
}

function preciseTimezoneValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9_/+-])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

function isLocaleCodeValue(value: string): boolean {
  return /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8}){1,3}$/i.test(cleanLabel(value));
}

function preciseLocaleCodeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9_-])${escapeRegExp(normalizedValue)}(?=$|[^a-z0-9_-])`,
  ).test(normalizedSummary);
}

function canonicalCoordinatePair(value: string): string {
  return cleanLabel(value)
    .replace(/^\(\s*/, "")
    .replace(/\s*\)$/, "")
    .replace(/\s+/g, "");
}

function isCoordinatePairValue(value: string): boolean {
  const match =
    /^([+-]?(?:(?:[0-8]?\d)(?:\.\d+)?|90(?:\.0+)?)),([+-]?(?:(?:(?:[0-9]?\d)|(?:1[0-7]\d))(?:\.\d+)?|180(?:\.0+)?))$/.exec(
      canonicalCoordinatePair(value),
    );
  if (!match) return false;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

function preciseCoordinatePairValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  const value = canonicalCoordinatePair(normalizedValue);
  if (!value) return false;
  const summary = normalizedSummary.replace(/[()\s]+/g, "");
  return new RegExp(
    `(^|[^0-9.,+-])${escapeRegExp(value)}(?=$|[^0-9.,+-])`,
  ).test(summary);
}

const CONCISE_STATUS_LABEL_VALUES = new Set([
  "active",
  "approved",
  "closed",
  "disabled",
  "enabled",
  "false",
  "inactive",
  "no",
  "open",
  "pending",
  "rejected",
  "submitted",
  "true",
  "yes",
]);

const CONCISE_PRIORITY_LABEL_VALUES = new Set([
  "blocker",
  "critical",
  "high",
  "low",
  "major",
  "medium",
  "minor",
  "normal",
  "urgent",
]);

function isConciseSingleTokenLabelValue(value: string): boolean {
  const cleaned = cleanLabel(value);
  if (/^[~\u2248]?\s*\$?\d[\d,]*(?:\.\d+)?%?$/.test(cleaned)) {
    return true;
  }
  if (
    /^\d{4}-\d{2}-\d{2}(?:[t\s]\d{2}:\d{2}(?::\d{2})?)?$/i.test(cleaned) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cleaned) ||
    /^\d{1,2}:\d{2}$/i.test(cleaned)
  ) {
    return true;
  }
  if (/^[a-z]+[a-z0-9_-]*\d[a-z0-9_-]*$/i.test(cleaned)) {
    return true;
  }
  return CONCISE_STATUS_LABEL_VALUES.has(normalizeText(cleaned));
}

function isConcisePriorityLabelValue(
  value: string,
  expectedAnswerLabel: string,
): boolean {
  return (
    labelCanHavePriorityValue(expectedAnswerLabel) &&
    CONCISE_PRIORITY_LABEL_VALUES.has(normalizeText(cleanLabel(value)))
  );
}

function labelCanHavePriorityValue(expectedAnswerLabel: string): boolean {
  return /\b(?:priority|severity|urgency|impact|risk|importance)\b/i.test(
    expectedAnswerLabel,
  );
}

function isIdentifierCodeValue(value: string): boolean {
  return /^[a-z]+[a-z0-9_-]*\d[a-z0-9_-]*$/i.test(cleanLabel(value));
}

function preciseIdentifierCodeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9_-])${escapeRegExp(normalizedValue)}($|[^a-z0-9_-])`,
  ).test(normalizedSummary);
}

function valueTokenCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedValue)}($|[^a-z0-9])`,
  ).test(normalizedSummary);
}

function tokenizeCompletionText(value: string): string[] {
  return [
    ...new Set(
      normalizeText(value).match(/[a-z0-9$@._-]{3,}/g) ?? [],
    ),
  ].filter((token) => !LABEL_STOPWORDS.has(token));
}

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactKey(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").slice(0, 120);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashStableString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractCanonicalUserRequest(value: string): string {
  const originalUserRequest = extractLabeledRequest(value, [
    /\bStay focused on this goal\b/i,
    /\s##\s+/i,
    /\n\s*(?:Objective|Success criteria|Page Context|Current task|Relevant context)\s*:/i,
  ]);
  if (originalUserRequest) return originalUserRequest;

  const workflowMatch =
    /\bcomplete the workflow for the original request\s*:\s*([\s\S]*)/i.exec(
      value,
    );
  if (workflowMatch) {
    const request = takeUntilFirstMarker(workflowMatch[1], [
      /\n\s*(?:Success criteria|Page Context|Current task|Relevant context)\s*:/i,
      /\s+Success criteria\s*:/i,
      /\s##\s+/i,
    ]);
    if (request) return request;
  }

  return cleanLabel(value);
}

function extractLabeledRequest(
  value: string,
  markers: RegExp[],
): string | null {
  const match =
    /\boriginal user request(?:\s*\([^)]*\))?\s*:\s*([\s\S]*)/i.exec(value);
  if (!match) return null;
  return takeUntilFirstMarker(match[1], markers) || null;
}

function takeUntilFirstMarker(value: string, markers: RegExp[]): string {
  let end = value.length;
  for (const marker of markers) {
    const match = marker.exec(value);
    if (match?.index != null && match.index < end) {
      end = match.index;
    }
  }
  return cleanLabel(value.slice(0, end));
}

function evidenceConfidenceRank(event: CompletionEvidence): number {
  return event.confidence === "high" ? 2 : 1;
}
