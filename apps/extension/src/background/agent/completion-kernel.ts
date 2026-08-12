import type { DomSnapshot, TaggedElement, ToolName } from "../../types";
import {
  hasDraftPreservedEvidence,
  hasStrongCommunicationSentEvidence,
  isDraftOnlyCommunicationTask,
} from "./consequential-action-policy";
import { assessTaskContractCoverage, buildTaskContract } from "./task-contract";
import {
  extractRowScopedMetricAggregateQuestionParts,
  findReadAnswerMetricAggregateFromSnapshotRows,
  findReadAnswerMetricAggregateFromTextLines,
  rowScopedMetricAggregatePartsForLabel,
} from "./completion/read-answer-row-aggregates";
import {
  controlStateChangeMatchesAction,
  controlStateCompletionWord,
  readControlStateValue,
  type ControlStateWorkflowAction,
} from "./completion/workflow-control-state";
import {
  cleanLabel,
  compactKey,
  escapeRegExp,
  hashStableString,
  normalizeText,
  tokenizeCompletionText,
  importantLabelTokens,
} from "./completion/text-utils";
import { valueTokenCoveredBySummary } from "./completion/label-value-types";
import type { FormFieldObservation } from "./completion/kernel-types";
import {
  extractFormFieldObservations,
  findFormFieldObservationByElementId,
  getFormFieldKind,
  inferExpectedFormFields,
  inferExpectedScopedFormFields,
  parseBooleanLike,
} from "./completion/form-field-analysis";
import type { ChoiceObservation } from "./completion/kernel-types";
import {
  extractChoiceObservations,
  findChoiceObservationByElementId,
  inferSelectionCardinality,
  matchesQuizTarget,
  expectedSelectionsMatch,
  selectedLabelsCoveredBySummary,
  extractVisibleQuestionNumber,
  extractExplicitQuestionNumber,
} from "./completion/quiz-choice-analysis";
import {
  extractNavigationTarget,
  parseNavigationTarget,
  navigationTargetMatches,
  extractNavigationEvidence,
  samePageUrl,
} from "./completion/navigation-analysis";
import {
  extractDraftEvidence,
  isLikelyDraftEditorField,
  isLikelyDraftEditorIdentity,
  extractReadElementValueEvidenceText,
  draftStateEvidence,
} from "./completion/draft-analysis";
import {
  inferWorkflowConfirmationAction,
  inferWorkflowConfirmationTargetLabel,
  workflowConfirmationMatchesTarget,
  normalizeWorkflowTargetLabel,
  textConfirmsWorkflowAction,
  inferTargetDisappearanceAction,
  inferDraftSubmissionAction,
  inferStatusChangeAction,
  inferSaveUpdateAction,
  inferControlLabelChangeAction,
  inferControlStateChangeAction,
  workflowTargetLabelCoveredByText,
  isTransactionalConfirmationAction,
  extractTransactionalConfirmationSnippet,
  workflowTargetIsTransactional,
  visibleTransactionalConfirmationMatchesTarget,
  elementControlText,
  isDismissalControl,
  workflowTargetTokenCoveredByText,
  workflowTargetSpecificTransactionalTokens,
  extractCartCreationSnippet,
  workflowActionTermPattern,
} from "./completion/workflow-confirmation-analysis";
import {
  hasPageReadAnswerIntent,
  findGroundedSentenceScopedAnswer,
  findGroundedRowScopedLabelValueQuestion,
  extractRowScopedLabelValueQuestionParts,
  readAnswerSummaryGroundedInEvidence,
  extractExpectedLabelValueAnswer,
  snapshotPageText,
  hasSubstantiveReadAnswerEvidence,
  findGroundedLabelValueQuestionLabel,
  extractSentenceScopedDefinitionQuestionParts,
  findReadAnswerSentenceScopedAnswer,
  extractSentenceScopedReasonQuestionParts,
  extractSentenceScopedLocationQuestionParts,
  extractSentenceScopedEventDateQuestionParts,
  extractSentenceScopedTargetCountQuestionParts,
  extractSentenceScopedTargetPresenceQuestionParts,
  extractSentenceScopedTargetStateQuestionParts,
  extractSentenceScopedTargetMetricValueQuestionParts,
  extractSentenceScopedSuperlativeMetricQuestionParts,
  sentenceScopedEventDatePatternForLabel,
  sentenceScopedPresenceMetricPatternForLabel,
  sentenceScopedMetricValuePatternForLabel,
  sentenceScopedByRelationPatternForLabel,
  sentenceScopedRelationNounPatternForLabel,
  sentenceScopedActiveRelationPatternForLabel,
  sentenceScopedAttributePatternForLabel,
  findReadAnswerRowScopedLabelValueText,
  labelValuePhraseCoveredBySummary,
  sentenceScopedReasonPredicatePatternForLabel,
  sentenceScopedSuperlativeMetricPartsForLabel,
  extractReadAnswerSuperlativeMetricCandidate,
  selectReadAnswerSuperlativeMetricWinner,
  isWorkflowRowLikeElement,
  readAnswerRowElementText,
} from "./completion/read-answer-analysis";
import type {
  SentenceScopedSuperlativeDirection,
  ReadAnswerSuperlativeMetricCandidate,
} from "./completion/read-answer-analysis";
import type { StatusChangeWorkflowAction } from "./completion/workflow-confirmation-analysis";
import { formFillFieldsMentionedInObjective } from "./completion/form-fill-relevance";
import {
  WORKFLOW_CONFIRMATION_ACTIONS,
  workflowConfirmationActionCompletionLabel,
  type WorkflowConfirmationAction,
} from "./completion/workflow-confirmation-types";
import type {
  CompletionCandidateSource,
  CompletionConfidence,
  CompletionContract,
  CompletionEvaluation,
  CompletionEvidence,
  DraftOnlyContract,
  FormFillContract,
  FormFillFieldExpectation,
  GeneratedCompletionContract,
  NavigationContract,
  QuizSelectionContract,
  QuizTarget,
  ReadAnswerContract,
  WorkflowConfirmationContract,
} from "./completion/kernel-types";
import {
  getAutocompleteSuggestionDoneRejection,
  type AutocompleteSuggestionDoneRejection,
} from "./text-entry-guards";

export type { WorkflowConfirmationAction } from "./completion/workflow-confirmation-types";
export { CompletionEvidenceLedger } from "./completion/kernel-types";
export {
  buildCompletionEnvelope,
  buildTrustedCompletionCandidate,
  buildTrustedReadAnswerCompletionCandidate,
} from "./completion/envelope";
export {
  evaluateCompletionEarlyMultiStepPreflight,
  evaluateCompletionGroundingReadPreflight,
  evaluateCompletionListDetailReviewPreflight,
  evaluateCompletionMoneyTableAggregatePreflight,
  evaluateCompletionPendingAutocompletePreflight,
  evaluateCompletionRequiredEvidencePreflight,
  evaluateCompletionSummaryPreflight,
  evaluateCompletionTaskContractPreflight,
  evaluateCompletionWorkflowContractPreflight,
  isDoneSummaryAskingClarification,
} from "./completion/preflight";
export type {
  CompletionCandidateSource,
  CompletionConfidence,
  CompletionContract,
  CompletionEnvelope,
  CompletionEvaluation,
  CompletionEvidence,
  CompletionEarlyMultiStepPreflight,
  CompletionGroundingReadPreflight,
  CompletionListDetailReviewPreflight,
  CompletionMoneyTableAggregatePreflight,
  CompletionPendingAutocompletePreflight,
  CompletionRequiredEvidencePreflight,
  CompletionSummaryPreflight,
  CompletionTaskContractPreflight,
  CompletionWorkflowContractPreflight,
  DraftOnlyContract,
  FormFillContract,
  FormFillFieldExpectation,
  GeneratedCompletionContract,
  NavigationContract,
  QuizSelectionContract,
  QuizTarget,
  ReadAnswerContract,
  TrustedCompletionCandidate,
  WorkflowConfirmationContract,
} from "./completion/kernel-types";

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

function isContractRelevantToObjective(
  generated: GeneratedCompletionContract,
  params: {
    activeObjective?: string;
    successCriteria?: string;
    userRequest: string;
  },
): boolean {
  // Judge against the focused objective AND the original request: either may
  // hold the vocabulary (a distilled objective can drop the verb, the raw
  // request can hold the field values).
  const objective = [params.activeObjective, params.userRequest]
    .filter(Boolean)
    .join("\n");

  switch (generated.contract.kind) {
    case "quiz_selection":
      return /\b(?:quiz|exam|test|question\s*\d?|answers?|select|choose|pick|check|mark|tick)\b/i.test(
        objective,
      );

    case "form_fill":
      if (
        /\b(?:fill|enter|type|input|set|save|update|change|configure|choose|select|pick|enable|disable|toggle|apply|submit|check\s*out|checkout|log\s*in|sign\s*in|sign\s*up|register|create\s+account)\b/i.test(
          objective,
        )
      ) {
        return true;
      }
      // No data-entry verb — accept only if the contract's fields were clearly
      // inferred from the request itself (e.g. `Caller = "Joe Employee"`).
      // Contracts scraped from an incidental page form share no tokens with the
      // objective, which is the deadlock case this gate exists to block.
      return formFillFieldsMentionedInObjective(
        objective,
        generated.contract.requiredFields,
      );

    case "workflow_confirmation": {
      // A root request can mention later or explicitly prohibited mutations.
      // When a focused node exists, only its own objective may authorize a
      // workflow-confirmation contract for that node.
      if (!params.activeObjective) return true;
      const focusedText = [params.activeObjective, params.successCriteria]
        .filter(Boolean)
        .join("\n");
      return (
        inferWorkflowConfirmationAction(focusedText) ===
        generated.contract.action
      );
    }

    default:
      return true;
  }
}

