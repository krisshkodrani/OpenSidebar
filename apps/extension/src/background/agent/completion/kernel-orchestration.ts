import type { DomSnapshot, ToolName } from "../../../types";
import {
  evaluateReadAnswer,
  generateReadAnswerContract,
} from "./read-answer-contract";
import { cleanLabel } from "./text-utils";
import {
  extractFormFieldObservations,
  findFormFieldObservationByElementId,
} from "./form-field-analysis";
import {
  evaluateFormFill,
  generateFormFillContract,
} from "./form-fill-contract";
import {
  evaluateDraftOnly,
  generateDraftOnlyContract,
} from "./draft-only-contract";
import {
  extractChoiceObservations,
  findChoiceObservationByElementId,
} from "./quiz-choice-analysis";
import {
  evaluateQuizSelection,
  generateQuizSelectionContract,
} from "./quiz-selection-contract";
import { extractNavigationEvidence } from "./navigation-analysis";
import {
  evaluateNavigation,
  generateNavigationContract,
} from "./navigation-contract";
import {
  evaluateWorkflowConfirmation,
  generateWorkflowConfirmationContract,
} from "./workflow-confirmation-contract";
import {
  extractDraftEvidence,
  isLikelyDraftEditorField,
  extractReadElementValueEvidenceText,
  draftStateEvidence,
} from "./draft-analysis";
import {
  extractCreateFormDisappearanceEvidenceFromToolOutcome,
  extractCreateRowAppearanceEvidenceFromToolOutcome,
  extractDuplicateRowStateEvidenceFromToolOutcome,
  extractImportRowStateEvidenceFromToolOutcome,
  extractAttachmentRowStateEvidenceFromToolOutcome,
  extractDraftSubmissionEvidenceFromToolOutcome,
  extractSubmittedDraftRowEvidenceFromToolOutcome,
  extractInviteRowStateEvidenceFromToolOutcome,
} from "./workflow-state-evidence";
import {
  fieldValueEvidence,
  selectedStateEvidence,
  extractFeedbackEvidence,
  extractValidationErrorEvidence,
  extractFormConfirmationEvidence,
  extractWorkflowConfirmationEvidence,
} from "./snapshot-evidence";
import {
  extractDownloadFileResultEvidenceFromToolOutcome,
  extractUploadFileResultEvidenceFromToolOutcome,
} from "./file-transfer-evidence";
import { isContractRelevantToObjective } from "./contract-relevance";
import {
  extractModalDismissalEvidenceFromToolOutcome,
  extractTargetDisappearanceEvidenceFromToolOutcome,
  extractReadAnswerEvidenceFromToolOutcome,
} from "./tool-outcome-evidence";
import {
  extractStatusChangeEvidenceFromToolOutcome,
  extractControlLabelChangeEvidenceFromToolOutcome,
  extractControlStateChangeEvidenceFromToolOutcome,
  extractDirtyIndicatorClearedEvidenceFromToolOutcome,
} from "./control-state-evidence";
import type {
  CompletionCandidateSource,
  CompletionContract,
  CompletionEvaluation,
  CompletionEvidence,
  GeneratedCompletionContract,
} from "./kernel-types";

export function generateCompletionContract(params: {
  userRequest: string;
  snapshot: DomSnapshot | null | undefined;
  activeObjective?: string;
  successCriteria?: string;
}): GeneratedCompletionContract | null {
  const candidate = ((): GeneratedCompletionContract | null => {
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
  })();

  if (candidate && !isContractRelevantToObjective(candidate, params)) {
    return null;
  }
  return candidate;
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
      params.toolName === "type_text" ? params.args.text : params.args.value;
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
        if (
          params.toolName === "type_text" &&
          isLikelyDraftEditorField(field) &&
          cleanLabel(value).length > 0
        ) {
          evidence.push(
            draftStateEvidence({
              ...field,
              value,
              confidence: "high",
              observedAtTurn: params.turn,
            }),
          );
        }
      }
    }
  }

  if (params.toolName === "read_element" && Number.isFinite(id)) {
    const value = extractReadElementValueEvidenceText(params);
    if (value && cleanLabel(value).length > 0) {
      const field =
        findFormFieldObservationByElementId(params.currentSnapshot, id) ??
        findFormFieldObservationByElementId(params.preActionSnapshot, id);
      if (field) {
        evidence.push(
          fieldValueEvidence({
            ...field,
            value,
            confidence: "high",
            observedAtTurn: params.turn,
          }),
        );
        if (isLikelyDraftEditorField(field)) {
          evidence.push(
            draftStateEvidence({
              ...field,
              value,
              confidence: "high",
              observedAtTurn: params.turn,
            }),
          );
        }
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
  evidence.push(
    ...extractCreateFormDisappearanceEvidenceFromToolOutcome(params),
  );
  evidence.push(...extractCreateRowAppearanceEvidenceFromToolOutcome(params));
  evidence.push(...extractDuplicateRowStateEvidenceFromToolOutcome(params));
  evidence.push(...extractDownloadFileResultEvidenceFromToolOutcome(params));
  evidence.push(...extractUploadFileResultEvidenceFromToolOutcome(params));
  evidence.push(...extractImportRowStateEvidenceFromToolOutcome(params));
  evidence.push(...extractAttachmentRowStateEvidenceFromToolOutcome(params));
  evidence.push(...extractDraftSubmissionEvidenceFromToolOutcome(params));
  evidence.push(...extractSubmittedDraftRowEvidenceFromToolOutcome(params));
  evidence.push(...extractInviteRowStateEvidenceFromToolOutcome(params));
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
      snapshot: params.snapshot,
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
