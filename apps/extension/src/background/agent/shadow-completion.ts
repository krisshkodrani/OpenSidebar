/**
 * shadow completion decision recording (RFC LP-16 Phase 3 — loop.ts landmine
 * decomposition).
 *
 * When deterministic completion acceptance is NOT authoritative, the loop still
 * runs the completion kernel in shadow and records its decision as a
 * non-authoritative completion_decision trace (accepted → also build + record the
 * envelope). Extracted verbatim from loop() via the dispatch-host idiom (loop()
 * passes `this`); behavior-preserving.
 */

import type { TraceRecorder } from "./trace";
import type {
  CompletionEvaluation,
  CompletionEnvelope,
  CompletionCandidateSource,
} from "./completion-kernel";

export interface ShadowCompletionHost {
  readonly turnCount: number;
  readonly traceRecorder: TraceRecorder | null;
  createCompletionEnvelope(params: {
    source: CompletionCandidateSource;
    contractKind: string;
    decisionReason: string;
    evidence?: CompletionEvaluation["evidence"];
    summary: string;
  }): CompletionEnvelope;
  recordCompletionEnvelope(
    envelope: CompletionEnvelope,
    metadata?: Record<string, unknown>,
  ): void;
}

export function recordShadowCompletionDecision(
  host: ShadowCompletionHost,
  decision: CompletionEvaluation,
  summary: string,
): void {
  const metadata = {
    authoritative: false,
    gatedBy: "completionDeterministicAcceptanceEnabled",
    fallback: "legacy_done_guards",
  };
  if (decision.status === "accepted") {
    const completionEnvelope = host.createCompletionEnvelope({
      source: "model_done",
      contractKind: decision.contract.kind,
      decisionReason: decision.reason,
      evidence: decision.evidence,
      summary,
    });
    host.traceRecorder?.recordEvent("completion_decision", {
      turn: host.turnCount,
      status: decision.status,
      source: "model_done",
      reason: decision.reason,
      contractKind: decision.contract.kind,
      resultId: completionEnvelope.resultId,
      evidenceKeys: decision.evidence.map((event) => event.logicalKey),
      completionEnvelope,
      ...metadata,
    });
    host.recordCompletionEnvelope(completionEnvelope, metadata);
    return;
  }
  if (
    decision.status === "rejected" ||
    decision.status === "needs_verification"
  ) {
    host.traceRecorder?.recordEvent("completion_decision", {
      turn: host.turnCount,
      status: decision.status,
      source: "model_done",
      reason: decision.reason,
      contractKind: decision.contract.kind,
      evidenceKeys: decision.evidence.map((event) => event.logicalKey),
      ...metadata,
    });
  }
}
