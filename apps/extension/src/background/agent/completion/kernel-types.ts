import type {
  TaskContract,
  TaskContractCoverage,
} from "../task-contract";
import type { AutocompleteSuggestionDoneRejection } from "../text-entry-guards";
import type { WorkflowDoneGuardResult } from "../verification";
import type { WorkflowConfirmationAction } from "./workflow-confirmation-types";

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
          | "visible_absence"
          | "modal_disappearance"
          | "target_disappearance"
          | "form_disappearance"
          | "created_row"
          | "duplicate_row_state"
          | "draft_disappearance"
          | "submitted_draft_row"
          | "invite_row_state"
          | "attachment_row_state"
          | "import_row_state"
          | "status_change"
          | "control_label_change"
          | "control_state_change"
          | "dirty_indicator_cleared"
          | "download_file_result"
          | "download_file_completed"
          | "upload_file_result"
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
    }
  | {
      // LP-15 Phase 8: a form-state snapshot captured by extract_form_state,
      // keyed `form:${formKey}` so repeated captures dedup (latest-turn wins).
      type: "form_state_captured";
      confidence: CompletionConfidence;
      logicalKey: string;
      observedAtTurn: number;
      detail: {
        formKey: string;
        fields: Array<{ name: string; value: string }>;
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
  expectedAnswerTarget?: string;
  expectedAnswerScope?: "row" | "sentence" | "aggregate";
}

export interface WorkflowConfirmationContract {
  kind: "workflow_confirmation";
  action: WorkflowConfirmationAction;
  targetLabel?: string;
  targetValue?: string;
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

function evidenceConfidenceRank(event: CompletionEvidence): number {
  return event.confidence === "high" ? 2 : 1;
}
