import type { DomSnapshot } from "../../../types";
import type {
  ChoiceObservation, CompletionConfidence, CompletionEvidence,
  FormFieldObservation,
} from "./kernel-types";
import { cleanLabel, compactKey } from "./text-utils";
import { extractVisibleQuestionNumber } from "./quiz-choice-analysis";
import { extractFormFieldObservations } from "./form-field-analysis";
import { workflowConfirmationTextCorpus } from "./workflow-confirmation-contract";
import {
  extractCartCreationSnippet, extractTransactionalConfirmationSnippet,
  isTransactionalConfirmationAction, textConfirmsWorkflowAction,
  workflowActionTermPattern,
} from "./workflow-confirmation-analysis";
import { WORKFLOW_CONFIRMATION_ACTIONS, type WorkflowConfirmationAction }
  from "./workflow-confirmation-types";

export function fieldValueEvidence(
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

export function selectedStateEvidence(
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

export function extractFeedbackEvidence(
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

export function extractValidationErrorEvidence(
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

export function extractFormConfirmationEvidence(
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

export function extractWorkflowConfirmationEvidence(
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
