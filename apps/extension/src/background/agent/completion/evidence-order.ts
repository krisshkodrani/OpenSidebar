import type { CompletionEvidence } from "./kernel-types";

export function compareEvidenceRecency(
  a: CompletionEvidence,
  b: CompletionEvidence,
): number {
  return (
    b.observedAtTurn - a.observedAtTurn ||
    evidenceConfidenceRank(b) - evidenceConfidenceRank(a)
  );
}

function evidenceConfidenceRank(event: CompletionEvidence): number {
  return event.confidence === "high" ? 2 : 1;
}
