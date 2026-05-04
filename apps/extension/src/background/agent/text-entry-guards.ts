import type { DomSnapshot } from "../../types";
import { rectsLikelyOverlap } from "./geometry";

export function normalizeGuardText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

export function isTextLikeInputElement(
  element: DomSnapshot["elements"][number] | null | undefined,
): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  if (tag !== "input" && tag !== "textarea") return false;
  const type = String(element.attributes.type || "").toLowerCase();
  return ![
    "radio",
    "checkbox",
    "button",
    "submit",
    "reset",
    "file",
    "hidden",
  ].includes(type);
}

function inferElementInputKind(
  element: DomSnapshot["elements"][number] | null | undefined,
): "email" | "name" | "coupon" | null {
  if (!element) return null;
  const labels = [
    element.text,
    element.attributes["aria-label"],
    element.attributes.placeholder,
    element.attributes.id,
    element.attributes.name,
  ]
    .map((value) => normalizeGuardText(value))
    .filter(Boolean);
  const labelBlob = labels.join(" ");

  // Only classify as "email" if it's specifically an email input, not a
  // search/filter field that mentions email as one of several criteria.
  const inputType = element.attributes?.type?.toLowerCase();
  if (inputType === "email") return "email";
  if (labelBlob.includes("email") && !labelBlob.includes("search")) {
    return "email";
  }
  if (labelBlob.includes("full name") || labelBlob.includes("name")) {
    return "name";
  }
  if (
    labelBlob.includes("coupon") ||
    labelBlob.includes("promo") ||
    /^[A-Z0-9-]{4,12}$/.test(String(element.attributes.placeholder || "")) ||
    /^[A-Z0-9-]{4,12}$/.test(String(element.attributes.value || ""))
  ) {
    return "coupon";
  }

  return null;
}

function inferTextValueKind(value: string): "email" | "name" | "coupon" | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(trimmed)) {
    return "email";
  }
  if (/^[A-Z0-9-]{4,12}$/.test(trimmed)) {
    return "coupon";
  }
  if (/^[A-Za-z][A-Za-z .'-]{1,80}$/.test(trimmed)) {
    return "name";
  }
  return null;
}

