import type { DomSnapshot } from "../../../types";
import { compareEvidenceRecency } from "./evidence-order";
import type {
  CompletionEvaluation,
  CompletionEvidence,
  GeneratedCompletionContract,
  NavigationContract,
} from "./kernel-types";
import {
  extractNavigationTarget,
  navigationTargetMatches,
  parseNavigationTarget,
} from "./navigation-analysis";
import { extractCanonicalUserRequest } from "./request-text";

export function generateNavigationContract(
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

export function evaluateNavigation(params: {
  contract: NavigationContract;
  evidence: CompletionEvidence[];
}): CompletionEvaluation {
  const contract = params.contract;
  const navigationEvidence = params.evidence
    .filter(
      (
        event,
      ): event is Extract<CompletionEvidence, { type: "navigation_state" }> =>
        event.type === "navigation_state",
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
