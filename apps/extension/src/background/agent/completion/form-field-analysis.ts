/**
 * Form-field observation and expected-value inference for form-fill completion
 * (RFC LP-16 Phase 1). Extracts form fields from a snapshot, infers the fields
 * and values a form-fill objective expects, and classifies field kinds/values.
 * Verbatim movement from completion-kernel.ts; a closed call-set that depends
 * only on shared types + valueTokenCoveredBySummary.
 */
import type { DomSnapshot, TaggedElement } from "../../../types";
import type {
  FormFieldKind,
  FormFieldObservation,
  FormFillFieldExpectation,
} from "./kernel-types";
import { valueTokenCoveredBySummary } from "./label-value-types";
import { cleanLabel, escapeRegExp, normalizeText } from "./text-utils";

export function extractFormFieldObservations(
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

export function findFormFieldObservationByElementId(
  snapshot: DomSnapshot | null | undefined,
  id: number,
): FormFieldObservation | null {
  if (!snapshot) return null;
  const direct = snapshot.elements.find((element) => element.tag === id);
  if (!direct) return null;
  const directStableKey = formFieldStableKey(direct);
  return (
    extractFormFieldObservations(snapshot).find(
      (field) => field.elementId === id || field.stableKey === directStableKey,
    ) ?? null
  );
}

export function getFormFieldKind(element: TaggedElement): FormFieldKind | null {
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
  if (tagName === "textarea" || role === "textbox" || role === "searchbox") {
    return "text";
  }
  if (tagName !== "input") return null;
  if (["button", "file", "hidden", "image", "reset", "submit"].includes(type)) {
    return null;
  }
  return "text";
}

export function formFieldStableKey(element: TaggedElement): string {
  return (
    element.attributes.control ||
    element.attributes.id ||
    element.attributes.name ||
    element.attributes["aria-label"] ||
    element.attributes.label ||
    `tag:${element.tag}`
  );
}

export function readFormFieldValue(
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

export function bestFormFieldLabel(
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
  return candidates.map((value) => cleanLabel(value ?? "")).find(Boolean) ?? "";
}

export function inferExpectedFormFields(
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

export function inferExpectedScopedFormFields(
  activeScopeText: string,
  scopedValueText: string,
  canonicalUserRequest: string,
  fields: FormFieldObservation[],
): FormFillFieldExpectation[] {
  const expectedFields: FormFillFieldExpectation[] = [];
  for (const field of fields) {
    if (!formFieldMentionedInText(activeScopeText, field)) continue;
    const value =
      inferExpectedFieldValue(
        scopedValueText || activeScopeText,
        field,
        fields,
      ) ?? inferExpectedFieldValue(canonicalUserRequest, field, fields);
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

export function formFieldMentionedInText(
  text: string,
  field: FormFieldObservation,
): boolean {
  const normalized = normalizeText(text);
  return formFieldAliases(field).some((alias) =>
    new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(normalized),
  );
}

export function inferExpectedFieldValue(
  userRequest: string,
  field: FormFieldObservation,
  fields: FormFieldObservation[],
): string | null {
  if (field.kind === "checkbox" || field.kind === "radio") {
    return inferExpectedBooleanValue(userRequest, field);
  }
  if (field.kind === "select") {
    const selectedValue = inferExpectedCurrentSelectValue(userRequest, field);
    if (selectedValue) return selectedValue;
  }

  const text = cleanLabel(userRequest);
  for (const alias of formFieldAliases(field)) {
    const quotedPattern = new RegExp(
      `\\b${escapeRegExp(alias)}\\b\\s*(?:(is|=|:|to|as|with|equals?|shows?|contains?|reads?|displays?)\\s*)?["']([^"']+)["']`,
      "gi",
    );
    for (const quoted of text.matchAll(quotedPattern)) {
      if (
        !quoted[1] &&
        !hasFieldValueIntentBeforeAlias(text, quoted.index ?? 0)
      ) {
        continue;
      }
      const value = trimInferredValue(quoted[2], field, fields);
      if (value) return value;
    }

    const unquotedPattern = new RegExp(
      `\\b${escapeRegExp(alias)}\\b\\s*(?:(is|=|:|to|as|with|equals?|shows?|contains?|reads?|displays?)\\s+)?([^,;\\n]+(?:\\s+[^,;\\n]+){0,16})`,
      "gi",
    );
    for (const unquoted of text.matchAll(unquotedPattern)) {
      if (!unquoted?.[2]) continue;
      if (
        !unquoted[1] &&
        !hasFieldValueIntentBeforeAlias(text, unquoted.index ?? 0)
      ) {
        continue;
      }
      const value = trimInferredValue(unquoted[2], field, fields);
      if (value) return value;
    }
  }
  return null;
}

export function inferExpectedCurrentSelectValue(
  userRequest: string,
  field: FormFieldObservation,
): string | null {
  const value = cleanLabel(field.value);
  if (!value) return null;

  const requestText = normalizeText(userRequest);
  const valueText = normalizeText(value);
  if (!valueText || !valueTokenCoveredBySummary(requestText, valueText)) {
    return null;
  }

  const aliases = formFieldAliases(field);
  if (
    aliases.some((alias) =>
      new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(requestText),
    )
  ) {
    return value;
  }

  return null;
}

export function hasFieldValueIntentBeforeAlias(
  text: string,
  aliasIndex: number,
): boolean {
  const prefix = text.slice(Math.max(0, aliasIndex - 80), aliasIndex);
  return /\b(?:fill|filled|enter|entered|type|typed|write|written|set|update|change|choose|select|check|uncheck|use|using|with|log\s*in|sign\s*in|register|apply|checkout|order)\b/i.test(
    prefix,
  );
}

export function inferExpectedBooleanValue(
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
    if (/\b(?:check|select|tick|enable|turn on|agree|accept)\b/i.test(window)) {
      return "true";
    }
  }
  return null;
}

export function trimInferredValue(
  rawValue: string,
  field: FormFieldObservation,
  fields: FormFieldObservation[],
): string {
  let value = cleanLabel(rawValue);
  if (formFieldValueLooksLikeControlInstruction(value)) return "";
  if (/\be[-\s]?mail\b/i.test(field.label)) {
    const email = value.match(
      /[^\s"'<>(),;:]+@[^\s"'<>(),;:]+\.[^\s"'<>(),;:.]+/i,
    )?.[0];
    if (email) return email.replace(/[.,;:!?]+$/g, "");
  }
  if (isCodeLikeFormField(field)) {
    const conciseCode = extractConciseCodeFormValue(value);
    if (conciseCode) value = conciseCode;
  }
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
  value = value.replace(
    /\s+(?:in|inside|on|under)\s+(?:the\s+)?(?:[a-z0-9_-]+\s+){0,3}(?:field|input|box|control|form)\b.*$/i,
    "",
  );
  if (formFieldValueLooksLikeControlInstruction(value)) return "";
  if (trimmedAtBoundary) {
    value = value.replace(/[.]+$/g, "");
  }
  if (/\bcode\b/i.test(field.label)) value = value.replace(/[.,;:!?]+$/g, "");
  if (isEmailLikeFormValue(field, value)) {
    value = value.replace(/[.,;:!?]+$/g, "");
  }
  value = value.replace(/\b(?:and|then|also|too)$/i, "");
  value = value.replace(/^["']|["']$/g, "");
  return cleanLabel(value);
}

export function formFieldValueLooksLikeControlInstruction(value: string): boolean {
  return (
    /^(?:[/\s-]*(?:promo|discount|coupon|shipping|name|email|e-mail))*[/\s-]*(?:input|field|box|control|form)\b/i.test(
      value,
    ) ||
    /^\s*(?:in|inside|on|under)\s+(?:the\s+)?(?:[a-z0-9_-]+\s+){0,4}(?:input|field|box|control|form)\b/i.test(
      value,
    )
  );
}

export function isCodeLikeFormField(field: FormFieldObservation): boolean {
  return /\b(?:code|coupon|promo|discount)\b/i.test(field.label);
}

export function extractConciseCodeFormValue(value: string): string | null {
  const match =
    /\b([A-Za-z0-9][A-Za-z0-9_-]{2,})\b(?=\s*(?:$|[.,;:!?]|\b(?:for|in|inside|on|under|as|and|then|please|to)\b))/i.exec(
      value,
    );
  if (!match) return null;
  const candidate = match[1].replace(/[.,;:!?]+$/g, "");
  if (
    /^(?:the|for|and|then|please|input|field|coupon|promo|discount|code)$/i.test(
      candidate,
    )
  ) {
    return null;
  }
  return candidate;
}

export function isEmailLikeFormValue(
  field: FormFieldObservation,
  value: string,
): boolean {
  return (
    /\be[-\s]?mail\b/i.test(field.label) ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+[.,;:!?]?$/i.test(value)
  );
}

export function formFieldAliases(field: FormFieldObservation): string[] {
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
  if (/\bcode\b/i.test(normalizedLabel)) {
    aliases.add("coupon code");
    aliases.add("promo code");
    aliases.add("coupon");
    aliases.add("promo");
  }

  if (/\b(?:coupon|promo|discount)\b/i.test(normalizedLabel)) {
    aliases.add("coupon code");
    aliases.add("promo code");
    aliases.add("coupon");
    aliases.add("promo");
  }

  for (const term of [
    "address",
    "city",
    "company",
    "country",
    "description",
    "color",
    "engraving",
    "message",
    "name",
    "password",
    "phone",
    "priority",
    "size",
    "state",
    "subject",
    "title",
    "username",
  ]) {
    if (normalizedLabel.includes(term)) aliases.add(term);
  }

  for (const token of normalizedLabel.split(/\s+/)) {
    if (
      token.length >= 4 &&
      !/^(?:field|input|select|checkbox|radio|control|option|value)$/i.test(
        token,
      )
    ) {
      aliases.add(token);
    }
  }

  return [...aliases]
    .map((alias) => normalizeText(alias))
    .filter((alias) => alias.length >= 3)
    .sort((a, b) => b.length - a.length);
}

export function readChecked(element: TaggedElement): boolean | null {
  const checked =
    element.attributes.checked ??
    element.attributes["aria-checked"] ??
    element.attributes.selected;
  if (checked == null) return null;
  if (/^(?:true|checked|selected|1)$/i.test(checked)) return true;
  if (/^(?:false|0)$/i.test(checked)) return false;
  return null;
}

export function parseBooleanLike(value: string): boolean | null {
  const text = normalizeText(value);
  if (/^(?:true|yes|on|checked|selected|enabled|1)$/.test(text)) return true;
  if (/^(?:false|no|off|unchecked|unselected|disabled|0|)$/.test(text)) {
    return false;
  }
  return null;
}