export function extractExplicitInputValueForElement(
  objectiveText: string,
  element: DomSnapshot["elements"][number] | null | undefined,
): string | null {
  if (!element || !objectiveText) return null;
  const objective = objectiveText.trim();
  if (!objective) return null;

  const labels = [
    element.text,
    element.attributes["aria-label"],
    element.attributes.placeholder,
    element.attributes.id,
    element.attributes.name,
  ]
    .map((value) => normalizeGuardText(value))
    .filter(Boolean);
  const labelBlob = labels.join(" ");

  if (labelBlob.includes("email")) {
    const emailMatch = objective.match(
      /email(?: address)?[^.\n]{0,40}\bwith\b\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
    );
    if (emailMatch?.[1]) return emailMatch[1];
  }

  if (labelBlob.includes("name")) {
    const nameMatch = objective.match(
      /(full name|name)[^.\n]{0,40}\bwith\b\s+([A-Za-z][A-Za-z .'-]{1,80})/i,
    );
    if (nameMatch?.[2]) return nameMatch[2].trim();
  }

  if (
    labelBlob.includes("coupon") ||
    labelBlob.includes("promo") ||
    /^[A-Z0-9-]{4,12}$/.test(String(element.attributes.placeholder || "")) ||
    /^[A-Z0-9-]{4,12}$/.test(String(element.attributes.value || ""))
  ) {
    const codeMatch = objective.match(
      /\b(?:apply|enter|type)\s+([A-Z0-9-]{4,12})\b/,
    );
    if (codeMatch?.[1]) return codeMatch[1];
  }

  return null;
}

export function validateTextEntryTarget(
  objectiveText: string,
  element: DomSnapshot["elements"][number] | null | undefined,
  typedText: string,
): string | null {
  if (!element) return null;
  if (!isTextLikeInputElement(element)) {
    return `Error: [${element.tag}] is not a text-entry field. Use a real input like the "${typedText}" field instead.`;
  }

  const expectedValue = extractExplicitInputValueForElement(
    objectiveText,
    element,
  );
  if (expectedValue && typedText.trim() !== expectedValue) {
    return (
      `Error: This step expects "${expectedValue}" in [${element.tag}], not "${typedText.trim()}". ` +
      `Choose the field that matches the requested value.`
    );
  }

  const targetKind = inferElementInputKind(element);
  const typedKind = inferTextValueKind(typedText);
  if (targetKind && typedKind && targetKind !== typedKind) {
    return (
      `Error: [${element.tag}] looks like a ${targetKind} field, but "${typedText.trim()}" looks like ${typedKind} data. ` +
      `Type into the matching field instead.`
    );
  }

  return null;
}

export interface TextEntryClickGuardDecision {
  blockReason: string | null;
  explicitValue: string | null;
}

export function assessTextEntryClickGuard(params: {
  objectiveText: string;
  element: DomSnapshot["elements"][number] | null | undefined;
  targetId: number;
}): TextEntryClickGuardDecision {
  const explicitValue = extractExplicitInputValueForElement(
    params.objectiveText,
    params.element,
  );
  if (!isTextLikeInputElement(params.element) || !explicitValue) {
    return { blockReason: null, explicitValue };
  }

  return {
    explicitValue,
    blockReason:
      `Error: This step requires entering "${explicitValue}" into [${params.targetId}]. ` +
      `Use type_text instead of click_element on this input.`,
  };
}

export function assessInlineEditTextEntryRetarget(params: {
  activeToolProfile: string | null | undefined;
  snapshot: DomSnapshot | null | undefined;
  targetId: number;
}): { retargetedId: number; reason: string } | null {
  if (params.activeToolProfile !== "edit_surface") return null;

  const target = params.snapshot?.elements?.find(
    (element) => element.tag === params.targetId,
  );
  if (!target || isTextLikeInputElement(target)) return null;

  const visibleTextInputs =
    params.snapshot?.elements?.filter(
      (element) =>
        element.isVisible !== false && isTextLikeInputElement(element),
    ) ?? [];
  if (visibleTextInputs.length === 0) return null;

  const targetText = normalizeGuardText(target.text);
  const retarget =
    visibleTextInputs.find((element) =>
      rectsLikelyOverlap(target.rect, element.rect),
    ) ??
    visibleTextInputs.find((element) => {
      const liveValue = normalizeGuardText(
        element.attributes.value || element.text,
      );
      return Boolean(targetText) && liveValue === targetText;
    });
  if (!retarget) return null;

  return {
    retargetedId: retarget.tag,
    reason:
      `Retargeted type_text from [${params.targetId}] to the active inline editor ` +
      `[${retarget.tag}] for this edit-surface step.`,
  };
}

function isAutocompleteLikeElement(
  element: DomSnapshot["elements"][number] | null | undefined,
): boolean {
  if (!element) return false;
  if (!isTextLikeInputElement(element)) return false;

  const attrs = element.attributes || {};
  const role = normalizeGuardText(element.role);
  const semanticAttributeBlob = [
    element.text,
    attrs["aria-label"],
    attrs.label,
    attrs.placeholder,
    attrs["aria-controls"],
    attrs["aria-haspopup"],
    attrs["aria-autocomplete"],
    attrs.list,
  ]
    .map((value) => normalizeGuardText(value))
    .filter(Boolean)
    .join(" ");

  const identifierBlob = [attrs.id, attrs.name, attrs.autocomplete]
    .map((value) => normalizeGuardText(value))
    .filter(Boolean)
    .join(" ");

  return (
    role === "combobox" ||
    role === "listbox" ||
    "aria-autocomplete" in attrs ||
    "list" in attrs ||
    /listbox|option|suggest|dropdown/.test(
      String(attrs["aria-controls"] || ""),
    ) ||
    /\b(suggest|suggestions|autocomplete|typeahead|start typing|type to search|search and select|search\/select)\b/.test(
      semanticAttributeBlob,
    ) ||
    /\b(combobox|autocomplete|typeahead|suggest)\b/.test(identifierBlob)
  );
}

function indicatesAutocompleteSelectionIntent(objectiveText: string): boolean {
  const objective = normalizeGuardText(objectiveText);
  if (!objective) return false;

  return /\b(suggestion|suggestions|autocomplete|typeahead|dropdown)\b/.test(
    objective,
  );
}

function elementLiveValue(
  element: DomSnapshot["elements"][number],
): string {
  return normalizeGuardText(element.attributes.value || element.text);
}

function snapshotSelectionConfirmationText(snapshot: DomSnapshot): string {
  const elementText = snapshot.elements
    .filter((element) => !isTextLikeInputElement(element))
    .map((element) => element.text)
    .filter(Boolean)
    .join(" ");
  return [
    snapshot.pageContent,
    snapshot.visibleContent,
    elementText,
  ]
    .filter(Boolean)
    .map((value) => normalizeGuardText(value))
    .join(" ");
}

function extractQuotedTaskValues(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/["']([^"']{3,120})["']/g)]
        .map((match) => normalizeGuardText(match[1]))
        .filter(Boolean),
    ),
  ];
}

