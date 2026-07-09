/**
 * Deterministic completion-envelope verification for the orchestrator
 * (RFC LP-16 Phase 5). Decides whether an executor lane's deterministic
 * completion envelope carries enough evidence to accept, and whether a saved
 * turn checkpoint still matches the live snapshot. Verbatim movement from
 * orchestrator/index.ts.
 */
import type { CompletionEnvelope } from "../agent/completion-kernel";
import type { TurnCheckpoint } from "../agent/checkpoint-types";
import type { NodeVerificationResult } from "./verifier";
import { getSnapshotFingerprint } from "../agent/loop-helpers";

export function isTurnCheckpointCompatible(
  checkpoint: TurnCheckpoint,
  snapshot:
    | {
        url?: string;
        elements?: { length: number };
        visibleContent?: string;
        pageContent?: string;
      }
    | null
    | undefined,
): boolean {
  if (!snapshot) return false;
  if ((snapshot.url ?? null) !== checkpoint.pageUrl) return false;
  return getSnapshotFingerprint(snapshot) === checkpoint.snapshotFingerprint;
}

export function buildCompletionEnvelopeRepairObjective(
  objective: string | undefined,
): string {
  const trimmedObjective = objective?.trim();
  const prefix = trimmedObjective
    ? `Verify and repair the completion for: ${trimmedObjective}.`
    : "Verify and repair the previous completion.";
  return (
    `${prefix} The previous executor lane reported completion through a ` +
    "deterministic envelope, but the envelope lacked required evidence. " +
    "Re-check the current page state, complete only missing verification or repair actions, then call done with explicit evidence."
  );
}

export function verifyDeterministicCompletionEnvelope(
  envelope: CompletionEnvelope,
  objective?: string,
): NodeVerificationResult | null {
  if (envelope.contractKind === "legacy_done_guards") {
    return null;
  }

  if (
    envelope.status !== "completed" ||
    !envelope.resultId ||
    !envelope.contractKind ||
    !envelope.decisionReason ||
    !envelope.evidenceEpoch ||
    !Array.isArray(envelope.evidenceKeys) ||
    envelope.evidenceKeys.length === 0
  ) {
    return {
      decision: "reroute",
      reason:
        "Completion envelope was present but lacked the deterministic evidence required for node acceptance.",
      confidence: 0.85,
      failureType: "insufficient_evidence",
      rerouteObjective: buildCompletionEnvelopeRepairObjective(objective),
    };
  }

  return {
    decision: "accept",
    reason: `Accepted deterministic completion envelope (${envelope.contractKind}): ${envelope.decisionReason}`,
    confidence: 0.95,
  };
}
