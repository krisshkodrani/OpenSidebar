import type { DomSnapshot } from "../../../types";
import type {
  CompletionCandidateSource,
  CompletionEvaluation,
  CompletionEvidence,
  GeneratedCompletionContract,
  QuizSelectionContract,
  QuizTarget,
} from "./kernel-types";
import {
  extractChoiceObservations,
  extractExplicitQuestionNumber,
  extractVisibleQuestionNumber,
  expectedSelectionsMatch,
  inferSelectionCardinality,
  matchesQuizTarget,
  selectedLabelsCoveredBySummary,
} from "./quiz-choice-analysis";
import { normalizeText } from "./text-utils";
import { extractCanonicalUserRequest } from "./request-text";

export function generateQuizSelectionContract(
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
  const explicitUserQuestion =
    extractExplicitQuestionNumber(canonicalUserRequest);
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

export function evaluateQuizSelection(params: {
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
  const selected = selectedStateEvidence.filter(
    (event) => event.detail.checked,
  );
  const negativeEvidence = params.evidence.find(
    (
      event,
    ): event is Extract<CompletionEvidence, { type: "validation_error" }> =>
      event.type === "validation_error" && event.logicalKey.startsWith("quiz:"),
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
      reason:
        "No selected quiz option evidence is active for the current target.",
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
      reason:
        "Selected options do not match the expected completion selections.",
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
    (
      event,
    ): event is Extract<CompletionEvidence, { type: "correct_feedback" }> =>
      event.type === "correct_feedback" &&
      matchesFeedbackTarget(event, contract, visibleQuestionNumber),
  );
  if (contract.requiresCorrectFeedback && !correctFeedback) {
    return {
      status: "needs_verification",
      reason:
        "Selected options are applied, but correct-answer feedback is missing.",
      hint: "The selected quiz options appear applied, but this request requires checking the answer. Click the visible Check answer or Submit control, then call done after correct feedback appears.",
      contract,
      evidence: params.evidence,
    };
  }
  if (contract.requiresSubmit && !correctFeedback) {
    return {
      status: "needs_verification",
      reason:
        "Selected options are applied, but submit/check evidence is missing.",
      hint: "The selected quiz options appear applied. Verify them with the page's Check answer or Submit control before calling done.",
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

function hasQuizSelectionIntent(text: string): boolean {
  return (
    /\b(?:select|choose|pick|answer|option|what should i choose)\b/i.test(
      text,
    ) && /\b(?:correct|answer|option|quiz|question|choice)\b/i.test(text)
  );
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
