/**
 * Quiz/choice observation analysis for quiz-selection completion
 * (RFC LP-16 Phase 1). Extracts checkbox/radio choice observations from a
 * snapshot, infers selection cardinality and question numbers, and matches
 * selected labels against quiz targets. Verbatim movement from
 * completion-kernel.ts; a closed call-set depending only on shared types.
 */
import type { DomSnapshot, TaggedElement } from "../../../types";
import type {
  ChoiceKind,
  ChoiceObservation,
  CompletionEvidence,
  QuizSelectionContract,
} from "./kernel-types";
import { cleanLabel, importantLabelTokens, normalizeText } from "./text-utils";
import { readChecked } from "./form-field-analysis";

const NUMBER_WORDS = new Map<string, number>([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
]);

export function extractChoiceObservations(snapshot: DomSnapshot): ChoiceObservation[] {
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

export function findChoiceObservationByElementId(
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

function bestChoiceLabel(element: TaggedElement, associated?: string): string {
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

export function inferSelectionCardinality(
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

export function extractVisibleQuestionNumber(
  snapshot: DomSnapshot | null | undefined,
): number | undefined {
  if (!snapshot) return undefined;
  return extractExplicitQuestionNumber(snapshotText(snapshot));
}

export function extractExplicitQuestionNumber(text: string): number | undefined {
  const question = /\bquestion\s*#?\s*(\d{1,4})\b/i.exec(text)?.[1];
  if (question) return Number(question);
  const fraction = /\b(\d{1,4})\s*\/\s*\d{1,4}\b/.exec(text)?.[1];
  return fraction ? Number(fraction) : undefined;
}

export function matchesQuizTarget(
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

export function expectedSelectionsMatch(
  expectedSelections: string[],
  selected: Array<Extract<CompletionEvidence, { type: "selected_state" }>>,
): boolean {
  const selectedText = normalizeText(
    selected.map((event) => event.detail.label).join("\n"),
  );
  return expectedSelections.every((expected) =>
    importantLabelTokens(expected).some((token) =>
      selectedText.includes(token),
    ),
  );
}

export function selectedLabelsCoveredBySummary(
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
