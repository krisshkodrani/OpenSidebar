import type { DomSnapshot } from "../../../types";
import type {
  CompletionCandidateSource,
  CompletionEvaluation,
  CompletionEvidence,
  GeneratedCompletionContract,
  WorkflowConfirmationContract,
} from "./kernel-types";
import { hasPageReadAnswerIntent } from "./read-answer-analysis";
import {
  extractCanonicalUserRequest,
  extractCurrentObjectiveRequestText,
} from "./request-text";
import { cleanLabel, compactKey, escapeRegExp, normalizeText, tokenizeCompletionText } from "./text-utils";
import {
  inferWorkflowConfirmationAction,
  inferWorkflowConfirmationTargetLabel,
  workflowConfirmationMatchesTarget,
  isTransactionalConfirmationAction,
  visibleTransactionalConfirmationMatchesTarget,
  extractTransactionalConfirmationSnippet,
  workflowTargetSpecificTransactionalTokens,
  workflowTargetIsTransactional,
  extractCartCreationSnippet,
  workflowTargetLabelCoveredByText,
  workflowTargetTokenCoveredByText,
  isDismissalControl,
} from "./workflow-confirmation-analysis";
import { inferRequestedWorkflowConfirmationAction } from "./workflow-request-intent";
import { compareEvidenceRecency } from "./evidence-order";
import { getFormFieldKind } from "./form-field-analysis";
import { valueTokenCoveredBySummary } from "./label-value-types";
import {
  inferSavedTerminalWorkflowStateConfirmation,
  inferWorkflowVisibleTargetStateConfirmation,
  latestObservedTurn,
  summaryConfirmsWorkflowAction,
} from "./workflow-terminal-state";


export function generateWorkflowConfirmationContract(
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
    const requestedAction =
      inferRequestedWorkflowConfirmationAction(requestText);
    if (isBrowserManagementWorkflowRequest(requestText)) continue;
    if (hasPageReadAnswerIntent(requestText, _snapshot) && !requestedAction) {
      continue;
    }
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

function inferEmptyCartRemovalConfirmation(params: {
  contract: WorkflowConfirmationContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): Extract<CompletionEvidence, { type: "confirmation_state" }> | null {
  const { contract, snapshot, summary } = params;
  if (contract.action !== "delete" || !snapshot || !summary) return null;
  const visibleText = normalizeText(
    [snapshot.visibleContent, snapshot.pageContent].filter(Boolean).join("\n"),
  );
  if (!/\b(?:your\s+)?cart\s+is\s+empty\b/i.test(visibleText)) return null;
  if (!/\b(?:removed?|deleted?)\b[\s\S]{0,100}\bcart\b/i.test(summary)) {
    return null;
  }
  if (
    contract.targetLabel &&
    !workflowTargetLabelCoveredByText(contract.targetLabel, summary)
  ) {
    return null;
  }
  return {
    type: "confirmation_state",
    confidence: "medium",
    logicalKey: `workflow:confirmation:delete:empty-cart:${compactKey(contract.targetLabel ?? "cart")}`,
    observedAtTurn: latestObservedTurn(params.evidence),
    detail: {
      action: "delete",
      source: "visible_text",
      ...(contract.targetLabel ? { targetText: contract.targetLabel } : {}),
      text: "Your cart is empty.",
    },
  };
}

export function evaluateWorkflowConfirmation(params: {
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
  const emptyCartRemoval = inferEmptyCartRemovalConfirmation(params);
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
  const savedTerminalWorkflowState =
    inferSavedTerminalWorkflowStateConfirmation({
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
    if (emptyCartRemoval) {
      return {
        status: "accepted",
        reason: "Removal is confirmed by the empty cart state.",
        contract,
        evidence: [emptyCartRemoval],
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
    if (savedTerminalWorkflowState) {
      return {
        status: "accepted",
        reason:
          "Workflow contract is satisfied by visible saved terminal workflow state.",
        contract,
        evidence: [savedTerminalWorkflowState],
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
    if (emptyCartRemoval) {
      return {
        status: "accepted",
        reason: "Removal is confirmed by the empty cart state.",
        contract,
        evidence: [emptyCartRemoval],
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
    if (savedTerminalWorkflowState) {
      return {
        status: "accepted",
        reason:
          "Workflow contract is satisfied by visible saved terminal workflow state.",
        contract,
        evidence: [savedTerminalWorkflowState],
      };
    }

    return {
      status: "needs_verification",
      reason:
        "Requested action has no matching visible confirmation evidence yet.",
      hint: "A selection or filled field alone does not complete the requested workflow. Inspect the current page for the next control that applies or prepares it, and use that control if the user authorized it. Verify the resulting review or confirmation state before calling done. Do not purchase or confirm when the user asked only to prepare.",
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

export function workflowConfirmationTextCorpus(
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

export function snapshotHasVisibleDismissalControl(snapshot: DomSnapshot): boolean {
  return snapshot.elements.some(
    (element) =>
      element.isVisible !== false &&
      !element.isDisabled &&
      isDismissalControl(element),
  );
}

export function findModalLikeDescriptors(snapshot: DomSnapshot): Array<{
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
