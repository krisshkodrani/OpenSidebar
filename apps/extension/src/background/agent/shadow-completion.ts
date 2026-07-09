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
import type { logger, SessionScopedLogger } from "../../utils";
import type {
  CompletionEvaluation,
  CompletionEnvelope,
  CompletionCandidateSource,
} from "./completion-kernel";
import type { CompletionDecisionRecordInput } from "./completion/decision-record";
import { runCompletionPipeline } from "./completion/pipeline";
import { evaluateGeneratedCompletionCandidate } from "./completion-evaluation-service";

export interface ShadowCompletionHost {
  readonly turnCount: number;
  readonly traceRecorder: TraceRecorder | null;
  readonly log: typeof logger | SessionScopedLogger;
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

export async function shadowCompareCompletionPipeline(
  host: ShadowCompletionHost,
  input: CompletionDecisionRecordInput,
  legacyVerdict: boolean,
): Promise<void> {
  try {
    const { decision: kernelDecision } = evaluateGeneratedCompletionCandidate({
      userRequest: input.userRequest,
      snapshot: input.snapshot,
      activeObjective: input.activeObjective,
      successCriteria: input.successCriteria,
      evidence: input.evidence,
      candidateSource: input.candidateSource,
      summary: input.summary,
    });
    const pipelineDecision = await runCompletionPipeline(input.guardContext, {
      getKernelDecision: () => kernelDecision,
      deterministicAcceptanceEnabled: input.deterministicAcceptanceEnabled,
      isDuplicateTerminal: input.isDuplicateTerminal,
      validatePlan: async () => input.plannerResult,
      buildKernelRejectionEffects: () => [],
      buildPlanRejectionEffects: () => [],
    });
    const pipelineAccepted = pipelineDecision.verdict === "accept";
    if (pipelineAccepted !== legacyVerdict) {
      host.traceRecorder?.recordEvent("completion_pipeline_divergence", {
        turn: host.turnCount,
        legacyVerdict: legacyVerdict ? "accepted" : "rejected",
        pipelineVerdict: pipelineDecision.verdict,
        pipelineBasis: pipelineDecision.basis,
        pipelineRejectedBy: pipelineDecision.rejectedBy,
        pipelineReason: pipelineDecision.reason,
      });
      host.log.warn("agent", "completion pipeline shadow divergence", {
        turn: host.turnCount,
        legacyVerdict: legacyVerdict ? "accepted" : "rejected",
        pipelineVerdict: pipelineDecision.verdict,
        pipelineRejectedBy: pipelineDecision.rejectedBy,
      });
    }
  } catch (err) {
    host.log.warn("agent", "completion pipeline shadow comparison failed", {
      turn: host.turnCount,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
