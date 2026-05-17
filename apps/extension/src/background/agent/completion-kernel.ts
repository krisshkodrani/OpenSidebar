import type { DomSnapshot, TaggedElement, ToolName } from "../../types";

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

export type CompletionContract = QuizSelectionContract;

export interface GeneratedCompletionContract {
  contract: CompletionContract;
  confidence: "low" | "medium" | "high";
  source: "heuristic" | "planner" | "task_contract" | "skill";
  repairable: boolean;
  notes: string[];
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

  const choices = extractChoiceObservations(snapshot);
  if (choices.length < 2) return null;

  const requestText = normalizeText(params.userRequest);
  const combinedText = normalizeText(
    [params.userRequest, params.activeObjective, params.successCriteria]
      .filter(Boolean)
      .join("\n"),
  );
  if (!hasQuizSelectionIntent(combinedText)) return null;

  const visibleQuestionNumber = extractVisibleQuestionNumber(snapshot);
  const explicitUserQuestion = extractExplicitQuestionNumber(params.userRequest);
  const explicitObjectiveQuestion = extractExplicitQuestionNumber(
    params.activeObjective ?? "",
  );
  const deicticUserRequest =
    /\b(?:here|current|this|these|visible|on screen|what should i choose)\b/i.test(
      params.userRequest,
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

export function deriveCompletionEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const checked = params.args.checked;
  const id = Number(params.args.id);
  if (
    params.toolName !== "set_checkbox" ||
    typeof checked !== "boolean" ||
    !Number.isFinite(id) ||
    /^Error:/i.test(params.result)
  ) {
    return [];
  }

  const sourceSnapshot = params.currentSnapshot ?? params.preActionSnapshot;
  const choice =
    findChoiceObservationByElementId(sourceSnapshot, id) ??
    findChoiceObservationByElementId(params.preActionSnapshot, id);
  if (!choice) return [];

  return [
    selectedStateEvidence({
      ...choice,
      checked,
      confidence: "high",
      observedAtTurn: params.turn,
    }),
  ];
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
  const feedbackEvidence = extractFeedbackEvidence(snapshot, turn);
  return [...selectedEvidence, ...feedbackEvidence];
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
    return (
      "Completion evidence indicates the requested quiz selections are already applied. " +
      'Call done({"summary":"..."}) now with the selected option names instead of exploring further.'
    );
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
  const selected = selectedStateEvidence.filter((event) => event.detail.checked);
  const negativeEvidence = params.evidence.find(
    (event) => event.type === "validation_error",
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

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactKey(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").slice(0, 120);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function evidenceConfidenceRank(event: CompletionEvidence): number {
  return event.confidence === "high" ? 2 : 1;
}
