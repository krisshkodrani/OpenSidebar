import type { CompletionEvidenceLedger, CompletionEnvelope, CompletionEvaluation } from "../completion-kernel";
import type { CompletionEvidenceRuntime } from "../completion-evidence";
import type { TraceRecorder } from "../trace";
import type { CompletionPipelineDecision } from "./pipeline-types";

export interface AcceptCompletionDecisionHost {
  readonly completionEvidenceRuntime: Pick<CompletionEvidenceRuntime, "createCompletionEnvelope">;
  readonly completionEvidence: Pick<CompletionEvidenceLedger, "toArray">;
  readonly traceRecorder: TraceRecorder | null;
  readonly turnCount: number;
  acceptDoneToolCall(
    summary: string,
    toolCallId: string,
    completionEnvelope: CompletionEnvelope,
  ): void;
}

/** Map an accepting pipeline decision to its envelope, trace, and terminal state. */
export function acceptFromPipelineDecision(
  host: AcceptCompletionDecisionHost,
  decision: CompletionPipelineDecision,
  summary: string,
  toolCallId: string,
  kernelDecision: CompletionEvaluation | null,
): boolean {
  if (decision.basis === "kernel" && kernelDecision?.status === "accepted") {
    const completionEnvelope = host.completionEvidenceRuntime.createCompletionEnvelope({
      source: "model_done",
      contractKind: kernelDecision.contract.kind,
      decisionReason: kernelDecision.reason,
      evidence: kernelDecision.evidence,
      summary,
    });
    host.traceRecorder?.recordEvent("completion_decision", {
      turn: host.turnCount,
      status: "accepted",
      source: "model_done",
      reason: kernelDecision.reason,
      contractKind: kernelDecision.contract.kind,
      resultId: completionEnvelope.resultId,
      evidenceKeys: kernelDecision.evidence.map((event) => event.logicalKey),
      completionEnvelope,
    });
    host.acceptDoneToolCall(summary, toolCallId, completionEnvelope);
    return true;
  }

  const completionEnvelope = host.completionEvidenceRuntime.createCompletionEnvelope({
    source: "model_done",
    contractKind: "legacy_done_guards",
    decisionReason: "legacy_done_guards_passed",
    evidence: host.completionEvidence.toArray(),
    summary,
  });
  host.traceRecorder?.recordEvent("completion_decision", {
    turn: host.turnCount,
    status: "accepted",
    source: "model_done",
    reason: "legacy_done_guards_passed",
    resultId: completionEnvelope.resultId,
    contractKind: completionEnvelope.contractKind,
    evidenceKeys: completionEnvelope.evidenceKeys,
    completionEnvelope,
  });
  host.acceptDoneToolCall(summary, toolCallId, completionEnvelope);
  return true;
}
