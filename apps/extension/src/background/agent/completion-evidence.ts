/**
 * completion-evidence policy (RFC LP-16 Phase 3 — loop.ts landmine decomposition).
 *
 * The completion-evidence accumulation + candidate-evaluation cluster, moved
 * verbatim out of loop() via the dispatch-host idiom: derive evidence from the
 * snapshot / a tool outcome, evaluate a generated completion candidate against
 * it, and surface a recovery hint when done() looks premature. Every member is a
 * real AgentLoop field/method, so loop() keeps thin delegators that pass `this`
 * (this preserves loop.recordCompletionToolEvidence, called by other modules).
 * Behavior-preserving relocation — NOT the semantic pipeline absorption.
 */

import { ToolName, DomSnapshot } from "../../types";
import type { SubtaskSummary } from "../../types";
import type { ContextManager } from "./context";
import type { TraceRecorder } from "./trace";
import type { PlanStep } from "./planner";
import {
  deriveCompletionEvidenceFromSnapshot,
  deriveCompletionEvidenceFromToolOutcome,
  buildCompletionRecoveryHint,
  type CompletionEvidenceLedger,
  type CompletionCandidateSource,
  type CompletionEvaluation,
} from "./completion-kernel";
import { evaluateGeneratedCompletionCandidate } from "./completion-evaluation-service";

export interface CompletionEvidenceHost {
  readonly planSubtasks: SubtaskSummary[];
  readonly planSteps: PlanStep[];
  readonly completionEvidence: CompletionEvidenceLedger;
  readonly traceRecorder: TraceRecorder | null;
  readonly turnCount: number;
  readonly context: ContextManager;
  readonly originalQuery: string;
  lastCompletionRejection: CompletionEvaluation | null;
  lastCompletionRecoveryHint: string | null;
}

export function getActiveCompletionContext(host: CompletionEvidenceHost): {
  activeObjective?: string;
  successCriteria?: string;
} {
  const activePlanIdx =
    host.planSubtasks.length > 0
      ? host.planSubtasks.findIndex((s) => s.status === "running")
      : -1;
  const effectivePlanIdx =
    activePlanIdx >= 0
      ? activePlanIdx
      : Math.min(
          host.planSubtasks.filter((s) => s.status === "completed").length,
          host.planSubtasks.length - 1,
        );
  return {
    activeObjective:
      effectivePlanIdx >= 0
        ? host.planSubtasks[effectivePlanIdx]?.description
        : undefined,
    successCriteria:
      effectivePlanIdx >= 0
        ? host.planSteps[effectivePlanIdx]?.successCriteria
        : undefined,
  };
}

export function recordCompletionEvidence(host: CompletionEvidenceHost, 
  evidence: ReturnType<typeof deriveCompletionEvidenceFromSnapshot>,
  source: string,
): number {
  const added = host.completionEvidence.addMany(evidence);
  if (added === 0) return 0;
  host.traceRecorder?.recordEvent("completion_evidence_recorded", {
    turn: host.turnCount,
    source,
    added,
    evidence: evidence.map((event) => ({
      type: event.type,
      confidence: event.confidence,
      logicalKey: event.logicalKey,
    })),
  });
  return added;
}

export function refreshCompletionEvidenceFromSnapshot(host: CompletionEvidenceHost, source: string): void {
  recordCompletionEvidence(host, 
    deriveCompletionEvidenceFromSnapshot(
      host.context.getSnapshot(),
      host.turnCount,
    ),
    source,
  );
}

export function recordCompletionToolEvidence(host: CompletionEvidenceHost, 
  toolName: ToolName,
  args: Record<string, unknown>,
  result: string,
  preActionSnapshot?: DomSnapshot | null,
): void {
  const added = recordCompletionEvidence(host, 
    deriveCompletionEvidenceFromToolOutcome({
      toolName,
      args,
      result,
      preActionSnapshot,
      currentSnapshot: host.context.getSnapshot(),
      turn: host.turnCount,
    }),
    "tool_result",
  );
  if (added > 0) {
    maybeAddCompletionRecoveryHint(host, "tool_result");
  }
}

export function evaluateCompletionCandidate(host: CompletionEvidenceHost, 
  source: CompletionCandidateSource,
  summary: string,
): CompletionEvaluation {
  refreshCompletionEvidenceFromSnapshot(host, "candidate_evaluation");
  const completionContext = getActiveCompletionContext(host);
  const snapshot = host.context.getSnapshot();
  const { generated, decision } = evaluateGeneratedCompletionCandidate({
    userRequest: host.originalQuery,
    snapshot,
    activeObjective: completionContext.activeObjective,
    successCriteria: completionContext.successCriteria,
    evidence: host.completionEvidence.toArray(),
    candidateSource: source,
    summary,
  });
  host.traceRecorder?.recordEvent("completion_candidate", {
    turn: host.turnCount,
    source,
    contractKind: generated?.contract.kind ?? "none",
    confidence: generated?.confidence ?? "none",
  });
  if (generated?.notes.length) {
    host.traceRecorder?.recordEvent("completion_contract_repaired", {
      turn: host.turnCount,
      notes: generated.notes,
      contractKind: generated.contract.kind,
    });
  }
  if (decision.status !== "accepted") {
    host.lastCompletionRejection = decision;
  }
  return decision;
}

export function getCompletionRecoveryHintForCurrentState(host: CompletionEvidenceHost): string | null {
  refreshCompletionEvidenceFromSnapshot(host, "recovery_consult");
  const completionContext = getActiveCompletionContext(host);
  const snapshot = host.context.getSnapshot();
  const { generated, decision } = evaluateGeneratedCompletionCandidate({
    userRequest: host.originalQuery,
    snapshot,
    activeObjective: completionContext.activeObjective,
    successCriteria: completionContext.successCriteria,
    evidence: host.completionEvidence.toArray(),
    candidateSource: "model_done",
  });
  if (generated?.notes.length) {
    host.traceRecorder?.recordEvent("completion_contract_repaired", {
      turn: host.turnCount,
      notes: generated.notes,
      contractKind: generated.contract.kind,
      source: "recovery_consult",
    });
  }
  return buildCompletionRecoveryHint(decision);
}

export function maybeAddCompletionRecoveryHint(host: CompletionEvidenceHost, trigger: string): void {
  const hint = getCompletionRecoveryHintForCurrentState(host);
  if (!hint || hint === host.lastCompletionRecoveryHint) return;
  host.lastCompletionRecoveryHint = hint;
  host.traceRecorder?.recordEvent("completion_recovery_hint", {
    turn: host.turnCount,
    trigger,
  });
  host.context.addMessage({
    role: "user",
    content: hint,
  });
}
