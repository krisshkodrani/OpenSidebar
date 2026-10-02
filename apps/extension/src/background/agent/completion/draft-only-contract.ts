import type { DomSnapshot } from "../../../types";
import {
  hasDraftPreservedEvidence,
  hasStrongCommunicationSentEvidence,
  requiresDraftOnlyCompletion,
} from "../consequential-action-policy";
import { isLikelyDraftEditorIdentity } from "./draft-analysis";
import { compareEvidenceRecency } from "./evidence-order";
import type {
  CompletionEvaluation,
  CompletionEvidence,
  DraftOnlyContract,
  GeneratedCompletionContract,
} from "./kernel-types";
import { extractCanonicalUserRequest } from "./request-text";
import { cleanLabel } from "./text-utils";

export function generateDraftOnlyContract(params: {
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
  if (!requiresDraftOnlyCompletion(requestText)) return null;

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

export function evaluateDraftOnly(params: {
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

  const disabledFinalAction = params.snapshot?.elements.find(
    (element) =>
      element.isVisible &&
      element.isDisabled &&
      (element.tagName.toLowerCase() === "button" || element.role === "button") &&
      /\b(?:send|submit|publish|post)\b/i.test(
        [element.text, element.attributes["aria-label"]].filter(Boolean).join(" "),
      ),
  );
  if (
    disabledFinalAction &&
    !/\b(?:ready for (?:review|approval)|awaiting approval|waiting for approval)\b/i.test(
      [snapshotText, ...(params.snapshot?.elements ?? []).map((element) => element.text)]
        .filter(Boolean)
        .join(" "),
    )
  ) {
    return {
      status: "rejected",
      reason:
        "The draft's final-action control is disabled and no ready state is visible; check required fields and validation hints before calling done.",
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
