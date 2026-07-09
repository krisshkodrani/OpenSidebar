/**
 * Completion pipeline vocabulary (RFC LP-15, Phase 7a).
 *
 * The `done()` completion decision is being converted from an inline chain of
 * guard methods inside `AgentLoop.handleDoneToolCallInner` into a pure, ordered
 * pipeline. This module defines the *vocabulary* that pipeline speaks:
 *
 *   - `CompletionGuardId` — one id per ordered stage that can decide.
 *   - `CompletionEffect`  — every state mutation a decision performs, as
 *                           declarative data (applied by `applyCompletionEffects`).
 *   - `GuardOutcome`      — what a single pure guard returns.
 *   - `CompletionPipelineDecision` — the assembled decision the runner returns.
 *
 * Phase 7a runs the pipeline in SHADOW: legacy still decides and still mutates
 * state directly; the pipeline's decision is only compared (verdict + guardId +
 * reason + recoveryHint) against the recorded legacy outcome. The effects are
 * defined and unit-tested here but do not become authoritative until 7b, when
 * they replace the inline mutations.
 */

import type { CompletionEvaluation } from "../completion-kernel";

/**
 * One id per ordered decision stage in `handleDoneToolCallInner`, in execution
 * order. Every reject/accept names the stage that produced it — the shadow gate
 * compares this against the recorded legacy `guardId`.
 */
export type CompletionGuardId =
  | "idempotency"
  | "summary_preflight"
  | "grounding_read"
  | "kernel"
  | "max_rejections"
  | "money_table"
  | "early_multistep"
  | "task_contract"
  | "workflow_contract"
  | "list_detail"
  | "plan_validation"
  | "pending_autocomplete"
  | "missing_evidence"
  | "fallthrough_accept";

/**
 * Coarse origin of the assembled decision. Mirrors the RFC's basis and aligns
 * with `CompletionDecisionRecordOutcome.basis` for the shadow comparison.
 */
export type CompletionPipelineBasis =
  | "duplicate_terminal"
  | "kernel"
  | "kernel_reject"
  | "kernel_bypass_legacy"
  | "legacy_done_guards";

/**
 * A single declarative state mutation. The legacy guards perform these inline
 * today; the pipeline emits them as data so `applyCompletionEffects` (the 7b
 * authority) can reproduce the exact mutation set. Kept one-effect-per-mutation
 * deliberately so the flip is mechanical and the shadow diff is precise.
 */
export type CompletionEffect =
  /** `this.doneRejections++` — the counter-bumping reject paths. */
  | { type: "increment_done_rejections" }
  /**
   * Update `lastContractRejectionKind` + `consecutiveSameKindRejections`: the
   * same-kind bounce counter (++ when kind matches the last, else reset to 1).
   */
  | { type: "record_contract_rejection"; kind: string }
  /** Set `lastCompletionRejection` to the kernel evaluation. */
  | { type: "set_last_completion_rejection"; decision: CompletionEvaluation }
  /** Set `lastCompletionRecoveryHint`. */
  | { type: "set_recovery_hint"; hint: string | null }
  /** Post a plain recovery message into context (verbatim content). */
  | { type: "post_context_message"; role: "tool" | "user"; content: string }
  /**
   * Post a done-rejection diagnostic message. Carries the structured inputs
   * (`doneRejectionDiagnosticContent` is loop-coupled — it folds in the running
   * rejection count) so 7b renders the exact content at apply time.
   */
  | {
      type: "post_rejection_diagnostic";
      summary: string;
      primaryReason: string;
      fallbackInstruction: string;
    }
  /** Emit a trace event. */
  | { type: "emit_trace"; event: string; data: Record<string, unknown> }
  /** Set the `guardAfterDoneRejection` idempotency flag. */
  | { type: "set_guard_after_done_rejection" }
  /** Run `checkAndSetDoneRejectionEscalation()` (may set the escalation flag). */
  | { type: "check_done_rejection_escalation" }
  /** Force a grounding snapshot refresh (async). */
  | { type: "force_grounding_refresh" }
  /**
   * Run the done-against-active-plan rejection policy (RFC LP-16 Phase 2
   * single-authority): retry_step nudge / three-layer auto-advance gate / normal
   * rejection. Carries the structured inputs so the effect host replays the
   * policy at apply time. Previously applied inline inside the injected
   * `validatePlan` dep; now routed through the pipeline's effect stream. Safe
   * because a planner reject short-circuits the remaining pipeline stages, so no
   * stage reads the mutated plan/rejection state between the dep and apply time.
   */
  | {
      type: "run_done_plan_rejection";
      toolCallId: string;
      summary: string;
      rejectReason: string;
      effectiveCurrentIdx: number;
    };

/** Discriminant of the effect union — handy for exhaustive assertions/tests. */
export type CompletionEffectType = CompletionEffect["type"];

/**
 * What one pure guard returns. `pass` → the runner advances to the next stage;
 * `reject`/`accept` → the runner stops and assembles the decision, carrying the
 * guard's effects (applied by the shim at 7b).
 */
export type GuardOutcome =
  /** Advance to the next stage. `effects` carries any pass-time side-effects
   *  (e.g. the grounding guard's `done_grounded_from_snapshot` trace). */
  | { kind: "pass"; effects?: CompletionEffect[] }
  | {
      kind: "reject";
      guardId: CompletionGuardId;
      reason: string;
      contractKind?: string;
      recoveryHint?: string | null;
      effects: CompletionEffect[];
    }
  | {
      kind: "accept";
      guardId: CompletionGuardId;
      basis: CompletionPipelineBasis;
      reason: string;
      contractKind?: string;
      effects: CompletionEffect[];
    };

/**
 * The decision the pipeline runner returns. In shadow mode only
 * `verdict`/`rejectedBy`/`reason`/`recoveryHint` are compared against the
 * recorded legacy outcome; `effects` are carried for the 7b flip.
 */
export interface CompletionPipelineDecision {
  verdict: "accept" | "reject";
  basis: CompletionPipelineBasis;
  contractKind: string;
  /** The stage that produced the decision (null only for a bare fallthrough). */
  rejectedBy: CompletionGuardId | null;
  reason: string;
  recoveryHint: string | null;
  effects: CompletionEffect[];
}
