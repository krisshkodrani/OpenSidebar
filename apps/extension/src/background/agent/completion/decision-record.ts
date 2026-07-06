/**
 * Completion decision recording (RFC LP-15, Phase 0 — golden harness).
 *
 * The completion authority is split between the deterministic contract kernel
 * (`completion-kernel.ts`) and the legacy guard chain inside
 * `AgentLoop.handleDoneToolCall`. Before either can be refactored (Phases 7a/7b),
 * we need a golden corpus of `(input surface -> decision)` pairs so the eventual
 * pure pipeline can be proven byte-identical to today's behaviour.
 *
 * This module defines the serialized record shape and the pure replay seam. It
 * is intentionally free of `chrome.*` and of any `AgentLoop` coupling so the
 * record can be produced in the runtime, dumped to a fixture, and re-evaluated
 * in a unit test with zero environment.
 */

import type { DomSnapshot } from "../../../types";
import {
  CompletionEvidenceLedger,
  deriveCompletionEvidenceFromSnapshot,
  type CompletionCandidateSource,
  type CompletionEvaluation,
  type CompletionEvidence,
} from "../completion-kernel";
import { evaluateGeneratedCompletionCandidate } from "../completion-evaluation-service";

/**
 * Bump when the serialized shape changes in a way that invalidates existing
 * corpus fixtures. The replay test asserts every loaded record carries the
 * current version.
 */
export const COMPLETION_DECISION_RECORD_VERSION = 1;

export type CompletionDecisionVerdict = "accepted" | "rejected";

/**
 * Coarse origin of the decision. Phase 0 records this best-effort from the
 * loop-side outcome; Phases 7a/7b refine it into the authoritative
 * `CompletionPipelineDecision.basis` once guards become self-identifying.
 */
export type CompletionDecisionBasis =
  | "duplicate_terminal"
  | "kernel"
  | "kernel_reject"
  | "legacy_done_guards"
  | "unknown";

/**
 * The full input surface `handleDoneToolCall` consumes, serialized. The kernel
 * only reads a subset (userRequest/snapshot/objective/criteria/evidence/
 * summary); the counters and plan-validation fields exist so the Phase 7a
 * pipeline replay can reproduce the bypass and legacy-order semantics too.
 */
export interface CompletionDecisionRecordInput {
  userRequest: string;
  summary: string;
  candidateSource: CompletionCandidateSource;
  activeObjective?: string;
  successCriteria?: string;
  snapshot: DomSnapshot | null;
  snapshotDigest: string;
  evidence: CompletionEvidence[];
  counters: {
    turnCount: number;
    doneRejections: number;
    consecutiveSameKindRejections: number;
    lastContractRejectionKind: string | null;
  };
  planValidation: {
    hasPlan: boolean;
    planSubtaskCount: number;
    runningSubtaskIndex: number;
  };
}

export interface CompletionDecisionRecordOutcome {
  verdict: CompletionDecisionVerdict;
  basis: CompletionDecisionBasis;
  contractKind: string;
  guardId: string | null;
  reason: string;
  recoveryHint: string | null;
  /** The pure kernel verdict for this input surface — the replay anchor. */
  kernelStatus: CompletionEvaluation["status"];
  kernelContractKind: string;
  kernelReason: string;
}

export interface CompletionDecisionRecord {
  recordVersion: number;
  recordedAtTurn: number;
  input: CompletionDecisionRecordInput;
  outcome: CompletionDecisionRecordOutcome;
}

/**
 * Deterministic content digest of a snapshot. Cheap, stable, and independent of
 * key ordering so a recorded digest is reproducible across a serialize/parse
 * round-trip. Not cryptographic — collision resistance is not a goal.
 */
export function computeSnapshotDigest(snapshot: DomSnapshot | null): string {
  if (!snapshot) return "none";
  const parts = [
    snapshot.url ?? "",
    snapshot.title ?? "",
    snapshot.lang ?? "",
    String(snapshot.elements?.length ?? 0),
    String(snapshot.visibleContent?.length ?? 0),
    String(snapshot.pageContent?.length ?? 0),
    (snapshot.elements ?? [])
      .map((el) => `${el.tag}:${el.tagName}:${el.role}`)
      .join(","),
  ];
  return djb2(parts.join("|"));
}

function djb2(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  // Unsigned hex for a stable, compact digest.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The evidence set the kernel will evaluate for a given snapshot: the current
 * ledger contents merged with the snapshot-derived evidence, computed without
 * mutating the caller's ledger. Mirrors the refresh
 * `handleDoneToolCall` performs before evaluating a candidate.
 */
export function projectKernelEvidence(
  currentEvidence: CompletionEvidence[],
  snapshot: DomSnapshot | null,
  turnCount: number,
): CompletionEvidence[] {
  const ledger = new CompletionEvidenceLedger();
  ledger.addMany(currentEvidence);
  ledger.addMany(deriveCompletionEvidenceFromSnapshot(snapshot ?? null, turnCount));
  return ledger.toArray();
}

/**
 * Re-derive the kernel decision purely from a serialized record. This is the
 * Phase 0 replay operation: the corpus is byte-identical iff this reproduces
 * the recorded `kernelStatus`/`kernelContractKind` for every record.
 */
export function replayKernelDecision(record: CompletionDecisionRecord): {
  status: CompletionEvaluation["status"];
  contractKind: string;
  reason: string;
} {
  const { input } = record;
  const { decision } = evaluateGeneratedCompletionCandidate({
    userRequest: input.userRequest,
    snapshot: input.snapshot,
    activeObjective: input.activeObjective,
    successCriteria: input.successCriteria,
    evidence: input.evidence,
    candidateSource: input.candidateSource,
    summary: input.summary,
  });
  return {
    status: decision.status,
    contractKind: decision.contract?.kind ?? "none",
    reason: decision.reason,
  };
}

/**
 * Assemble a record from a captured input surface plus the loop-side outcome.
 * The kernel fields are computed here (pure), so a record is self-describing:
 * the replay test only needs the record itself.
 */
export function buildCompletionDecisionRecord(args: {
  recordedAtTurn: number;
  input: CompletionDecisionRecordInput;
  verdict: CompletionDecisionVerdict;
  basis: CompletionDecisionBasis;
  contractKind: string;
  guardId: string | null;
  reason: string;
  recoveryHint: string | null;
}): CompletionDecisionRecord {
  const { decision } = evaluateGeneratedCompletionCandidate({
    userRequest: args.input.userRequest,
    snapshot: args.input.snapshot,
    activeObjective: args.input.activeObjective,
    successCriteria: args.input.successCriteria,
    evidence: args.input.evidence,
    candidateSource: args.input.candidateSource,
    summary: args.input.summary,
  });
  return {
    recordVersion: COMPLETION_DECISION_RECORD_VERSION,
    recordedAtTurn: args.recordedAtTurn,
    input: args.input,
    outcome: {
      verdict: args.verdict,
      basis: args.basis,
      contractKind: args.contractKind,
      guardId: args.guardId,
      reason: args.reason,
      recoveryHint: args.recoveryHint,
      kernelStatus: decision.status,
      kernelContractKind: decision.contract?.kind ?? "none",
      kernelReason: decision.reason,
    },
  };
}

/**
 * Deterministic JSON with recursively sorted object keys. Two records that are
 * structurally equal stringify identically regardless of insertion order —
 * the basis for the "byte-identical" corpus assertion.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
