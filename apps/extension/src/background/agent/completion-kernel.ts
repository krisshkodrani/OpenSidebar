import type { DomSnapshot, TaggedElement, ToolName } from "../../types";
import {
  hasDraftPreservedEvidence,
  hasStrongCommunicationSentEvidence,
  isDraftOnlyCommunicationTask,
} from "./consequential-action-policy";

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

export type WorkflowConfirmationAction =
  | "delete"
  | "save"
  | "send"
  | "post"
  | "approve"
  | "reject"
  | "close"
  | "dismiss"
  | "update"
  | "submit";

export interface WorkflowConfirmationContract {
  kind: "workflow_confirmation";
  action: WorkflowConfirmationAction;
}

export type CompletionContract =
  | QuizSelectionContract
  | FormFillContract
  | NavigationContract
  | DraftOnlyContract
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
  const snapshot = params.snapshot;
  if (!snapshot) return null;

  const quizContract = generateQuizSelectionContract(params, snapshot);
  if (quizContract) return quizContract;

  const draftOnlyContract = generateDraftOnlyContract(params, snapshot);
  if (draftOnlyContract) return draftOnlyContract;

  const formContract = generateFormFillContract(params, snapshot);
  if (formContract) return formContract;

  const navigationContract = generateNavigationContract(params, snapshot);
  if (navigationContract) return navigationContract;

  const workflowConfirmationContract = generateWorkflowConfirmationContract(
    params,
    snapshot,
  );
  if (workflowConfirmationContract) return workflowConfirmationContract;

  return null;
}

function generateDraftOnlyContract(
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

  return {
    contract: {
      kind: "workflow_confirmation",
      action,
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
          text: (params.evidenceText ?? params.summary).slice(0, 1000),
          ...(params.recordId ? { recordId: params.recordId } : {}),
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
  const confirmation = confirmations[0];
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
    reason: `Workflow confirmation contract is satisfied by visible ${contract.action} confirmation evidence.`,
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
  if (/\b(?:delete|deleted|deletion|remove|removed|removal)\b/i.test(text)) {
    return "delete";
  }
  if (/\b(?:save|saved)\b/i.test(text)) return "save";
  if (/\b(?:send|sent)\b/i.test(text)) return "send";
  if (/\b(?:post|posted|publish|published)\b/i.test(text)) return "post";
  if (/\b(?:approve|approved)\b/i.test(text)) return "approve";
  if (/\b(?:reject|rejected)\b/i.test(text)) return "reject";
  if (/\b(?:close|closed)\b/i.test(text)) return "close";
  if (/\b(?:dismiss|dismissed)\b/i.test(text)) return "dismiss";
  if (/\b(?:update|updated|change|changed|apply|applied)\b/i.test(text)) {
    return "update";
  }
  if (/\b(?:submit|submitted|submission)\b/i.test(text)) return "submit";
  return null;
}

function isBrowserManagementWorkflowRequest(value: string): boolean {
  return (
    /\b(?:tab|tabs|window|windows|browser)\b/i.test(value) &&
    /\b(?:close|closed|switch|open|activate|focus|navigate)\b/i.test(value)
  );
}

function summaryConfirmsWorkflowAction(
  summary: string,
  action: WorkflowConfirmationAction,
): boolean {
  const text = normalizeText(summary);
  switch (action) {
    case "delete":
      return /\b(?:deleted|removed|deletion|removal)\b/i.test(text);
    case "save":
      return /\bsaved\b/i.test(text);
    case "send":
      return /\bsent\b/i.test(text);
    case "post":
      return /\b(?:posted|published)\b/i.test(text);
    case "approve":
      return /\bapproved\b/i.test(text);
    case "reject":
      return /\brejected\b/i.test(text);
    case "close":
      return /\bclosed\b/i.test(text);
    case "dismiss":
      return /\bdismissed\b/i.test(text);
    case "update":
      return /\b(?:updated|changed|applied)\b/i.test(text);
    case "submit":
      return /\b(?:submitted|submission)\b/i.test(text);
  }
  return false;
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

  if (
    /\b(?:deleted|removed)\s+successfully\b/i.test(text) ||
    /\b(?:deletion|removal)\s+(?:complete|completed|confirmed|successful)\b/i.test(
      text,
    )
  ) {
    actions.add("delete");
  }
  if (
    /\b(?:saved|changes saved)\s+successfully\b/i.test(text) ||
    /\bsuccessfully\s+saved\b/i.test(text)
  ) {
    actions.add("save");
  }
  if (
    /\b(?:sent)\s+successfully\b/i.test(text) ||
    /\b(?:message|email|notification)\s+sent\b/i.test(text)
  ) {
    actions.add("send");
  }
  if (
    /\b(?:posted|published)\s+successfully\b/i.test(text) ||
    /\b(?:comment|reply|post)\s+posted\b/i.test(text)
  ) {
    actions.add("post");
  }
  if (/\bapproved\s+successfully\b/i.test(text)) actions.add("approve");
  if (/\brejected\s+successfully\b/i.test(text)) actions.add("reject");
  if (/\bclosed\s+successfully\b/i.test(text)) actions.add("close");
  if (/\bdismissed\s+successfully\b/i.test(text)) actions.add("dismiss");
  if (
    /\b(?:updated|changed|applied)\s+successfully\b/i.test(text) ||
    /\b(?:changes|settings)\s+(?:updated|applied)\b/i.test(text)
  ) {
    actions.add("update");
  }
  if (
    /\bsubmitted\s+successfully\b/i.test(text) ||
    /\bsubmission\s+(?:complete|completed|successful)\b/i.test(text)
  ) {
    actions.add("submit");
  }

  return [...actions].map((action) => ({
    type: "confirmation_state" as const,
    confidence: "medium" as const,
    logicalKey: `workflow:confirmation:${action}`,
    observedAtTurn: turn,
    detail: {
      text: cleanLabel(
        snapshot.visibleContent || snapshot.pageContent || snapshot.title,
      ).slice(0, 1000),
      action,
      ...(snapshot.url ? { url: snapshot.url } : {}),
    },
  }));
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
