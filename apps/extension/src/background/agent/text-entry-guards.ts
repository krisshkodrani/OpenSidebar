import type { DomSnapshot } from "../../types";

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
    /\b(suggest|suggestions|autocomplete|typeahead|start typing|search and select|search\/select)\b/.test(
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
