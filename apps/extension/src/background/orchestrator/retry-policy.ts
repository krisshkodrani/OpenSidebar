import { logger } from "../../utils";
import type { VerificationFailureType } from "./verifier";

export type RetryClass =
  | "blocked"
  | "state_mismatch"
  | "transient"
  | "inconclusive"
  | "unknown";

export type RetrySource = "verifier" | "executor" | "system";

export interface RetryPolicyInput {
  source: RetrySource;
  reason?: string;
  driftDetected?: boolean;
  staleSignalCount?: number;
  errorMessage?: string;
  confidence?: number;
  failureType?: VerificationFailureType;
}

export interface RetryPolicyDecision {
  retryClass: RetryClass;
  maxRetries: number;
  shouldRetry: boolean;
  rationale: string;
}

const BLOCKED_MARKERS = [
  "captcha",
  "blocked",
  "forbidden",
  "access denied",
  "not available",
  "not found",
  "permission denied",
  "policy",
];

const TRANSIENT_MARKERS = [
  "timeout",
  "timed out",
  "429",
  "rate limit",
  "temporar",
  "connection",
  "network",
  "econnreset",
  "econnrefused",
  "service unavailable",
  "503",
  "502",
];

function classifyRetry(input: RetryPolicyInput): RetryClass {
  if (input.failureType) {
    switch (input.failureType) {
      case "blocked":
        return "blocked";
      case "state_mismatch":
        return "state_mismatch";
      case "transient":
        return "transient";
      case "insufficient_evidence":
        return "inconclusive";
      case "unknown":
      default:
        return "unknown";
    }
  }

  const reason = (input.reason || input.errorMessage || "").toLowerCase();
  if (BLOCKED_MARKERS.some((marker) => reason.includes(marker))) {
    return "blocked";
  }
  if (input.driftDetected || (input.staleSignalCount || 0) > 0) {
    return "state_mismatch";
  }
  if (TRANSIENT_MARKERS.some((marker) => reason.includes(marker))) {
    return "transient";
  }
  if (input.source === "verifier") {
    return "inconclusive";
  }
  return "unknown";
}

function maxRetriesForClass(retryClass: RetryClass): number {
  switch (retryClass) {
    case "blocked":
      return 0;
    case "state_mismatch":
      return 0;
    case "transient":
      return 2;
    case "inconclusive":
      return 1;
    case "unknown":
    default:
      return 1;
  }
}

export function decideRetryPolicy(
  input: RetryPolicyInput,
  retriesUsed: number,
): RetryPolicyDecision {
  const retryClass = classifyRetry(input);
  let maxRetries = maxRetriesForClass(retryClass);
  const confidence = input.confidence;
  if (
    typeof confidence === "number" &&
    confidence <= 0.35 &&
    (retryClass === "inconclusive" || retryClass === "unknown")
  ) {
    // Low-confidence verifier assessments can warrant one extra exploratory retry.
    maxRetries += 1;
  }
  const shouldRetry = retriesUsed < maxRetries;
  const rationale =
    `class=${retryClass}; retriesUsed=${retriesUsed}; maxRetries=${maxRetries}; source=${input.source}` +
    (input.failureType ? `; failureType=${input.failureType}` : "") +
    (typeof confidence === "number"
      ? `; confidence=${confidence.toFixed(2)}`
      : "");

  logger.debug("orchestrator", "Retry policy decision", {
    retryClass,
    retriesUsed,
    maxRetries,
    shouldRetry,
    source: input.source,
    reason: input.reason,
    errorMessage: input.errorMessage,
    confidence: input.confidence,
    failureType: input.failureType,
    driftDetected: input.driftDetected || false,
    staleSignalCount: input.staleSignalCount || 0,
  });

  return {
    retryClass,
    maxRetries,
    shouldRetry,
    rationale,
  };
}