function generateDraftOnlyContract(params: {
  userRequest: string;
  snapshot: DomSnapshot | null | undefined;
  activeObjective?: string;
  successCriteria?: string;
}): GeneratedCompletionContract | null {
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

  const canonicalUserRequest = extractCanonicalUserRequest(params.userRequest);
  const activeScopeText = [params.activeObjective, params.successCriteria]
    .filter(Boolean)
    .join("\n");
  const scopedFormValueText = cleanLabel(params.activeObjective ?? "");
  const expectedFields =
    activeScopeText && activeScopeSuggestsFormFill(activeScopeText)
      ? inferExpectedScopedFormFields(
          activeScopeText,
          scopedFormValueText,
          canonicalUserRequest,
          fields,
        )
      : inferExpectedFormFields(
          activeScopeText || canonicalUserRequest,
          fields,
        );
  if (expectedFields.length === 0) return null;

  const requestText = normalizeText(
    [canonicalUserRequest, params.activeObjective, params.successCriteria]
      .filter(Boolean)
      .join("\n"),
  );
  const requiresSubmit = formFillRequiresSubmit({
    canonicalUserRequest,
    activeScopeText,
    requestText,
    snapshot,
  });

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

function activeScopeSuggestsFormFill(value: string): boolean {
  return /\b(?:field|form|fill|filled|type|typed|enter|entered|set|update|change|choose|select|check|uncheck|checkout|profile|input|email|e-mail|name|address|phone|coupon|promo|shipping|password|username)\b/i.test(
    value,
  );
}

function formFillRequiresSubmit(params: {
  canonicalUserRequest: string;
  activeScopeText: string;
  requestText: string;
  snapshot: DomSnapshot;
}): boolean {
  const canonicalText = normalizeText(params.canonicalUserRequest);
  if (formFillTextHasSubmitIntent(canonicalText)) return true;

  const activeText = normalizeText(params.activeScopeText);
  if (!activeText || !formFillTextHasSubmitIntent(activeText)) return false;

  if (
    formFillTextLooksFieldOnly(activeText) &&
    !snapshotHasMatchingFormSubmitControl(params.snapshot, activeText)
  ) {
    return false;
  }

  return formFillTextHasSubmitIntent(params.requestText);
}

function formFillTextHasSubmitIntent(value: string): boolean {
  return /\b(?:log\s*in|sign\s*in|submit|send|save|create|register|apply|checkout|place\s+order|order|request|complete)\b/i.test(
    value,
  );
}

function formFillTextLooksFieldOnly(value: string): boolean {
  return /\b(?:field|input|email|e-mail|name|address|phone|coupon|promo|shipping|password|username)\b/i.test(
    value,
  );
}

function snapshotHasMatchingFormSubmitControl(
  snapshot: DomSnapshot,
  text: string,
): boolean {
  const patterns = formSubmitControlPatternsForText(text);
  if (patterns.length === 0) return false;

  return snapshot.elements.some((element) => {
    if (element.isDisabled || element.isVisible === false) return false;
    const tagName = element.tagName.toLowerCase();
    const type = element.attributes.type?.toLowerCase() ?? "";
    const role = element.role.toLowerCase();
    const isSubmitControl =
      tagName === "button" ||
      role === "button" ||
      (tagName === "input" && /^(?:submit|button|image)$/i.test(type));
    if (!isSubmitControl) return false;

    const label = normalizeText(
      [
        element.text,
        element.attributes.label,
        element.attributes["aria-label"],
        element.attributes.title,
        element.attributes.value,
        element.attributes.name,
        element.attributes.id,
        type,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return patterns.some((pattern) => pattern.test(label));
  });
}

function formSubmitControlPatternsForText(text: string): RegExp[] {
  const normalized = normalizeText(text);
  const patterns: RegExp[] = [];
  if (/\blog\s*in\b|\bsign\s*in\b/i.test(normalized)) {
    patterns.push(/\b(?:log\s*in|sign\s*in|login|signin)\b/i);
  }
  if (/\bsubmit\b/i.test(normalized)) {
    patterns.push(/\bsubmit\b/i);
  }
  if (/\bsend\b/i.test(normalized)) {
    patterns.push(/\bsend\b/i);
  }
  if (/\bsave\b/i.test(normalized)) {
    patterns.push(/\b(?:save|saved)\b/i);
  }
  if (/\bapply\b/i.test(normalized)) {
    patterns.push(/\b(?:apply|update)\b/i);
  }
  if (/\bcheckout\b|\bplace\s+order\b|\border\b/i.test(normalized)) {
    patterns.push(/\b(?:checkout|place\s+order|order|purchase)\b/i);
  }
  if (/\bcreate\b|\bregister\b|\brequest\b|\bcomplete\b/i.test(normalized)) {
    patterns.push(/\b(?:create|register|request|complete|finish)\b/i);
  }
  return patterns;
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
  const sentenceScopedAnswer = getGroundedSentenceScopedAnswer(
    requestText,
    _snapshot,
  );
  const rowMetricAggregateQuestion =
    extractRowScopedMetricAggregateQuestionParts(requestText);
  const rowScopedSuperlativeAnswer = !sentenceScopedAnswer
    ? getGroundedRowScopedSuperlativeMetricAnswer(requestText, _snapshot)
    : null;
  const rowScopedMetricAggregateAnswer =
    rowMetricAggregateQuestion && !rowScopedSuperlativeAnswer
      ? getGroundedRowScopedMetricAggregateAnswer(requestText, _snapshot)
      : null;
  const definitionQuestion =
    extractSentenceScopedDefinitionQuestionParts(requestText);
  if (definitionQuestion?.strongDefinitionIntent && !sentenceScopedAnswer) {
    return null;
  }
  const reasonQuestion = extractSentenceScopedReasonQuestionParts(requestText);
  if (reasonQuestion && !sentenceScopedAnswer) {
    return null;
  }
  const locationQuestion =
    extractSentenceScopedLocationQuestionParts(requestText);
  if (locationQuestion && !sentenceScopedAnswer) {
    return null;
  }
  const eventDateQuestion =
    extractSentenceScopedEventDateQuestionParts(requestText);
  if (eventDateQuestion && !sentenceScopedAnswer) {
    return null;
  }
  const targetCountQuestion =
    extractSentenceScopedTargetCountQuestionParts(requestText);
  if (targetCountQuestion && !sentenceScopedAnswer) {
    return null;
  }
  const targetPresenceQuestion =
    extractSentenceScopedTargetPresenceQuestionParts(requestText);
  if (targetPresenceQuestion && !sentenceScopedAnswer) {
    return null;
  }
  const targetStateQuestion =
    extractSentenceScopedTargetStateQuestionParts(requestText);
  if (targetStateQuestion && !sentenceScopedAnswer) {
    return null;
  }
  if (rowMetricAggregateQuestion && !rowScopedMetricAggregateAnswer) {
    return null;
  }
  const targetMetricValueQuestion =
    extractSentenceScopedTargetMetricValueQuestionParts(requestText);
  if (
    targetMetricValueQuestion &&
    !sentenceScopedAnswer &&
    !rowScopedMetricAggregateAnswer
  ) {
    return null;
  }
  const superlativeMetricQuestion =
    extractSentenceScopedSuperlativeMetricQuestionParts(requestText);
  if (
    superlativeMetricQuestion &&
    !sentenceScopedAnswer &&
    !rowScopedSuperlativeAnswer
  ) {
    return null;
  }
  if (
    !sentenceScopedAnswer &&
    !rowScopedSuperlativeAnswer &&
    !rowScopedMetricAggregateAnswer &&
    !hasPageReadAnswerIntent(requestText, _snapshot)
  ) {
    return null;
  }
  const taskContract = buildTaskContract(requestText);
  const hasConcreteMultiReturn =
    (taskContract.multiReturnCount ?? 0) >= 2 &&
    taskContract.requiredEntities.length >=
      (taskContract.multiReturnCount ?? 0);
  const rowScopedAnswer = getGroundedRowScopedLabelValueQuestion(
    requestText,
    _snapshot,
  );
  const groundedLabelValueQuestionLabel = getGroundedLabelValueQuestionLabel(
    requestText,
    _snapshot,
  );
  const groundedLabelValueBypassesScopedTargetGate =
    groundedLabelValueQuestionCanBypassScopedTargetGate(
      requestText,
      groundedLabelValueQuestionLabel,
    );
  const targetSpecificLabelQuestion =
    !rowScopedAnswer &&
    !sentenceScopedAnswer &&
    !groundedLabelValueBypassesScopedTargetGate
      ? extractRowScopedLabelValueQuestionParts(requestText)
      : null;
  const targetSpecificLabelRequiresScopedEvidence = targetSpecificLabelQuestion
    ? readAnswerLabelRequiresScopedTargetEvidence(
        targetSpecificLabelQuestion.label,
      )
    : false;
  if (targetSpecificLabelRequiresScopedEvidence) {
    return null;
  }
  const expectedAnswerLabel =
    rowScopedAnswer?.label ??
    rowScopedSuperlativeAnswer?.label ??
    rowScopedMetricAggregateAnswer?.label ??
    sentenceScopedAnswer?.label ??
    (targetSpecificLabelRequiresScopedEvidence
      ? null
      : groundedLabelValueQuestionLabel);

  return {
    contract: {
      kind: "read_answer",
      requiresGroundedPageEvidence: true,
      ...(hasConcreteMultiReturn ? { taskContract } : {}),
      ...(expectedAnswerLabel ? { expectedAnswerLabel } : {}),
      ...(rowScopedAnswer
        ? {
            expectedAnswerTarget: rowScopedAnswer.target,
            expectedAnswerScope: "row" as const,
          }
        : rowScopedSuperlativeAnswer
          ? {
              expectedAnswerTarget: rowScopedSuperlativeAnswer.target,
              expectedAnswerScope: "sentence" as const,
            }
          : rowScopedMetricAggregateAnswer
            ? {
                expectedAnswerScope: "aggregate" as const,
              }
            : sentenceScopedAnswer
              ? {
                  expectedAnswerTarget: sentenceScopedAnswer.target,
                  expectedAnswerScope: "sentence" as const,
                }
              : {}),
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

function readAnswerLabelRequiresScopedTargetEvidence(label: string): boolean {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel) return false;
  if (normalizedLabel === "definition") return true;
  if (sentenceScopedReasonPredicatePatternForLabel(normalizedLabel))
    return true;
  if (normalizedLabel === "location") return true;
  if (sentenceScopedEventDatePatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedPresenceMetricPatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedMetricValuePatternForLabel(normalizedLabel)) return true;
  if (sentenceScopedSuperlativeMetricPartsForLabel(normalizedLabel))
    return true;
  if (rowScopedMetricAggregatePartsForLabel(normalizedLabel)) return true;
  if (
    normalizedLabel === "status" ||
    normalizedLabel === "priority" ||
    normalizedLabel === "severity" ||
    normalizedLabel === "due date" ||
    normalizedLabel === "number" ||
    normalizedLabel === "count" ||
    normalizedLabel === "quantity" ||
    normalizedLabel === "value"
  ) {
    return true;
  }
  return Boolean(
    sentenceScopedAttributePatternForLabel(normalizedLabel) ||
    sentenceScopedRelationNounPatternForLabel(normalizedLabel) ||
    sentenceScopedByRelationPatternForLabel(normalizedLabel) ||
    sentenceScopedActiveRelationPatternForLabel(normalizedLabel),
  );
}

function groundedLabelValueQuestionCanBypassScopedTargetGate(
  question: string,
  label: string | null,
): boolean {
  if (!label) return false;
  return /^(?:please\s+)?(?:tell me\s+)?what(?:'s|\s+is|\s+are|\s+was|\s+were)\s+(?:the\s+)?(?:total\s+)?(?:number|count|quantity)\s+of\s+/i.test(
    cleanLabel(question),
  );
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
  const canonicalUserRequest = extractCanonicalUserRequest(params.userRequest);
  const requestTextCandidates = [
    [params.activeObjective, params.successCriteria].filter(Boolean).join("\n"),
    extractCurrentObjectiveRequestText(params.userRequest),
    params.userRequest,
    canonicalUserRequest,
  ].filter(Boolean);

  for (const requestText of requestTextCandidates) {
    const action = inferWorkflowConfirmationAction(requestText);
    if (!action) continue;
    if (isBrowserManagementWorkflowRequest(requestText)) continue;
    if (hasPageReadAnswerIntent(requestText, _snapshot)) continue;
    if (action === "dismiss" && isDismissalPartOfLargerTask(requestText)) {
      continue;
    }
    const targetLabel = inferWorkflowConfirmationTargetLabel(
      requestText,
      action,
    );

    const targetValue = inferWorkflowUpdateTargetValue(requestText);

    return {
      contract: {
        kind: "workflow_confirmation",
        action,
        ...(targetLabel ? { targetLabel } : {}),
        ...(targetValue ? { targetValue } : {}),
      },
      confidence: "medium",
      source: "heuristic",
      repairable: true,
      notes: [],
    };
  }

  return null;
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

function evaluateFormFill(params: {
  contract: FormFillContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): CompletionEvaluation {
  const contract = params.contract;
  const validationError = params.evidence.find(
    (
      event,
    ): event is Extract<CompletionEvidence, { type: "validation_error" }> =>
      event.type === "validation_error" && event.logicalKey.startsWith("form:"),
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
    (
      event,
    ): event is Extract<CompletionEvidence, { type: "confirmation_state" }> =>
      event.type === "confirmation_state" &&
      event.logicalKey.startsWith("form:"),
  );
  if (contract.requiresConfirmation && !confirmation) {
    return {
      status: "needs_verification",
      reason:
        "Requested form fields are filled, but submit/confirmation evidence is missing.",
      hint: "The requested form fields appear filled. Submit or verify the form, then call done after the page shows confirmation.",
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
  const activeDraftField = params.evidence
    .filter(
      (event): event is Extract<CompletionEvidence, { type: "field_value" }> =>
        event.type === "field_value",
    )
    .filter(
      (event) =>
        cleanLabel(event.detail.value).length > 0 &&
        isLikelyDraftEditorIdentity(event.detail.label, event.detail.stableKey),
    )
    .sort(compareEvidenceRecency)[0];
  if (!activeDraft) {
    if (activeDraftField) {
      return {
        status: "accepted",
        reason:
          "Draft-only contract is satisfied by active unsent draft field evidence.",
        contract,
        evidence: [activeDraftField],
      };
    }
    return {
      status: "rejected",
      reason: "No active unsent draft evidence is visible.",
      contract,
      evidence: params.evidence,
    };
  }

  return {
    status: "accepted",
    reason:
      "Draft-only contract is satisfied by visible unsent draft evidence.",
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
      (
        event,
      ): event is Extract<CompletionEvidence, { type: "navigation_state" }> =>
        event.type === "navigation_state",
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
    params.snapshot &&
    hasSubstantiveReadAnswerEvidence(snapshotPageText(params.snapshot))
      ? readAnswerSnapshotEvidence({
          snapshot: params.snapshot,
          observedAtTurn: latestObservedTurn(params.evidence),
        })
      : null;

  const rowScopedEvidence =
    contract.expectedAnswerScope === "row" &&
    contract.expectedAnswerLabel &&
    contract.expectedAnswerTarget &&
    (params.snapshot || pageEvidence.length > 0)
      ? ((params.snapshot
          ? readAnswerRowScopedSnapshotEvidence({
              snapshot: params.snapshot,
              expectedAnswerLabel: contract.expectedAnswerLabel,
              expectedAnswerTarget: contract.expectedAnswerTarget,
              observedAtTurn: latestObservedTurn(params.evidence),
            })
          : null) ??
        readAnswerRowScopedTextEvidence({
          evidence: pageEvidence,
          expectedAnswerLabel: contract.expectedAnswerLabel,
          expectedAnswerTarget: contract.expectedAnswerTarget,
        }))
      : null;
  const sentenceScopedEvidence =
    contract.expectedAnswerScope === "sentence" &&
    contract.expectedAnswerLabel &&
    contract.expectedAnswerTarget &&
    (params.snapshot || pageEvidence.length > 0)
      ? ((params.snapshot
          ? readAnswerSentenceScopedSnapshotEvidence({
              snapshot: params.snapshot,
              expectedAnswerLabel: contract.expectedAnswerLabel,
              expectedAnswerTarget: contract.expectedAnswerTarget,
              observedAtTurn: latestObservedTurn(params.evidence),
            })
          : null) ??
        readAnswerSentenceScopedTextEvidence({
          evidence: pageEvidence,
          expectedAnswerLabel: contract.expectedAnswerLabel,
          expectedAnswerTarget: contract.expectedAnswerTarget,
        }))
      : null;
  const aggregateScopedEvidence =
    contract.expectedAnswerScope === "aggregate" &&
    contract.expectedAnswerLabel &&
    (params.snapshot || pageEvidence.length > 0)
      ? ((params.snapshot
          ? readAnswerAggregateScopedSnapshotEvidence({
              snapshot: params.snapshot,
              expectedAnswerLabel: contract.expectedAnswerLabel,
              observedAtTurn: latestObservedTurn(params.evidence),
            })
          : null) ??
        readAnswerAggregateScopedTextEvidence({
          evidence: pageEvidence,
          expectedAnswerLabel: contract.expectedAnswerLabel,
        }))
      : null;

  if (
    contract.expectedAnswerScope === "row" &&
    contract.expectedAnswerLabel &&
    contract.expectedAnswerTarget &&
    !rowScopedEvidence
  ) {
    return {
      status: "needs_verification",
      reason:
        "Requested row-scoped page-answer task has no matching visible row evidence yet.",
      hint: "Read the visible row for the requested item, then call done with the value from that row.",
      contract,
      evidence: params.evidence,
    };
  }
  if (
    contract.expectedAnswerScope === "sentence" &&
    contract.expectedAnswerLabel &&
    contract.expectedAnswerTarget &&
    !sentenceScopedEvidence
  ) {
    return {
      status: "needs_verification",
      reason:
        "Requested sentence-scoped page-answer task has no matching visible sentence evidence yet.",
      hint: "Read the visible sentence for the requested item, then call done with the value from that sentence.",
      contract,
      evidence: params.evidence,
    };
  }
  if (
    contract.expectedAnswerScope === "aggregate" &&
    contract.expectedAnswerLabel &&
    !aggregateScopedEvidence
  ) {
    return {
      status: "needs_verification",
      reason:
        "Requested aggregate page-answer task has no matching visible row evidence yet.",
      hint: "Read the visible rows for the requested metric, then call done with the computed aggregate.",
      contract,
      evidence: params.evidence,
    };
  }

  const sourceEvidence =
    rowScopedEvidence ??
    sentenceScopedEvidence ??
    aggregateScopedEvidence ??
    groundedEvidence ??
    snapshotEvidence;
  if (!sourceEvidence) {
    return {
      status: "needs_verification",
      reason:
        "Requested page-answer task has no grounded page-read evidence yet.",
      hint: "Call read_page first to verify the current page content, then call done with the answer from that evidence.",
      contract,
      evidence: params.evidence,
    };
  }

  if (
    params.summary &&
    !(["sentence", "aggregate"].includes(contract.expectedAnswerScope ?? "")
      ? readAnswerSummaryMatchesSentenceScopedAnswer(
          params.summary,
          sourceEvidence.detail.answer,
        )
      : readAnswerSummaryGroundedInEvidence(
          params.summary,
          sourceEvidence,
          contract.expectedAnswerLabel,
        ))
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
  snapshot?: DomSnapshot | null;
  summary?: string;
}): CompletionEvaluation {
  const contract = params.contract;
  const confirmations = params.evidence
    .filter(
      (
        event,
      ): event is Extract<CompletionEvidence, { type: "confirmation_state" }> =>
        event.type === "confirmation_state" &&
        event.logicalKey.startsWith("workflow:confirmation:") &&
        event.detail.action === contract.action,
    )
    .sort(compareEvidenceRecency);
  const targetMatchedConfirmations = confirmations.filter((event) =>
    workflowConfirmationMatchesTarget(event, contract.targetLabel),
  );
  const visibleTargetState = inferWorkflowVisibleTargetStateConfirmation({
    contract,
    evidence: params.evidence,
    snapshot: params.snapshot,
    summary: params.summary,
  });
  const visibleDismissState = inferDismissWorkflowVisibleStateConfirmation({
    contract,
    evidence: params.evidence,
    snapshot: params.snapshot,
    summary: params.summary,
  });
  const visibleUpdateState = inferWorkflowUpdateVisibleStateConfirmation({
    contract,
    evidence: params.evidence,
    snapshot: params.snapshot,
    summary: params.summary,
  });
  const authenticationState = findAuthenticationCompletionConfirmation(
    params.evidence,
    params.summary,
    params.snapshot,
  );
  const transactionalFormState = findTransactionalFormCompletionConfirmation(
    params.evidence,
    contract,
    params.summary,
    params.snapshot,
  );
  if (confirmations.length > 0 && targetMatchedConfirmations.length === 0) {
    if (authenticationState) {
      return {
        status: "accepted",
        reason:
          "Workflow contract is satisfied by visible authenticated state.",
        contract,
        evidence: [authenticationState],
      };
    }
    if (transactionalFormState) {
      return {
        status: "accepted",
        reason:
          "Workflow contract is satisfied by transactional form confirmation.",
        contract,
        evidence: [transactionalFormState],
      };
    }
    if (visibleTargetState) {
      return {
        status: "accepted",
        reason: "Workflow contract is satisfied by visible target state.",
        contract,
        evidence: [visibleTargetState],
      };
    }
    if (visibleDismissState) {
      return {
        status: "accepted",
        reason:
          "Dismiss contract is satisfied by visible absence of modal controls.",
        contract,
        evidence: [visibleDismissState],
      };
    }
    if (visibleUpdateState) {
      return {
        status: "accepted",
        reason: "Update contract is satisfied by visible target value state.",
        contract,
        evidence: [visibleUpdateState],
      };
    }

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
    if (authenticationState) {
      return {
        status: "accepted",
        reason:
          "Workflow contract is satisfied by visible authenticated state.",
        contract,
        evidence: [authenticationState],
      };
    }
    if (transactionalFormState) {
      return {
        status: "accepted",
        reason:
          "Workflow contract is satisfied by transactional form confirmation.",
        contract,
        evidence: [transactionalFormState],
      };
    }
    if (visibleTargetState) {
      return {
        status: "accepted",
        reason: "Workflow contract is satisfied by visible target state.",
        contract,
        evidence: [visibleTargetState],
      };
    }
    if (visibleDismissState) {
      return {
        status: "accepted",
        reason:
          "Dismiss contract is satisfied by visible absence of modal controls.",
        contract,
        evidence: [visibleDismissState],
      };
    }

    if (visibleUpdateState) {
      return {
        status: "accepted",
        reason: "Update contract is satisfied by visible target value state.",
        contract,
        evidence: [visibleUpdateState],
      };
    }

    return {
      status: "needs_verification",
      reason:
        "Requested action has no matching visible confirmation evidence yet.",
      hint: "Verify the page shows the action result, such as a success or confirmation message, before calling done.",
      contract,
      evidence: params.evidence,
    };
  }

  if (
    params.candidateSource === "model_done" &&
    params.summary &&
    !summaryConfirmsWorkflowActionOrSatisfiedState(
      params.summary,
      contract,
      confirmation,
    )
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

function fieldValueEvidence(
  params: FormFieldObservation & {
    confidence: CompletionConfidence;
    observedAtTurn: number;
  },
): Extract<CompletionEvidence, { type: "field_value" }> {
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

function readAnswerRowScopedSnapshotEvidence(params: {
  snapshot: DomSnapshot;
  expectedAnswerLabel: string;
  expectedAnswerTarget: string;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  const rowText = findReadAnswerRowScopedLabelValueText(
    params.snapshot,
    params.expectedAnswerTarget,
    params.expectedAnswerLabel,
  );
  if (!rowText) return null;

  const targetKey = compactKey(params.expectedAnswerTarget) || "target";
  const labelKey = compactKey(params.expectedAnswerLabel) || "label";
  return {
    type: "answer_state",
    confidence: "high",
    logicalKey: `read_answer:row:${targetKey}:${labelKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      answer: rowText.slice(0, 1000),
      source: "page_read",
      evidenceText: rowText.slice(0, 4000),
      ...(params.snapshot.url ? { url: params.snapshot.url } : {}),
    },
  };
}

function readAnswerRowScopedTextEvidence(params: {
  evidence: Extract<CompletionEvidence, { type: "answer_state" }>[];
  expectedAnswerLabel: string;
  expectedAnswerTarget: string;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  for (const event of params.evidence) {
    const rowText = findReadAnswerRowScopedLabelValueLine(
      event.detail.evidenceText,
      params.expectedAnswerTarget,
      params.expectedAnswerLabel,
    );
    if (!rowText) continue;

    const targetKey = compactKey(params.expectedAnswerTarget) || "target";
    const labelKey = compactKey(params.expectedAnswerLabel) || "label";
    return {
      ...event,
      confidence: event.confidence === "high" ? "high" : "medium",
      logicalKey: `read_answer:row-text:${targetKey}:${labelKey}`,
      detail: {
        ...event.detail,
        answer: rowText.slice(0, 1000),
        evidenceText: rowText.slice(0, 4000),
      },
    };
  }
  return null;
}

function readAnswerAggregateScopedSnapshotEvidence(params: {
  snapshot: DomSnapshot;
  expectedAnswerLabel: string;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  const aggregate = findReadAnswerMetricAggregateFromSnapshotRows(
    params.snapshot,
    params.expectedAnswerLabel,
  );
  if (!aggregate) return null;

  const labelKey = compactKey(params.expectedAnswerLabel) || "label";
  return {
    type: "answer_state",
    confidence: "high",
    logicalKey: `read_answer:aggregate:${labelKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      answer: aggregate.answer.slice(0, 1000),
      source: "page_read",
      evidenceText: aggregate.evidenceText.slice(0, 4000),
      ...(params.snapshot.url ? { url: params.snapshot.url } : {}),
    },
  };
}

function readAnswerAggregateScopedTextEvidence(params: {
  evidence: Extract<CompletionEvidence, { type: "answer_state" }>[];
  expectedAnswerLabel: string;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  for (const event of params.evidence) {
    const aggregate = findReadAnswerMetricAggregateFromTextLines(
      event.detail.evidenceText,
      params.expectedAnswerLabel,
    );
    if (!aggregate) continue;

    const labelKey = compactKey(params.expectedAnswerLabel) || "label";
    return {
      ...event,
      confidence: event.confidence === "high" ? "high" : "medium",
      logicalKey: `read_answer:aggregate-text:${labelKey}`,
      detail: {
        ...event.detail,
        answer: aggregate.answer.slice(0, 1000),
        evidenceText: aggregate.evidenceText.slice(0, 4000),
      },
    };
  }
  return null;
}

function readAnswerSentenceScopedSnapshotEvidence(params: {
  snapshot: DomSnapshot;
  expectedAnswerLabel: string;
  expectedAnswerTarget: string;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  const answer =
    findReadAnswerRowScopedSuperlativeMetricAnswer(
      params.snapshot,
      params.expectedAnswerTarget,
      params.expectedAnswerLabel,
    ) ??
    findReadAnswerSentenceScopedAnswer(
      snapshotPageText(params.snapshot),
      params.expectedAnswerTarget,
      params.expectedAnswerLabel,
    );
  if (!answer) return null;

  const targetKey = compactKey(params.expectedAnswerTarget) || "target";
  const labelKey = compactKey(params.expectedAnswerLabel) || "label";
  return {
    type: "answer_state",
    confidence: "high",
    logicalKey: `read_answer:sentence:${targetKey}:${labelKey}`,
    observedAtTurn: params.observedAtTurn,
    detail: {
      answer: answer.answer.slice(0, 1000),
      source: "page_read",
      evidenceText: answer.sentence.slice(0, 4000),
      ...(params.snapshot.url ? { url: params.snapshot.url } : {}),
    },
  };
}

function findReadAnswerRowScopedSuperlativeMetricAnswer(
  snapshot: DomSnapshot,
  expectedTarget: string,
  expectedAnswerLabel: string,
): { sentence: string; answer: string } | null {
  const superlative =
    sentenceScopedSuperlativeMetricPartsForLabel(expectedAnswerLabel);
  if (!superlative) return null;

  const winner = findReadAnswerSuperlativeMetricWinnerFromSnapshotRows(
    snapshot,
    superlative.metric,
    superlative.direction,
  );
  if (!winner) return null;
  if (!workflowTargetLabelCoveredByText(expectedTarget, winner.target)) {
    return null;
  }
  return { sentence: winner.sentence, answer: winner.target };
}

function readAnswerSentenceScopedTextEvidence(params: {
  evidence: Extract<CompletionEvidence, { type: "answer_state" }>[];
  expectedAnswerLabel: string;
  expectedAnswerTarget: string;
}): Extract<CompletionEvidence, { type: "answer_state" }> | null {
  for (const event of params.evidence) {
    const answer = findReadAnswerSentenceScopedAnswer(
      event.detail.evidenceText,
      params.expectedAnswerTarget,
      params.expectedAnswerLabel,
    );
    if (!answer) continue;

    const targetKey = compactKey(params.expectedAnswerTarget) || "target";
    const labelKey = compactKey(params.expectedAnswerLabel) || "label";
    return {
      ...event,
      confidence: event.confidence === "high" ? "high" : "medium",
      logicalKey: `read_answer:sentence-text:${targetKey}:${labelKey}`,
      detail: {
        ...event.detail,
        answer: answer.answer.slice(0, 1000),
        evidenceText: answer.sentence.slice(0, 4000),
      },
    };
  }
  return null;
}

function readAnswerToolEvidence(params: {
  result: string;
  snapshot?: DomSnapshot | null;
  observedAtTurn: number;
}): Extract<CompletionEvidence, { type: "answer_state" }>[] {
  const evidenceText = cleanReadAnswerEvidenceText(params.result, {
    preserveLines: true,
  });
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
        answer: cleanLabel(evidenceText).slice(0, 1000),
        source: "page_read",
        evidenceText: evidenceText.slice(0, 4000),
        ...(params.snapshot?.url ? { url: params.snapshot.url } : {}),
      },
    },
  ];
}

function selectedStateEvidence(
  params: ChoiceObservation & {
    confidence: CompletionConfidence;
    observedAtTurn: number;
  },
): Extract<CompletionEvidence, { type: "selected_state" }> {
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

function findAuthenticationCompletionConfirmation(
  evidence: CompletionEvidence[],
  summary?: string,
  snapshot?: DomSnapshot | null,
): Extract<CompletionEvidence, { type: "confirmation_state" }> | null {
  if (
    summary &&
    !/\b(?:logged\s*in|signed\s*in|authenticated?|dashboard|log\s*in|login|sign\s*in|signin)\b/i.test(
      summary,
    )
  ) {
    return null;
  }
  const authenticationPattern =
    /\b(?:logged\s*in|signed\s*in|authenticated?|welcome|log\s*out|logout|sign\s*out)\b/i;
  const formConfirmation = evidence.find(
    (
      event,
    ): event is Extract<CompletionEvidence, { type: "confirmation_state" }> =>
      event.type === "confirmation_state" &&
      event.logicalKey === "form:confirmation",
  );
  if (formConfirmation) return formConfirmation;
  const eventMatch = evidence.find(
    (
      event,
    ): event is Extract<CompletionEvidence, { type: "confirmation_state" }> =>
      event.type === "confirmation_state" &&
      authenticationPattern.test(event.detail.text),
  );
  if (eventMatch) return eventMatch;
  if (
    snapshot &&
    authenticationPattern.test(
      workflowConfirmationTextCorpus(snapshot, { includeTitleAndUrl: true }),
    )
  ) {
    return (
      evidence.find(
        (
          event,
        ): event is Extract<
          CompletionEvidence,
          { type: "confirmation_state" }
        > =>
          event.type === "confirmation_state" &&
          event.logicalKey === "form:confirmation",
      ) ??
      evidence.find(
        (
          event,
        ): event is Extract<
          CompletionEvidence,
          { type: "confirmation_state" }
        > => event.type === "confirmation_state",
      ) ??
      null
    );
  }
  return null;
}

function findTransactionalFormCompletionConfirmation(
  evidence: CompletionEvidence[],
  contract: WorkflowConfirmationContract,
  summary?: string,
  snapshot?: DomSnapshot | null,
): Extract<CompletionEvidence, { type: "confirmation_state" }> | null {
  if (!isTransactionalConfirmationAction(contract.action)) return null;

  const formConfirmation = evidence.find(
    (
      event,
    ): event is Extract<CompletionEvidence, { type: "confirmation_state" }> =>
      event.type === "confirmation_state" &&
      event.logicalKey === "form:confirmation",
  );
  if (!formConfirmation) return null;
  if (!contract.targetLabel) return formConfirmation;

  const text = [
    formConfirmation.detail.text,
    summary,
    snapshot?.title,
    snapshot?.visibleContent,
    snapshot?.pageContent,
  ]
    .filter(Boolean)
    .join("\n");

  if (transactionalConfirmationTextNegatesTarget(text, contract.targetLabel)) {
    return null;
  }
  if (
    visibleTransactionalConfirmationMatchesTarget(
      extractTransactionalConfirmationSnippet(text) ?? text,
      contract.action,
      contract.targetLabel,
    )
  ) {
    return formConfirmation;
  }
  return null;
}

function transactionalConfirmationTextNegatesTarget(
  text: string,
  targetLabel: string,
): boolean {
  const normalizedText = normalizeText(text);
  const targetTokens = workflowTargetSpecificTransactionalTokens(targetLabel);
  if (targetTokens.length === 0) return false;
  return targetTokens.some((token) => {
    const escaped = escapeRegExp(token);
    return new RegExp(
      `\\b${escaped}\\b.{0,80}\\b(?:remains?|draft|incomplete|pending|not\\s+(?:submitted|complete|completed))\\b|\\b(?:remains?|draft|incomplete|pending|not\\s+(?:submitted|complete|completed))\\b.{0,80}\\b${escaped}\\b`,
      "i",
    ).test(normalizedText);
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

function summaryConfirmsWorkflowAction(
  summary: string,
  action: WorkflowConfirmationAction,
): boolean {
  return textConfirmsWorkflowAction(summary, action, "summary");
}

function summaryConfirmsWorkflowActionOrSatisfiedState(
  summary: string,
  contract: WorkflowConfirmationContract,
  confirmation: Extract<CompletionEvidence, { type: "confirmation_state" }>,
): boolean {
  if (
    isTransactionalConfirmationAction(contract.action) &&
    extractTransactionalConfirmationSnippet(confirmation.detail.text) &&
    (!contract.targetLabel ||
      workflowTargetIsTransactional(contract.targetLabel))
  ) {
    return transactionalConfirmationSummaryGrounded(
      summary,
      confirmation.detail.text,
    );
  }
  if (summaryConfirmsWorkflowAction(summary, contract.action)) return true;
  if (contract.action !== "create" || !contract.targetLabel) return false;
  if (!extractCartCreationSnippet(confirmation.detail.text)) return false;
  if (!workflowTargetLabelCoveredByText(contract.targetLabel, summary)) {
    return false;
  }
  return /\b(?:cart|basket|bag|already|present|contains|shows|displays|visible|satisfied)\b/i.test(
    summary,
  );
}

function inferDismissWorkflowVisibleStateConfirmation(params: {
  contract: WorkflowConfirmationContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): Extract<CompletionEvidence, { type: "confirmation_state" }> | null {
  const { contract, snapshot } = params;
  if (contract.action !== "dismiss" || !snapshot) return null;
  if (findModalLikeDescriptors(snapshot).length > 0) return null;
  if (snapshotHasVisibleDismissalControl(snapshot)) return null;
  if (
    params.summary &&
    !/\b(?:closed|dismissed|removed|cleared|gone|no\s+(?:modal|popup|pop-up|overlay|banner)|no\s+longer\s+visible)\b/i.test(
      params.summary,
    )
  ) {
    return null;
  }

  return {
    type: "confirmation_state",
    confidence: "medium",
    logicalKey: "workflow:confirmation:dismiss:visible-absence",
    observedAtTurn: latestObservedTurn(params.evidence),
    detail: {
      action: "dismiss",
      source: "visible_absence",
      targetText: cleanLabel(contract.targetLabel ?? "modal or popup overlay"),
      text: "No visible modal, popup, overlay, banner, or dismissal control remains.",
    },
  };
}

function inferWorkflowVisibleTargetStateConfirmation(params: {
  contract: WorkflowConfirmationContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): Extract<CompletionEvidence, { type: "confirmation_state" }> | null {
  const { contract, snapshot } = params;
  if (!contract.targetLabel || !snapshot) return null;

  const statePattern = workflowVisibleTargetStatePattern(contract.action);
  if (!statePattern) return null;

  const visibleText = cleanLabel(
    [snapshot.visibleContent, snapshot.pageContent].filter(Boolean).join("\n"),
  );
  if (!visibleText) return null;
  if (
    !workflowVisibleTargetStateMatches(
      contract.targetLabel,
      statePattern,
      visibleText,
    )
  ) {
    return null;
  }
  if (
    params.summary &&
    !workflowVisibleTargetStateSummaryMatches(
      params.summary,
      contract.targetLabel,
      contract.action,
      statePattern,
    )
  ) {
    return null;
  }

  const targetKey = compactKey(contract.targetLabel + ":" + contract.action);
  return {
    type: "confirmation_state",
    confidence: "medium",
    logicalKey:
      "workflow:confirmation:" +
      contract.action +
      ":visible-target-state:" +
      targetKey,
    observedAtTurn: latestObservedTurn(params.evidence),
    detail: {
      action: contract.action,
      source: "visible_text",
      targetText: contract.targetLabel,
      text: workflowVisibleTargetStateSnippet(
        visibleText,
        contract.targetLabel,
        statePattern,
      ),
    },
  };
}

function workflowVisibleTargetStatePattern(
  action: WorkflowConfirmationAction,
): string | null {
  switch (action) {
    case "enable":
      return "(?:enabled|activated|on|active)";
    case "disable":
      return "(?:disabled|deactivated|off|inactive)";
    default:
      return null;
  }
}

function workflowVisibleTargetStateMatches(
  targetLabel: string,
  statePattern: string,
  visibleText: string,
): boolean {
  const targetTokens = workflowVisibleTargetStateTokens(targetLabel);
  if (targetTokens.length === 0) return false;

  const normalizedText = normalizeText(visibleText);
  const targetPattern = targetTokens.map(escapeRegExp).join("\\s+");
  return new RegExp(
    `\\b${targetPattern}\\b(?:\\s*(?:[:=\\-])\\s*|\\s+(?:is|now|currently|has\\s+been|was|turned|set\\s+to|status(?:\\s+is)?|state(?:\\s+is)?)\\s+|\\s+)${statePattern}\\b`,
    "i",
  ).test(normalizedText);
}

function workflowVisibleTargetStateSummaryMatches(
  summary: string,
  targetLabel: string,
  action: WorkflowConfirmationAction,
  statePattern: string,
): boolean {
  if (workflowVisibleTargetStateMatches(targetLabel, statePattern, summary)) {
    return true;
  }
  if (!workflowTargetLabelCoveredByText(targetLabel, summary)) return false;
  if (summaryConfirmsWorkflowAction(summary, action)) return true;
  if (action === "enable") {
    return /\b(?:turn(?:ed)?\s+on|switched\s+on|enabled|activated)\b/i.test(
      summary,
    );
  }
  if (action === "disable") {
    return /\b(?:turn(?:ed)?\s+off|switched\s+off|disabled|deactivated)\b/i.test(
      summary,
    );
  }
  return false;
}

function workflowVisibleTargetStateTokens(targetLabel: string): string[] {
  return tokenizeCompletionText(targetLabel).filter(
    (token) =>
      !/^(?:enable|enabled|activate|activated|activation|disable|disabled|deactivate|deactivated|deactivation|turn|turned|on|off|active|inactive|toggle|toggles|switch|switches|setting|settings|status|state|control|button)$/i.test(
        token,
      ),
  );
}

function workflowVisibleTargetStateSnippet(
  visibleText: string,
  targetLabel: string,
  statePattern: string,
): string {
  const normalizedText = normalizeText(visibleText);
  const targetTokens = workflowVisibleTargetStateTokens(targetLabel);
  const targetPattern = targetTokens.map(escapeRegExp).join("\\s+");
  const match = new RegExp(
    `\\b${targetPattern}\\b(?:\\s*(?:[:=\\-])\\s*|\\s+(?:is|now|currently|has\\s+been|was|turned|set\\s+to|status(?:\\s+is)?|state(?:\\s+is)?)\\s+|\\s+)${statePattern}\\b`,
    "i",
  ).exec(normalizedText);
  if (!match) return cleanLabel(targetLabel);
  const start = Math.max(0, match.index - 120);
  const end = Math.min(visibleText.length, match.index + match[0].length + 120);
  return cleanLabel(visibleText.slice(start, end));
}

function inferWorkflowUpdateVisibleStateConfirmation(params: {
  contract: WorkflowConfirmationContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): Extract<CompletionEvidence, { type: "confirmation_state" }> | null {
  const { contract, snapshot } = params;
  if (!contract.targetLabel) return null;
  const targetValue = cleanLabel(contract.targetValue ?? "");
  if (!targetValue || !snapshot) return null;
  if (workflowUpdateValueStillInActiveEditor(snapshot, targetValue)) {
    return null;
  }

  const visibleText = cleanLabel(
    [
      snapshot.visibleContent,
      snapshot.pageContent,
      workflowUpdateCommittedElementText(snapshot),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  if (!visibleText) return null;
  if (
    !workflowUpdateVisibleStateMatches(
      contract.targetLabel,
      targetValue,
      visibleText,
    )
  ) {
    return null;
  }
  if (
    params.summary &&
    !workflowUpdateSummaryMatchesVisibleState(
      params.summary,
      contract.targetLabel,
      targetValue,
    )
  ) {
    return null;
  }

  const targetKey = compactKey(contract.targetLabel + ":" + targetValue);
  return {
    type: "confirmation_state",
    confidence: "medium",
    logicalKey:
      "workflow:confirmation:" +
      contract.action +
      ":visible-target-value:" +
      targetKey,
    observedAtTurn: latestObservedTurn(params.evidence),
    detail: {
      action: contract.action,
      source: "visible_text",
      targetText: contract.targetLabel + " " + targetValue,
      text: workflowUpdateVisibleStateSnippet(
        visibleText,
        contract.targetLabel,
        targetValue,
      ),
    },
  };
}

function workflowUpdateValueStillInActiveEditor(
  snapshot: DomSnapshot,
  targetValue: string,
): boolean {
  const normalizedValue = normalizeText(targetValue);
  if (!normalizedValue) return false;
  return snapshot.elements.some((element) => {
    if (!element.isVisible) return false;
    if (!getFormFieldKind(element)) return false;
    const value = cleanLabel(
      [
        element.attributes.value,
        element.text,
        element.attributes["aria-label"],
        element.attributes.label,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return valueTokenCoveredBySummary(normalizeText(value), normalizedValue);
  });
}

function workflowUpdateCommittedElementText(snapshot: DomSnapshot): string {
  return snapshot.elements
    .filter((element) => element.isVisible)
    .filter((element) => !getFormFieldKind(element))
    .filter((element) => {
      const tagName = element.tagName.toLowerCase();
      const role = (element.role ?? "").toLowerCase();
      return (
        /^(?:table|thead|tbody|tfoot|tr|td|th)$/i.test(tagName) ||
        /^(?:table|grid|row|cell|gridcell|columnheader|rowheader)$/i.test(role)
      );
    })
    .map((element) => element.text)
    .filter(Boolean)
    .join("\n");
}
function workflowUpdateVisibleStateMatches(
  targetLabel: string,
  targetValue: string,
  visibleText: string,
): boolean {
  const normalizedText = normalizeText(visibleText);
  const normalizedValue = normalizeText(targetValue);
  if (!valueTokenCoveredBySummary(normalizedText, normalizedValue))
    return false;
  const targetTokens = workflowUpdateStateTargetTokens(targetLabel);
  if (targetTokens.length === 0) return false;
  if (
    !targetTokens.every((token) =>
      workflowTargetTokenCoveredByText(normalizedText, token),
    )
  ) {
    return false;
  }
  return workflowUpdateValueAppearsNearTarget(
    normalizedText,
    targetTokens,
    normalizedValue,
  );
}

function workflowUpdateSummaryMatchesVisibleState(
  summary: string,
  targetLabel: string,
  targetValue: string,
): boolean {
  const normalizedSummary = normalizeText(summary);
  const normalizedValue = normalizeText(targetValue);
  if (!valueTokenCoveredBySummary(normalizedSummary, normalizedValue)) {
    return false;
  }
  const targetTokens = workflowUpdateStateTargetTokens(targetLabel);
  if (
    targetTokens.length > 0 &&
    !targetTokens.every((token) =>
      workflowTargetTokenCoveredByText(normalizedSummary, token),
    )
  ) {
    return false;
  }
  return (
    summaryConfirmsWorkflowAction(summary, "update") ||
    /\b(?:now|shows?|displays?|visible|committed|set|value)\b/i.test(summary)
  );
}

function workflowUpdateStateTargetTokens(targetLabel: string): string[] {
  return tokenizeCompletionText(targetLabel).filter(
    (token) =>
      !/^(?:value|values|cell|cells|field|fields|input|inputs|row|rows|column|columns|first|second|third|fourth|fifth|data)$/i.test(
        token,
      ),
  );
}

function workflowUpdateValueAppearsNearTarget(
  normalizedText: string,
  targetTokens: string[],
  normalizedValue: string,
): boolean {
  const valueIndex = normalizedText.indexOf(normalizedValue);
  if (valueIndex < 0) return false;
  return targetTokens.some((token) => {
    const tokenIndex = normalizedText.indexOf(token);
    return tokenIndex >= 0 && Math.abs(tokenIndex - valueIndex) <= 600;
  });
}

function workflowUpdateVisibleStateSnippet(
  visibleText: string,
  targetLabel: string,
  targetValue: string,
): string {
  const valueIndex = normalizeText(visibleText).indexOf(
    normalizeText(targetValue),
  );
  if (valueIndex < 0) return cleanLabel(targetLabel + " " + targetValue);
  const start = Math.max(0, valueIndex - 180);
  const end = Math.min(
    visibleText.length,
    valueIndex + targetValue.length + 180,
  );
  return cleanLabel(visibleText.slice(start, end));
}

function inferWorkflowUpdateTargetValue(value: string): string | null {
  const text = cleanLabel(value);
  const patterns = [
    /\b(?:change|update|set|replace|edit)\b.{0,120}?\b(?:to|as)\s+["']?([^"',.;\n]{1,80})["']?/i,
    /\b(?:type|enter)\s+["']?([^"'\s,.;\n]{1,80})["']?/i,
  ];
  for (const pattern of patterns) {
    const candidate = normalizeWorkflowUpdateTargetValue(
      pattern.exec(text)?.[1] ?? "",
    );
    if (candidate) return candidate;
  }
  return null;
}

function normalizeWorkflowUpdateTargetValue(value: string): string | null {
  let targetValue = cleanLabel(value);
  targetValue = targetValue.replace(
    /\s+(?:and|then|press|click|confirm|save|submit|verify|check|the\s+subtask\s+outcome|is\s+verified|verified\s+on)\b.*$/i,
    "",
  );
  targetValue = targetValue.replace(/^["']|["']$/g, "");
  targetValue = cleanLabel(targetValue);
  if (!targetValue) return null;
  if (/^(?:confirm|verify|check)\b/i.test(targetValue)) return null;
  if (!/[0-9$@._-]/.test(targetValue) && !/^.{2,40}$/.test(targetValue)) {
    return null;
  }
  return targetValue.slice(0, 80);
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
    !/\b(?:validation errors?|invalid|missing|please fill|please enter|is required|are required|required field|cannot be blank|can't be blank|must be filled)\b/i.test(
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
  const text = workflowConfirmationTextCorpus(snapshot, {
    includeTitleAndUrl: true,
  }).slice(0, 20_000);
  const hasStrongConfirmation =
    /\b(?:submission complete|submitted successfully|sent successfully|request has been submitted|thank you,? your request|request received|form submitted|order confirmed)\b/i.test(
      text,
    ) ||
    /\b(?:authenticated dashboard|welcome,?\s+(?:admin|user)|logged in|signed in|you are signed in|log out|logout|sign out)\b/i.test(
      text,
    ) ||
    /\b(?:coupon|promo|discount|code)\b.{0,80}\b(?:applied|accepted|activated|successfully)\b/i.test(
      text,
    ) ||
    /\b(?:applied|accepted|activated|successfully)\b.{0,80}\b(?:coupon|promo|discount|code)\b/i.test(
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
  const text = workflowConfirmationTextCorpus(snapshot, {
    includeTitleAndUrl: true,
  }).slice(0, 20_000);
  const actions = new Set<WorkflowConfirmationAction>();

  for (const action of WORKFLOW_CONFIRMATION_ACTIONS) {
    if (textConfirmsWorkflowAction(text, action, "visible")) {
      actions.add(action);
    }
  }
  if (extractCartCreationSnippet(text)) {
    actions.add("create");
  }
  if (extractTransactionalConfirmationSnippet(text)) {
    actions.add("submit");
    actions.add("complete");
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
  const source = workflowConfirmationTextCorpus(snapshot, {
    includeTitleAndUrl: false,
  });
  return (extractWorkflowConfirmationSnippet(source, action) ?? source).slice(
    0,
    1000,
  );
}

function workflowConfirmationTextCorpus(
  snapshot: DomSnapshot,
  options: { includeTitleAndUrl: boolean },
): string {
  const parts = [
    ...(options.includeTitleAndUrl ? [snapshot.title, snapshot.url] : []),
    snapshot.visibleContent,
    snapshot.pageContent,
    ...snapshot.elements.flatMap((element) => {
      if (element.isVisible === false) return [];
      return [
        element.text,
        element.attributes.label,
        element.attributes["aria-label"],
        element.attributes.title,
        element.attributes.value,
      ];
    }),
  ];
  const seen = new Set<string>();
  const unique = parts
    .map((part) => cleanLabel(part ?? ""))
    .filter((part) => {
      if (!part || seen.has(part)) return false;
      seen.add(part);
      return true;
    });
  return unique.join("\n");
}

function extractWorkflowConfirmationSnippet(
  value: string,
  action: WorkflowConfirmationAction,
): string | null {
  const text = cleanLabel(value);
  if (!text) return null;

  if (action === "enable") {
    const actionStatuses = [
      ...text.matchAll(
        /\bAction\s*:\s*[a-z0-9][a-z0-9 _-]{0,80}?(?=\s+[a-z0-9][a-z0-9 _-]{1,40}\s*:|[.!?]|$)/gi,
      ),
    ]
      .map((match) => cleanLabel(match[0] ?? ""))
      .filter(Boolean);
    if (actionStatuses.length > 0) return actionStatuses.join(" ");
  }
  if (action === "create") {
    const cartState = extractCartCreationSnippet(text);
    if (cartState) return cartState;
  }
  const sentence = text
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((candidate) => cleanLabel(candidate))
    .find((candidate) =>
      textConfirmsWorkflowAction(candidate, action, "visible"),
    );
  if (sentence) return sentence;

  if (isTransactionalConfirmationAction(action)) {
    const transactionState = extractTransactionalConfirmationSnippet(text);
    if (transactionState) return transactionState;
  }

  const actionTerms = workflowActionTermPattern(action);
  const match = new RegExp(`.{0,120}\\b${actionTerms}\\b.{0,120}`, "i").exec(
    text,
  )?.[0];
  return match ? cleanLabel(match) : null;
}

function transactionalConfirmationSummaryGrounded(
  summary: string,
  evidenceText: string,
): boolean {
  const normalizedSummary = normalizeText(summary);
  if (
    !/\b(?:order|checkout|purchase|payment|transaction|submission|confirmation|receipt|confirmed|complete|completed|submitted|thank|logged\s*in|signed\s*in|authenticated?|dashboard)\b/i.test(
      normalizedSummary,
    )
  ) {
    return false;
  }
  const orderId = extractTransactionReference(evidenceText);
  return !orderId || normalizedSummary.includes(normalizeText(orderId));
}

function extractTransactionReference(value: string): string | null {
  return (
    cleanLabel(value).match(
      /\b(?:order|confirmation|receipt|reference|booking|reservation)\s*(?:#|number|no\.?|id)?\s*[:#-]?\s*([a-z]{1,6}[-_]?\d{3,}|\d{4,})\b/i,
    )?.[1] ?? null
  );
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

  const currentDescriptors = findModalLikeDescriptors(current);
  if (currentDescriptors.length > 0) return [];

  const dismissed = findModalLikeDescriptors(pre);
  const fallbackLabel =
    dismissed.length === 0 &&
    snapshotHasConsentBannerContext(pre) &&
    !snapshotHasVisibleDismissalControl(current)
      ? clickedDismissalControlLabelFromToolOutcome(params)
      : null;
  if (dismissed.length === 0 && !fallbackLabel) return [];

  const label = (
    dismissed.length > 0
      ? dismissed
          .map((descriptor) => descriptor.label)
          .filter(Boolean)
          .join(" | ")
      : fallbackLabel || "dismissal control"
  ).slice(0, 240);
  const identity = compactKey(
    dismissed.length > 0
      ? dismissed
          .map((descriptor) => descriptor.key)
          .filter(Boolean)
          .join("-") ||
          label ||
          "modal"
      : label || "dismissal-control",
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
  const actionLabel = workflowConfirmationActionCompletionLabel(action);
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

function extractCreateFormDisappearanceEvidenceFromToolOutcome(params: {
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
  if (!element || !isCreateFormSubmissionControl(element)) return [];

  const preFields = extractFormFieldObservations(pre);
  const target = inferCreatedFormTarget(preFields);
  if (!target) return [];
  if (!didSubmittedFormDisappear(preFields, current)) return [];
  if (snapshotHasFormValidationText(current)) return [];

  const key = compactKey(target) || `tag-${element.tag}`;
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:create:form:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Create form no longer visible: ${target}`,
        action: "create",
        targetText: target,
        source: "form_disappearance",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function extractCreateRowAppearanceEvidenceFromToolOutcome(params: {
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
  if (!element || !isCreateFormSubmissionControl(element)) return [];

  const preFields = extractFormFieldObservations(pre);
  const target = inferCreatedFormTarget(preFields);
  if (!target) return [];
  if (didSubmittedFormDisappear(preFields, current)) return [];
  if (snapshotHasFormValidationText(current)) return [];
  if (findCreatedRowText(pre, target)) return [];

  const rowText = findCreatedRowText(current, target);
  if (!rowText) return [];

  const key = compactKey(target) || compactKey(rowText) || `tag-${element.tag}`;
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:create:row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Created row visible: ${target}`,
        action: "create",
        targetText: target,
        source: "created_row",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function findCreatedRowText(
  snapshot: DomSnapshot,
  target: string,
): string | null {
  const row = snapshot.elements.find((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (!isWorkflowRowLikeElement(element)) return false;
    const text = workflowRowElementText(element);
    return Boolean(text) && workflowTargetLabelCoveredByText(target, text);
  });
  return row ? workflowRowElementText(row) : null;
}

type DuplicateRowWorkflowAction = Extract<
  WorkflowConfirmationAction,
  "copy" | "duplicate"
>;

function extractDuplicateRowStateEvidenceFromToolOutcome(params: {
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
  if (!isDuplicateRowWorkflowAction(action)) return [];

  const target = inferWorkflowTargetTextFromControl(element, action);
  if (!target) return [];
  if (snapshotHasFormValidationText(current)) return [];

  const rowText = findNewDuplicateRowStateText(
    pre,
    current,
    target,
    action,
    elementControlText(element),
  );
  if (!rowText) return [];

  const key = compactKey(target) || compactKey(rowText) || `tag-${element.tag}`;
  const actionLabel = action === "copy" ? "Copied" : "Duplicated";
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `${actionLabel} row visible: ${target}`,
        action,
        targetText: target,
        source: "duplicate_row_state",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function isDuplicateRowWorkflowAction(
  action: WorkflowConfirmationAction | null,
): action is DuplicateRowWorkflowAction {
  return action === "copy" || action === "duplicate";
}

function findNewDuplicateRowStateText(
  pre: DomSnapshot,
  current: DomSnapshot,
  target: string,
  action: DuplicateRowWorkflowAction,
  clickedControlText: string,
): string | null {
  const preRows = workflowRowsCoveringTarget(pre, target);
  if (preRows.length === 0) return null;

  const currentRows = workflowRowsCoveringTarget(current, target);
  if (currentRows.length <= preRows.length) return null;

  const preStateRows = new Set(
    preRows
      .filter((text) => duplicateRowTextHasDuplicatedState(text, action))
      .map(rowStateKey),
  );
  const clickedControlKey = normalizeText(clickedControlText);
  const rowText = currentRows.find(
    (text) =>
      duplicateRowTextHasDuplicatedState(text, action) &&
      (!clickedControlKey ||
        !normalizeText(text).includes(clickedControlKey)) &&
      !preStateRows.has(rowStateKey(text)),
  );
  return rowText ?? null;
}

function workflowRowsCoveringTarget(
  snapshot: DomSnapshot,
  target: string,
): string[] {
  const rows: string[] = [];
  for (const element of snapshot.elements) {
    if (!element.isVisible || element.isDisabled) continue;
    if (!isWorkflowRowLikeElement(element)) continue;
    const text = workflowRowElementText(element);
    if (!text || !workflowTargetLabelCoveredByText(target, text)) continue;
    rows.push(text);
  }
  return rows;
}

function duplicateRowTextHasDuplicatedState(
  value: string,
  action: DuplicateRowWorkflowAction,
): boolean {
  const text = normalizeText(value);
  if (action === "copy") {
    return /\b(?:copied|copy)\b/i.test(text);
  }
  return /\b(?:duplicated|duplicate|duplication|cloned|clone|copied|copy)\b/i.test(
    text,
  );
}

function rowStateKey(value: string): string {
  return normalizeText(value);
}

function workflowRowElementText(element: TaggedElement): string {
  const attrs = element.attributes ?? {};
  return cleanLabel(
    [
      element.text,
      attrs["aria-label"],
      attrs.title,
      attrs.label,
      attrs.name,
      attrs.id,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function isCreateFormSubmissionControl(element: TaggedElement): boolean {
  const text = normalizeText(elementControlText(element));
  if (!text) return false;
  if (
    /\b(?:cancel|close|dismiss|delete|remove|archive|invite|duplicate|restore|update|save|send|post|publish|refresh|restart|reset)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return /\b(?:create|add|register)\b\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|order|case|issue|incident|project|contact|customer)\b/i.test(
    text,
  );
}

function inferCreatedFormTarget(fields: FormFieldObservation[]): string | null {
  const candidates = fields
    .filter((field) => field.kind === "text")
    .map((field) => ({
      field,
      value: normalizeWorkflowTargetLabel(cleanLabel(field.value), {
        quoted: true,
      }),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        field: FormFieldObservation;
        value: string;
      } =>
        Boolean(candidate.value) &&
        isCreateFormTargetValue(candidate.value ?? "") &&
        !isNonTargetCreateFormField(candidate.field),
    );
  if (candidates.length === 0) return null;

  const targetLike = candidates.filter((candidate) =>
    isLikelyCreateTargetField(candidate.field),
  );
  if (targetLike.length > 0) return targetLike[0].value;
  if (candidates.length === 1) return candidates[0].value;
  return null;
}

function isCreateFormTargetValue(value: string): boolean {
  const clean = cleanLabel(value);
  if (clean.length < 3 || clean.length > 120) return false;
  if (/[.!?]\s/.test(clean)) return false;
  const tokens = tokenizeCompletionText(clean);
  if (tokens.length === 0 || tokens.length > 8) return false;
  return !/^(?:yes|no|true|false|on|off|n\/a|none|null|new|draft|active|inactive)$/i.test(
    normalizeText(clean),
  );
}

function isLikelyCreateTargetField(field: FormFieldObservation): boolean {
  const label = normalizeText([field.label, field.stableKey].join(" "));
  return /\b(?:name|title|subject|summary|label|customer|account|user|username|project|ticket|case|contact|company|organization|organisation|email|identifier|id|number)\b/i.test(
    label,
  );
}

function isNonTargetCreateFormField(field: FormFieldObservation): boolean {
  const label = normalizeText([field.label, field.stableKey].join(" "));
  return /\b(?:description|notes?|comments?|message|body|password|passcode|secret|token|key|address|phone|amount|quantity|count|date|time)\b/i.test(
    label,
  );
}

function didSubmittedFormDisappear(
  preFields: FormFieldObservation[],
  current: DomSnapshot,
): boolean {
  if (preFields.length === 0) return false;
  const currentFields = extractFormFieldObservations(current);
  if (currentFields.length === 0) return true;
  const preStableKeys = new Set(preFields.map((field) => field.stableKey));
  return !currentFields.some((field) => preStableKeys.has(field.stableKey));
}

function extractDownloadFileResultEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  turn: number;
}): CompletionEvidence[] {
  if (params.toolName !== "download_file") return [];

  const parsed = parseDownloadFileResult(params.result);
  if (!parsed) return [];

  const targetText = getDownloadTargetText(params.args, parsed.filename);
  if (!targetText) return [];

  const key = compactKey(targetText) || `download-${parsed.id}`;
  const url = typeof params.args.url === "string" ? params.args.url : "";

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:download:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Download ${parsed.state}: ${targetText} (ID: ${parsed.id})`,
        action: "download",
        targetText,
        source:
          parsed.state === "completed"
            ? "download_file_completed"
            : "download_file_result",
        ...(url ? { url } : {}),
      },
    },
  ];
}

type DownloadFileResultDetails = {
  id: string;
  state: "started" | "completed";
  filename?: string;
};

function parseDownloadFileResult(
  result: string,
): DownloadFileResultDetails | null {
  const value = result.trim();
  const started = /^Download started\s+\(ID:\s*(\d+)\)$/i.exec(value);
  if (started?.[1]) {
    return { id: started[1], state: "started" };
  }

  const completed =
    /^Download completed\s+\(ID:\s*(\d+)(?:,\s*filename:\s*(.{1,240}))?\)$/i.exec(
      value,
    );
  if (!completed?.[1]) return null;

  const filename = cleanLabel(completed[2] ?? "");
  return {
    id: completed[1],
    state: "completed",
    ...(filename ? { filename } : {}),
  };
}

function getDownloadTargetText(
  args: Record<string, unknown>,
  observedFilename = "",
): string {
  const observed = cleanLabel(observedFilename);
  if (observed) return observed;

  const explicitFilename =
    typeof args.filename === "string" ? cleanLabel(args.filename) : "";
  if (explicitFilename) return explicitFilename;

  const rawUrl = typeof args.url === "string" ? args.url : "";
  if (!rawUrl) return "";

  const fallbackSegment = rawUrl.split(/[/?#]/).filter(Boolean).pop() ?? "";
  try {
    const parsed = new URL(rawUrl);
    const segment = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    return cleanLabel(decodeUrlPathSegment(segment));
  } catch {
    return cleanLabel(decodeUrlPathSegment(fallbackSegment));
  }
}

function decodeUrlPathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractUploadFileResultEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  if (params.toolName !== "upload_file") return [];

  const parsed = parseUploadFileResult(params.result);
  if (!parsed) return [];

  const id = Number(params.args.id);
  const key =
    compactKey(parsed.filename) || (Number.isFinite(id) ? `tag-${id}` : "file");

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:upload:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Uploaded file selected: ${parsed.filename} (${parsed.bytes} bytes)`,
        action: "upload",
        targetText: parsed.filename,
        source: "upload_file_result",
        ...(params.currentSnapshot?.url
          ? { url: params.currentSnapshot.url }
          : {}),
      },
    },
  ];
}

type UploadFileResultDetails = {
  filename: string;
  bytes: number;
};

function parseUploadFileResult(result: string): UploadFileResultDetails | null {
  const match = /^Uploaded\s+"([^"]{1,240})"\s+\((\d+)\s+bytes\)\s+to\b/i.exec(
    result.trim(),
  );
  if (!match?.[1] || !match[2]) return null;

  const filename = cleanLabel(match[1]);
  const bytes = Number(match[2]);
  if (!filename || !Number.isFinite(bytes) || bytes < 0) return null;

  return { filename, bytes };
}

function extractImportRowStateEvidenceFromToolOutcome(params: {
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
  if (params.toolName !== "upload_file") return [];

  const parsed = parseUploadFileResult(params.result);
  if (!parsed) return [];
  if (snapshotHasFormValidationText(current)) return [];
  if (findImportRowStateText(pre, parsed.filename)) return [];

  const rowText = findImportRowStateText(current, parsed.filename);
  if (!rowText) return [];

  const key = compactKey(parsed.filename) || compactKey(rowText) || "file";
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:import:row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Import row visible: ${parsed.filename}`,
        action: "import",
        targetText: parsed.filename,
        source: "import_row_state",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function findImportRowStateText(
  snapshot: DomSnapshot,
  filename: string,
): string | null {
  const row = snapshot.elements.find((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (!isWorkflowRowLikeElement(element)) return false;
    const text = workflowRowElementText(element);
    return (
      Boolean(text) &&
      workflowTargetLabelCoveredByText(filename, text) &&
      importRowTextHasImportedState(text)
    );
  });
  return row ? workflowRowElementText(row) : null;
}

function importRowTextHasImportedState(value: string): boolean {
  return /\b(?:imported|import\s+(?:complete|completed|successful)|processing\s+complete|processed\s+successfully|records?\s+imported|rows?\s+imported)\b/i.test(
    normalizeText(value),
  );
}

function extractAttachmentRowStateEvidenceFromToolOutcome(params: {
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
  if (params.toolName !== "upload_file") return [];

  const parsed = parseUploadFileResult(params.result);
  if (!parsed) return [];
  if (snapshotHasFormValidationText(current)) return [];
  if (findAttachmentRowStateText(pre, parsed.filename)) return [];

  const rowText = findAttachmentRowStateText(current, parsed.filename);
  if (!rowText) return [];

  const key = compactKey(parsed.filename) || compactKey(rowText) || "file";
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:attach:row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Attachment row visible: ${parsed.filename}`,
        action: "attach",
        targetText: parsed.filename,
        source: "attachment_row_state",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function findAttachmentRowStateText(
  snapshot: DomSnapshot,
  filename: string,
): string | null {
  const row = snapshot.elements.find((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (!isWorkflowRowLikeElement(element)) return false;
    const text = workflowRowElementText(element);
    return (
      Boolean(text) &&
      workflowTargetLabelCoveredByText(filename, text) &&
      attachmentRowTextHasAttachedState(text)
    );
  });
  return row ? workflowRowElementText(row) : null;
}

function attachmentRowTextHasAttachedState(value: string): boolean {
  return /\b(?:attached|attachment\s+(?:complete|completed|successful|uploaded)|file\s+attached|file\s+uploaded|uploaded)\b/i.test(
    normalizeText(value),
  );
}

function snapshotHasFormValidationText(snapshot: DomSnapshot): boolean {
  const text = [snapshot.title, snapshot.visibleContent, snapshot.pageContent]
    .filter(Boolean)
    .join("\n")
    .slice(0, 20_000);
  return /\b(?:error|invalid|missing|please fill|please enter|is required|are required|required field|cannot be blank|can't be blank|must be filled)\b/i.test(
    text,
  );
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

  const draft = findSubmittedDraftCandidate(pre, params.turn);
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

function extractSubmittedDraftRowEvidenceFromToolOutcome(params: {
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

  const draft = findSubmittedDraftCandidate(pre, params.turn);
  if (!draft) return [];
  if (snapshotHasFormValidationText(current)) return [];
  if (draftEditorStillContainsText(current, draft.detail.text, params.turn)) {
    return [];
  }
  if (findSubmittedDraftRowText(pre, draft.detail.text)) return [];

  const rowText = findSubmittedDraftRowText(current, draft.detail.text);
  if (!rowText) return [];

  const key =
    compactKey(draft.detail.target) ||
    compactKey(draft.detail.text) ||
    `tag-${id}`;
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:draft-row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `${action === "send" ? "Sent" : "Posted"} draft visible as row: ${draft.detail.target}`,
        action,
        targetText: cleanLabel(draft.detail.text),
        source: "submitted_draft_row",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function findSubmittedDraftCandidate(
  snapshot: DomSnapshot,
  turn: number,
): Extract<CompletionEvidence, { type: "draft_state" }> | null {
  return (
    extractDraftEvidence(snapshot, turn)
      .filter(
        (
          event,
        ): event is Extract<CompletionEvidence, { type: "draft_state" }> =>
          event.type === "draft_state" &&
          !event.detail.submitted &&
          tokenizeCompletionText(event.detail.text).length >= 3 &&
          cleanLabel(event.detail.text).length >= 12,
      )
      .sort((a, b) => b.detail.text.length - a.detail.text.length)[0] ?? null
  );
}

function draftEditorStillContainsText(
  snapshot: DomSnapshot,
  draftText: string,
  turn: number,
): boolean {
  const normalizedDraftText = normalizeText(draftText);
  if (!normalizedDraftText) return false;
  return extractDraftEvidence(snapshot, turn).some((event) => {
    if (event.type !== "draft_state") return false;
    const currentText = normalizeText(event.detail.text);
    return (
      currentText === normalizedDraftText ||
      currentText.includes(normalizedDraftText)
    );
  });
}

function findSubmittedDraftRowText(
  snapshot: DomSnapshot,
  draftText: string,
): string | null {
  const normalizedDraftText = normalizeText(draftText);
  if (!normalizedDraftText) return null;
  const row = snapshot.elements.find((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (!isWorkflowRowLikeElement(element)) return false;
    const text = workflowRowElementText(element);
    return Boolean(text) && normalizeText(text).includes(normalizedDraftText);
  });
  return row ? workflowRowElementText(row) : null;
}

function extractInviteRowStateEvidenceFromToolOutcome(params: {
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
  if (action !== "invite") return [];

  const target = inferWorkflowTargetTextFromControl(element, "invite");
  if (!target) return [];
  if (snapshotHasFormValidationText(current)) return [];
  if (findInviteRowStateText(pre, target)) return [];

  const rowText = findInviteRowStateText(current, target);
  if (!rowText) return [];

  const key = compactKey(target) || compactKey(rowText) || `tag-${id}`;
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:invite:row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Invitation row visible: ${target}`,
        action: "invite",
        targetText: target,
        source: "invite_row_state",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function findInviteRowStateText(
  snapshot: DomSnapshot,
  target: string,
): string | null {
  const row = snapshot.elements.find((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (!isWorkflowRowLikeElement(element)) return false;
    const text = workflowRowElementText(element);
    return (
      Boolean(text) &&
      workflowTargetLabelCoveredByText(target, text) &&
      inviteRowTextHasInvitationState(text)
    );
  });
  return row ? workflowRowElementText(row) : null;
}

function inviteRowTextHasInvitationState(value: string): boolean {
  return /\b(?:pending\s+invitation|invitation\s+pending|invitation\s+sent|invite\s+sent|invited|awaiting\s+(?:acceptance|response)|pending\s+acceptance)\b/i.test(
    normalizeText(value),
  );
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

  const beforeState = readControlState(element, action);
  const afterState = readControlState(currentElement, action);
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

function clickedDismissalControlLabelFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  preActionSnapshot?: DomSnapshot | null;
}): string | null {
  if (params.toolName !== "click_element") return null;
  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return null;
  const element = params.preActionSnapshot?.elements.find(
    (candidate) => candidate.tag === id,
  );
  if (!element || !isDismissalControl(element)) return null;
  const label = [
    element.text,
    element.attributes["aria-label"],
    element.attributes.label,
    element.attributes.value,
    element.attributes.title,
    element.attributes.id,
  ]
    .map((part) => cleanLabel(part ?? ""))
    .find(Boolean);
  return label ?? cleanLabel(elementControlText(element));
}

function snapshotHasVisibleDismissalControl(snapshot: DomSnapshot): boolean {
  return snapshot.elements.some(
    (element) =>
      element.isVisible !== false &&
      !element.isDisabled &&
      isDismissalControl(element),
  );
}

function snapshotHasConsentBannerContext(snapshot: DomSnapshot): boolean {
  const text = normalizeText(
    [
      snapshot.title,
      snapshot.visibleContent,
      snapshot.pageContent,
      ...snapshot.elements.flatMap((element) => [
        element.text,
        element.attributes["aria-label"],
        element.attributes.label,
        element.attributes.title,
        element.attributes.id,
      ]),
    ]
      .filter(Boolean)
      .join(" "),
  );
  return (
    /\b(?:cookie|cookies|consent|privacy|gdpr)\b/i.test(text) &&
    /\b(?:accept|reject|decline|allow|agree|got it|ok|okay|dismiss|close)\b/i.test(
      text,
    )
  );
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

  if (params.toolName === "hide_element") {
    return /^Hidden\s+(?:element|overlay ancestor)\s+\[[^\]]+\]\s+<[^>]+>/i.test(
      params.result.trim(),
    );
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
    case "like":
      return /\bliked\b/i.test(text);
    case "unlike":
      return /\bunliked\b/i.test(text);
    case "upvote":
      return /\bupvoted\b/i.test(text);
    case "downvote":
      return /\bdownvoted\b/i.test(text);
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
    new RegExp(`\\b${statusWord}\\s+(?:by|on|at|status|state|stage)\\b`, "i"),
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
    | "restart"
    | "refresh"
    | "approve"
    | "reject"
    | "close"
    | "reopen"
    | "escalate"
    | "deescalate"
    | "complete"
    | "submit"
    | "send"
    | "post"
    | "update"
    | "save"
    | "export"
    | "download"
    | "upload"
    | "import"
    | "copy"
    | "share"
    | "restore"
    | "duplicate"
    | "invite"
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
                                                        : action ===
                                                            "unbookmark"
                                                          ? "unbookmark"
                                                          : action ===
                                                              "bookmark"
                                                            ? "bookmark"
                                                            : action ===
                                                                "unfavorite"
                                                              ? "unfavorite"
                                                              : action ===
                                                                  "favorite"
                                                                ? "favorite"
                                                                : action ===
                                                                    "unpin"
                                                                  ? "unpin"
                                                                  : action ===
                                                                      "pin"
                                                                    ? "pin"
                                                                    : action ===
                                                                        "unmute"
                                                                      ? "unmute"
                                                                      : action ===
                                                                          "mute"
                                                                        ? "mute"
                                                                        : action ===
                                                                            "unschedule"
                                                                          ? "unschedule"
                                                                          : action ===
                                                                              "schedule"
                                                                            ? "schedule"
                                                                            : action ===
                                                                                "unassign"
                                                                              ? "unassign"
                                                                              : action ===
                                                                                  "assign"
                                                                                ? "assign"
                                                                                : action ===
                                                                                    "cancel"
                                                                                  ? "cancel"
                                                                                  : action ===
                                                                                      "unlock"
                                                                                    ? "unlock"
                                                                                    : action ===
                                                                                        "lock"
                                                                                      ? "lock"
                                                                                      : action ===
                                                                                          "enable"
                                                                                        ? "(?:enable|activate)"
                                                                                        : action ===
                                                                                            "disable"
                                                                                          ? "(?:disable|deactivate)"
                                                                                          : action ===
                                                                                              "pause"
                                                                                            ? "pause"
                                                                                            : action ===
                                                                                                "resume"
                                                                                              ? "resume"
                                                                                              : action ===
                                                                                                  "start"
                                                                                                ? "start"
                                                                                                : action ===
                                                                                                    "stop"
                                                                                                  ? "stop"
                                                                                                  : action ===
                                                                                                      "restart"
                                                                                                    ? "restart"
                                                                                                    : action ===
                                                                                                        "refresh"
                                                                                                      ? "refresh"
                                                                                                      : action ===
                                                                                                          "approve"
                                                                                                        ? "approve"
                                                                                                        : action ===
                                                                                                            "reject"
                                                                                                          ? "(?:reject|deny)"
                                                                                                          : action ===
                                                                                                              "close"
                                                                                                            ? "(?:close|resolve)"
                                                                                                            : action ===
                                                                                                                "reopen"
                                                                                                              ? "(?:re[-\\s]?open)"
                                                                                                              : action ===
                                                                                                                  "escalate"
                                                                                                                ? "escalate"
                                                                                                                : action ===
                                                                                                                    "deescalate"
                                                                                                                  ? "(?:de[-\\s]?escalate)"
                                                                                                                  : action ===
                                                                                                                      "complete"
                                                                                                                    ? "(?:complete|mark|set)"
                                                                                                                    : action ===
                                                                                                                        "submit"
                                                                                                                      ? "submit"
                                                                                                                      : action ===
                                                                                                                          "send"
                                                                                                                        ? "(?:send|email)"
                                                                                                                        : action ===
                                                                                                                            "post"
                                                                                                                          ? "(?:post|publish)"
                                                                                                                          : action ===
                                                                                                                              "update"
                                                                                                                            ? "(?:update|apply(?:\\s+changes)?(?:\\s+to)?)"
                                                                                                                            : action ===
                                                                                                                                "save"
                                                                                                                              ? "save"
                                                                                                                              : action ===
                                                                                                                                  "export"
                                                                                                                                ? "export"
                                                                                                                                : action ===
                                                                                                                                    "download"
                                                                                                                                  ? "download"
                                                                                                                                  : action ===
                                                                                                                                      "upload"
                                                                                                                                    ? "upload"
                                                                                                                                    : action ===
                                                                                                                                        "import"
                                                                                                                                      ? "import"
                                                                                                                                      : action ===
                                                                                                                                          "copy"
                                                                                                                                        ? "copy"
                                                                                                                                        : action ===
                                                                                                                                            "share"
                                                                                                                                          ? "share"
                                                                                                                                          : action ===
                                                                                                                                              "restore"
                                                                                                                                            ? "(?:restore|recover|reinstate)"
                                                                                                                                            : action ===
                                                                                                                                                "duplicate"
                                                                                                                                              ? "(?:duplicate|clone)"
                                                                                                                                              : action ===
                                                                                                                                                  "invite"
                                                                                                                                                ? "invite"
                                                                                                                                                : action ===
                                                                                                                                                    "grant"
                                                                                                                                                  ? "grant"
                                                                                                                                                  : action ===
                                                                                                                                                      "revoke"
                                                                                                                                                    ? "(?:revoke|revocation)"
                                                                                                                                                    : action ===
                                                                                                                                                        "unblock"
                                                                                                                                                      ? "unblock"
                                                                                                                                                      : action ===
                                                                                                                                                          "block"
                                                                                                                                                        ? "block"
                                                                                                                                                        : action ===
                                                                                                                                                            "unsuspend"
                                                                                                                                                          ? "unsuspend"
                                                                                                                                                          : action ===
                                                                                                                                                              "suspend"
                                                                                                                                                            ? "suspend"
                                                                                                                                                            : action ===
                                                                                                                                                                "backup"
                                                                                                                                                              ? "(?:back\\s+up|backup)"
                                                                                                                                                              : action ===
                                                                                                                                                                  "deploy"
                                                                                                                                                                ? "deploy"
                                                                                                                                                                : action ===
                                                                                                                                                                    "rollback"
                                                                                                                                                                  ? "(?:roll\\s+back|rollback|revert|reversion)"
                                                                                                                                                                  : action ===
                                                                                                                                                                      "reset"
                                                                                                                                                                    ? "reset"
                                                                                                                                                                    : action ===
                                                                                                                                                                        "install"
                                                                                                                                                                      ? "install"
                                                                                                                                                                      : "uninstall";
    const explicit = new RegExp(
      `\\b${actionPattern}\\b\\s+(?:the\\s+)?(.{3,120})`,
      "i",
    ).exec(candidate);
    if (!explicit?.[1]) continue;
    const rawTarget = cleanLabel(explicit[1]);
    let target = rawTarget
      .replace(
        /\b(?:button|link|action|delete|remove|archive|attach|attached|attaching|detach|disconnect|disconnection|connect|connected|connecting|connection|sync|synced|syncing|synchronize|synchronized|synchronizing|synchronization|transfer|transferred|transferring|move|moved|moving|rename|renamed|renaming|merge|merged|merging|unlink|untag|untagging|tag|tagged|tagging|unflag|unflagging|flag|flagged|flagging|unsubscribe|unsubscribed|unsubscription|subscribe|subscribed|subscription|unfollow|unfollowed|follow|followed|unwatch|unwatched|watch|watched|watching|unstar|unstarred|star|starred|starring|unbookmark|unbookmarked|bookmark|bookmarked|bookmarking|unfavorite|unfavorited|favorite|favorited|favoriting|unpin|unpinned|pin|pinned|pinning|unmute|unmuted|mute|muted|muting|unschedule|unscheduled|schedule|scheduled|scheduling|unassign|unassigned|assign|assigned|assignment|assignee|cancel|canceled|cancelled|cancellation|unlock|unlocked|lock|locked|enable|enabled|activate|activated|activation|disable|disabled|deactivate|deactivated|deactivation|pause|paused|pausing|resume|resumed|resuming|start|started|starting|stop|stopped|stopping|restart|restarted|restarting|refresh|refreshed|refreshing|approve|approved|approving|approval|reject|rejected|rejecting|rejection|deny|denied|denial|close|closed|closing|closure|resolve|resolved|resolving|resolution|re[-\s]?open|re[-\s]?opened|re[-\s]?opening|de[-\s]?escalate|de[-\s]?escalated|de[-\s]?escalating|de[-\s]?escalation|escalate|escalated|escalating|escalation|complete|completed|completing|completion|submit|submitted|submission|send|sent|sending|email|emailed|emailing|post|posted|posting|publish|published|publishing|update|updated|updating|save|saved|saving|export|exported|exporting|download|downloaded|downloading|upload|uploaded|uploading|import|imported|importing|copy|copied|copying|share|shared|sharing|restore|restored|restoring|recover|recovered|recovering|reinstate|reinstated|reinstating|duplicate|duplicated|duplicating|duplication|clone|cloned|cloning|invite|invited|inviting|invitation|grant|granted|granting|revoke|revocation|unblock|block|blocking|unsuspend|suspend|suspension|back\s+up|backup|backed\s+up|backing\s+up|deploy|deployed|deploying|deployment|rollback|rolled\s+back|rolling\s+back|revert|reverted|reverting|reversion|reset|resetting|install|installed|installing|installation|uninstall)\b/gi,
        " ",
      )
      .replace(/\b(?:item|entry|row|record)\b/gi, " ")
      .replace(/^["'`]+|["'`]+$/g, "");
    target = cleanLabel(target);
    if (action === "copy" && tokenizeCompletionText(rawTarget).length > 1) {
      target = rawTarget;
    }
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
          "article",
          "articles",
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
          "browser",
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
          "dashboard",
          "dashboards",
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
          "import",
          "imported",
          "importing",
          "copy",
          "copied",
          "copying",
          "clipboard",
          "comment",
          "comments",
          "share",
          "shared",
          "sharing",
          "restore",
          "restored",
          "restoring",
          "recover",
          "recovered",
          "recovering",
          "reinstate",
          "reinstated",
          "reinstating",
          "duplicate",
          "duplicated",
          "duplicating",
          "duplication",
          "clone",
          "cloned",
          "cloning",
          "invite",
          "invited",
          "inviting",
          "invitation",
          "contact",
          "contacts",
          "guest",
          "guests",
          "member",
          "members",
          "person",
          "people",
          "user",
          "users",
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
          "page",
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
          "refresh",
          "refreshed",
          "refreshing",
          "restart",
          "restarted",
          "restarting",
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
          "screen",
          "screens",
          "send",
          "sent",
          "sending",
          "email",
          "emailed",
          "emailing",
          "message",
          "messages",
          "post",
          "posts",
          "posted",
          "posting",
          "publish",
          "published",
          "publishing",
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
          "tab",
          "tabs",
          "task",
          "tasks",
          "template",
          "templates",
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
          "window",
          "windows",
          "workflow",
        ].includes(token),
    );
    if (tokens.length > 0) return target;
  }
  return null;
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
    const semanticAttrText = normalizeText(
      [
        attrs.role,
        attrs["aria-modal"],
        attrs["aria-label"],
        attrs.label,
        attrs.id,
        attrs.name,
        attrs.class,
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
        semanticAttrText,
      ) &&
      (element.rect.width > 0 || element.rect.height > 0);

    if (!isSemanticDialog && !isKnownOverlay && !isNamedModal) continue;

    const label = cleanLabel(
      [element.text, attrs["aria-label"], attrs.label, attrs.name, attrs.id]
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

function readControlState(
  element: TaggedElement,
  action?: ControlStateWorkflowAction,
): boolean | null {
  const state =
    element.attributes.checked ??
    element.attributes["aria-checked"] ??
    element.attributes["aria-pressed"] ??
    element.attributes["aria-selected"] ??
    element.attributes.selected ??
    element.attributes["data-state"] ??
    element.attributes["data-checked"] ??
    element.attributes["data-pressed"] ??
    element.attributes["data-selected"];
  return readControlStateValue(state, action);
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

function getGroundedLabelValueQuestionLabel(
  question: string,
  snapshot?: DomSnapshot | null,
): string | null {
  if (!snapshot) return null;
  const pageText = snapshotPageText(snapshot);
  if (!hasSubstantiveReadAnswerEvidence(pageText)) return null;
  return findGroundedLabelValueQuestionLabel(normalizeText(question), pageText);
}

function getGroundedRowScopedLabelValueQuestion(
  question: string,
  snapshot?: DomSnapshot | null,
): { label: string; target: string } | null {
  if (!snapshot) return null;
  return findGroundedRowScopedLabelValueQuestion(question, snapshot);
}

function getGroundedSentenceScopedAnswer(
  question: string,
  snapshot?: DomSnapshot | null,
): { label: string; target: string } | null {
  if (!snapshot) return null;
  return findGroundedSentenceScopedAnswer(question, snapshotPageText(snapshot));
}

function getGroundedRowScopedSuperlativeMetricAnswer(
  question: string,
  snapshot?: DomSnapshot | null,
): { label: string; target: string } | null {
  if (!snapshot) return null;
  const superlativeMetricQuestion =
    extractSentenceScopedSuperlativeMetricQuestionParts(question);
  if (!superlativeMetricQuestion) return null;

  const winner = findReadAnswerSuperlativeMetricWinnerFromSnapshotRows(
    snapshot,
    superlativeMetricQuestion.metric,
    superlativeMetricQuestion.direction,
  );
  if (!winner) return null;

  return {
    label: superlativeMetricQuestion.label,
    target: winner.target,
  };
}

function getGroundedRowScopedMetricAggregateAnswer(
  question: string,
  snapshot?: DomSnapshot | null,
): { label: string } | null {
  if (!snapshot) return null;
  const metricAggregateQuestion =
    extractRowScopedMetricAggregateQuestionParts(question);
  if (!metricAggregateQuestion) return null;

  const aggregate = findReadAnswerMetricAggregateFromSnapshotRows(
    snapshot,
    metricAggregateQuestion.label,
  );
  return aggregate ? { label: metricAggregateQuestion.label } : null;
}

function findReadAnswerRowScopedLabelValueLine(
  evidenceText: string,
  target: string,
  expectedAnswerLabel: string,
): string | null {
  const lines = evidenceText
    .split(/[\r\n]+/g)
    .map((line) => cleanLabel(line))
    .filter(Boolean);
  if (lines.length < 2) return null;

  for (const line of lines) {
    if (line.length > 500) continue;
    if (!workflowTargetLabelCoveredByText(target, line)) continue;
    if (!extractExpectedLabelValueAnswer(line, expectedAnswerLabel)) continue;
    return line;
  }
  return null;
}

function findReadAnswerSuperlativeMetricWinnerFromSnapshotRows(
  snapshot: DomSnapshot,
  metric: string,
  direction: SentenceScopedSuperlativeDirection,
): ReadAnswerSuperlativeMetricCandidate | null {
  const candidates = snapshot.elements
    .filter((element) => element.isVisible && !element.isDisabled)
    .filter(isWorkflowRowLikeElement)
    .map(readAnswerRowElementText)
    .map((rowText) => cleanLabel(rowText))
    .filter(Boolean)
    .filter((rowText) => rowText.length <= 500)
    .map((rowText) =>
      extractReadAnswerSuperlativeMetricCandidate(rowText, metric),
    )
    .filter(
      (candidate): candidate is ReadAnswerSuperlativeMetricCandidate =>
        candidate !== null,
    );
  return selectReadAnswerSuperlativeMetricWinner(candidates, direction);
}

function cleanReadAnswerEvidenceText(
  value: string,
  options: { preserveLines?: boolean } = {},
): string {
  const cleaned = value
    .replace(/^Page\s+(?:content|text|read)\s*:\s*/i, "")
    .replace(/^Result\s*:\s*/i, "");
  if (!options.preserveLines) return cleanLabel(cleaned);
  return cleaned
    .split(/[\r\n]+/g)
    .map((line) => cleanLabel(line))
    .filter(Boolean)
    .join("\n");
}

function readAnswerSummaryMatchesSentenceScopedAnswer(
  summary: string,
  expectedAnswer: string,
): boolean {
  const valueWords = cleanLabel(expectedAnswer).split(/\s+/).filter(Boolean);
  if (valueWords.length === 0) return false;

  const normalizedSummary = normalizeText(summary);
  if (valueWords.length >= 2) {
    return labelValuePhraseCoveredBySummary(normalizedSummary, valueWords);
  }
  const normalizedValue = normalizeText(valueWords[0]);
  if (normalizedValue === "zero" || normalizedValue === "0") {
    return (
      valueTokenCoveredBySummary(normalizedSummary, "zero") ||
      valueTokenCoveredBySummary(normalizedSummary, "0")
    );
  }
  return valueTokenCoveredBySummary(normalizedSummary, normalizedValue);
}

const USER_CONTEXT_MARKERS: RegExp[] = [
  /\bStay focused on this goal\b/i,
  /\s##\s+/i,
  /\n\s*(?:Objective|Success criteria|Page Context|Page history[^\n:]*|Prior actions[^\n:]*|Current task|Relevant context|Planner assumptions|Selected workflow skill|Skill procedure|Skill evidence requirements|Skill execution contract|Handoff context|Execution policy|Parallel work context|Step-scoped task context|Reality check signal|Original user request[^\n:]*|Pre-execution advisory)\s*:/i,
];

const CURRENT_OBJECTIVE_MARKERS: RegExp[] = [
  /\n\s*(?:Success criteria|Planner assumptions|Selected workflow skill|Skill procedure|Skill evidence requirements|Skill execution contract|Handoff context|Execution policy|Parallel work context|Step-scoped task context|Reality check signal|Original user request[^\n:]*|Page history[^\n:]*|Prior actions[^\n:]*|Pre-execution advisory)\s*:/i,
  /\s##\s+/i,
];

const CURRENT_SUCCESS_CRITERIA_MARKERS: RegExp[] = [
  /\n\s*(?:Planner assumptions|Selected workflow skill|Skill procedure|Skill evidence requirements|Skill execution contract|Handoff context|Execution policy|Parallel work context|Step-scoped task context|Reality check signal|Original user request[^\n:]*|Page history[^\n:]*|Prior actions[^\n:]*|Pre-execution advisory)\s*:/i,
  /\s##\s+/i,
];

function extractCanonicalUserRequest(value: string): string {
  const originalUserRequest = extractLabeledRequest(value, [
    ...USER_CONTEXT_MARKERS,
  ]);
  if (originalUserRequest) return originalUserRequest;

  const workflowMatch =
    /\bcomplete the workflow for the original request\s*:\s*([\s\S]*)/i.exec(
      value,
    );
  if (workflowMatch) {
    const request = takeUntilFirstMarker(workflowMatch[1], [
      /\n\s*(?:Success criteria|Page Context|Page history[^\n:]*|Prior actions[^\n:]*|Current task|Relevant context|Planner assumptions|Selected workflow skill|Skill procedure|Skill evidence requirements|Skill execution contract|Handoff context|Execution policy|Parallel work context|Step-scoped task context|Reality check signal|Original user request[^\n:]*|Pre-execution advisory)\s*:/i,
      /\s+Success criteria\s*:/i,
      /\s##\s+/i,
    ]);
    if (request) return request;
  }

  return cleanLabel(value);
}

function extractCurrentObjectiveRequestText(value: string): string {
  const objective = extractPromptSection(
    value,
    "Objective",
    CURRENT_OBJECTIVE_MARKERS,
  );
  const successCriteria = extractPromptSection(
    value,
    "Success criteria",
    CURRENT_SUCCESS_CRITERIA_MARKERS,
  );
  return [objective, successCriteria].filter(Boolean).join("\n");
}

function extractPromptSection(
  value: string,
  label: string,
  markers: RegExp[],
): string | null {
  const match = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*`, "i").exec(value);
  if (!match) return null;
  return takeUntilFirstMarker(
    value.slice(match.index + match[0].length),
    markers,
  );
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
