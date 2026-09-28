import type {
  CompletionEnvelope,
  CompletionEvaluation,
} from "../completion-kernel";
import {
  buildCompletionDecisionRecord,
  type CompletionDecisionBasis,
  type CompletionDecisionRecordInput,
} from "./decision-record";
import { recordCompletionDecision } from "./decision-recorder";
import type { PlannerValidationResult } from "./pipeline";

export function recordCompletionDecisionOutcome(
  input: CompletionDecisionRecordInput,
  verdict: boolean,
  state: {
    plannerResult: PlannerValidationResult | null;
    envelope: CompletionEnvelope | undefined;
    getEvidenceCount: () => number;
    rejection: CompletionEvaluation | null;
    recoveryHint: string | null;
  },
): void {
  // The planner result is only known after the inner decision runs.
  input.plannerResult = state.plannerResult;
  let basis: CompletionDecisionBasis = "unknown";
  let contractKind = "unknown";
  let reason = "";
  const { envelope } = state;
  if (verdict && envelope) {
    contractKind = envelope.contractKind;
    reason = envelope.decisionReason;
    basis =
      envelope.contractKind === "legacy_done_guards"
        ? "legacy_done_guards"
        : state.getEvidenceCount() === 0 &&
            envelope.decisionReason === "duplicate_done_after_terminal_completion"
          ? "duplicate_terminal"
          : "kernel";
  } else if (!verdict) {
    const { rejection } = state;
    basis = "kernel_reject";
    contractKind =
      rejection && rejection.status !== "accepted"
        ? (rejection.contract?.kind ?? "unknown")
        : "unknown";
    reason =
      rejection && rejection.status !== "accepted"
        ? rejection.reason
        : "rejected_by_legacy_guard";
  }
  recordCompletionDecision(
    buildCompletionDecisionRecord({
      recordedAtTurn: input.counters.turnCount,
      input,
      verdict: verdict ? "accepted" : "rejected",
      basis,
      contractKind,
      guardId: verdict
        ? null
        : contractKind === "unknown"
          ? null
          : contractKind,
      reason,
      recoveryHint: state.recoveryHint ?? null,
    }),
  );
}
