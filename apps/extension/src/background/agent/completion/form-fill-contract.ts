import type { DomSnapshot } from "../../../types";
import type {
  CompletionEvaluation,
  CompletionEvidence,
  FormFillContract,
  FormFillFieldExpectation,
  GeneratedCompletionContract,
} from "./kernel-types";
import { cleanLabel, compactKey, importantLabelTokens, normalizeText } from "./text-utils";
import {
  extractFormFieldObservations,
  inferExpectedFormFields,
  inferExpectedScopedFormFields,
  parseBooleanLike,
} from "./form-field-analysis";
import { extractCanonicalUserRequest } from "./request-text";
import { latestObservedTurn } from "./workflow-terminal-state";
import {
  getAutocompleteSuggestionDoneRejection,
  type AutocompleteSuggestionDoneRejection,
} from "../text-entry-guards";
import { compareEvidenceRecency } from "./evidence-order";

export function generateFormFillContract(
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

export function evaluateFormFill(params: {
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