function valueMatchesRequestedTaskText(value: string, taskText: string): boolean {
  const normalizedTask = normalizeGuardText(taskText);
  if (!normalizedTask || !value) return false;

  const quotedValues = extractQuotedTaskValues(taskText);
  if (quotedValues.length > 0) {
    return quotedValues.includes(value);
  }

  return (
    normalizedTask.includes(value) &&
    (value.includes(" ") || value.length >= 8)
  );
}

function isSuggestionLikeElement(
  element: DomSnapshot["elements"][number],
): boolean {
  if (element.isVisible === false || element.isDisabled) return false;
  if (isTextLikeInputElement(element)) return false;

  const tagName = normalizeGuardText(element.tagName);
  const role = normalizeGuardText(element.role);
  const attributeText = [
    element.attributes.id,
    element.attributes.name,
    element.attributes["aria-label"],
    element.attributes.role,
    element.attributes.class,
  ]
    .map((value) => normalizeGuardText(value))
    .filter(Boolean)
    .join(" ");

  return (
    ["li", "option"].includes(tagName) ||
    /\b(li|option|listitem|menuitem)\b/.test(role) ||
    /\b(option|suggest|dropdown|typeahead|autocomplete)\b/.test(attributeText)
  );
}

function hasAutocompleteDoneGuardContext(params: {
  input: DomSnapshot["elements"][number];
  snapshot: DomSnapshot;
}): boolean {
  const pageText = normalizeGuardText(
    [
      params.snapshot.title,
      params.snapshot.url,
      params.snapshot.pageContent,
      params.snapshot.visibleContent,
    ]
      .filter(Boolean)
      .join(" "),
  );
  return (
    isAutocompleteLikeElement(params.input) ||
    /\b(autocomplete|typeahead|suggestion|suggestions|dropdown)\b/.test(
      pageText,
    )
  );
}

function hasSelectionConfirmation(snapshot: DomSnapshot, value: string): boolean {
  const text = snapshotSelectionConfirmationText(snapshot);
  return [
    `selected: ${value}`,
    `selected ${value}`,
    `chosen: ${value}`,
    `chosen ${value}`,
  ].some((phrase) => text.includes(phrase));
}

export interface AutocompleteSuggestionDoneRejection {
  reason: string;
  inputTag: number;
  suggestionTag: number;
  value: string;
}

export function getAutocompleteSuggestionDoneRejection(params: {
  snapshot: DomSnapshot | null | undefined;
  originalQuery: string;
  activeObjective?: string;
  successCriteria?: string;
  summary?: string;
}): AutocompleteSuggestionDoneRejection | null {
  const snapshot = params.snapshot;
  if (!snapshot) return null;

  const taskText = [
    params.originalQuery,
    params.activeObjective,
    params.successCriteria,
    params.summary,
  ]
    .filter(Boolean)
    .join(" ");
  const visibleInputs = snapshot.elements.filter(
    (element) =>
      element.isVisible !== false &&
      !element.isDisabled &&
      isTextLikeInputElement(element) &&
      elementLiveValue(element).length >= 3,
  );
  if (visibleInputs.length === 0) return null;

  const visibleSuggestions = snapshot.elements.filter(isSuggestionLikeElement);
  if (visibleSuggestions.length === 0) return null;

  for (const input of visibleInputs) {
    const value = elementLiveValue(input);
    if (!valueMatchesRequestedTaskText(value, taskText)) continue;
    if (
      !hasAutocompleteDoneGuardContext({
        input,
        snapshot,
      })
    ) {
      continue;
    }
    if (hasSelectionConfirmation(snapshot, value)) continue;

    const matchingSuggestion = visibleSuggestions.find(
      (element) =>
        element.tag !== input.tag && normalizeGuardText(element.text) === value,
    );
    if (!matchingSuggestion) continue;

    return {
      inputTag: input.tag,
      suggestionTag: matchingSuggestion.tag,
      value,
      reason:
        `A matching autocomplete suggestion "${matchingSuggestion.text.trim()}" is still visible as ` +
        `[${matchingSuggestion.tag}], but it has not been selected. Click the matching suggestion ` +
        "before calling done(); typing the text into the input alone may not register the selection.",
    };
  }

  return null;
}

function buildAutocompletePrefix(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 3) return trimmed;

  const prefixLength = Math.min(8, Math.max(3, Math.ceil(trimmed.length / 3)));
  const candidate = trimmed.slice(0, prefixLength).trimEnd();
  return candidate.length >= 3 ? candidate : trimmed.slice(0, 3);
}

export function rewriteAutocompleteTextEntry(params: {
  objectiveText: string;
  originalQuery?: string;
  element: DomSnapshot["elements"][number] | null | undefined;
  typedText: string;
}): {
  rewrittenText: string;
  reason: string;
} | null {
  const { objectiveText, originalQuery, element, typedText } = params;
  const trimmed = typedText.trim();
  if (trimmed.length < 4) return null;
  // Intent check: step objective is the primary source.
  // Original query is a fallback for when the planner dropped
  // the autocomplete wording from the active step's objective.
  if (
    !indicatesAutocompleteSelectionIntent(objectiveText) &&
    !indicatesAutocompleteSelectionIntent(originalQuery ?? "")
  )
    return null;
  // Element classification: the hard safety boundary.
  // Even if intent is detected, normal text inputs are never rewritten.
  if (!isAutocompleteLikeElement(element)) return null;

  const rewrittenText = buildAutocompletePrefix(trimmed);
  if (rewrittenText === trimmed) return null;

  return {
    rewrittenText,
    reason:
      `Autocomplete guard: blocked full-value typing for [${element?.tag ?? "?"}]. ` +
      `Typed partial text "${rewrittenText}" only. Wait for suggestions/dropdown, then click the exact match "${trimmed}".`,
  };
}

export function assessAutocompleteTextRewrite(params: {
  objectiveText: string;
  originalQuery: string;
  element: DomSnapshot["elements"][number] | null | undefined;
  args: Record<string, unknown>;
}): {
  rewrittenText: string;
  reason: string;
} | null {
  return rewriteAutocompleteTextEntry({
    objectiveText: params.objectiveText,
    originalQuery: params.originalQuery,
    element: params.element,
    typedText: String(params.args.text || ""),
  });
}
