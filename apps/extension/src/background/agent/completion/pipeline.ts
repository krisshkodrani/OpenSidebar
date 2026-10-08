/**
 * Completion pipeline runner (RFC LP-15, Phase 7a).
 *
 * Assembles the pure completion guards, deterministic kernel, and injected
 * planner stage into a single ordered decision:
 *
 *   idempotency → summary → grounding → kernel (accept / reject) →
 *   legacy bundle (max_rejections → money_table →
 *   early_multistep → task_contract → workflow_contract) →
 *   planner validation → pending_autocomplete → missing_evidence → fallthrough.
 *
 * The kernel decision is precomputed by the caller (frozen kernel via
 * `evaluateGeneratedCompletionCandidate`) and the planner stage is an injected
 * async dep — the only two non-pure seams. In replay the planner is stubbed
 * with the recorded result. Effects accumulate in execution order (pass-time
 * side-effects included) for the 7b applier.
 *
 * This pipeline is THE completion authority (the
 * `completionDeterministicAcceptanceEnabled` escape hatch was retired
 * 2026-07-14 after zero recorded divergence): the kernel decides accept/reject
 * unconditionally at stage 4, and the "legacy" guard names below are the
 * absorbed pre-pipeline guard chain, not a parallel implementation.
 */

import type { CompletionEvaluation } from "../completion-kernel";
import type { CompletionGuardContext } from "./guards/context";
import type {
  CompletionEffect,
  CompletionPipelineDecision,
  GuardOutcome,
} from "./pipeline-types";
import { assessSummaryGuard } from "./guards/summary-guards";
import { assessGroundingGuard } from "./guards/grounding-guards";
import { assessMaxRejectionsGuard } from "./guards/budget-guards";
import {
  assessEarlyMultiStepGuard,
  assessMoneyTableGuard,
  assessPendingAutocompleteGuard,
} from "./guards/domain-guards";
import {
  assessMissingEvidenceGuard,
  assessTaskContractGuard,
  assessWorkflowContractGuard,
} from "./guards/contract-guards";

/** Result of the injected planner-validation stage (null = no plan / skipped). */
export interface PlannerValidationResult {
  rejected: boolean;
  reason: string;
  /**
   * Running plan-step index at validation time, used to build the
   * run_done_plan_rejection effect (RFC LP-16 Phase 2). Optional so replay
   * records — which return [] from buildPlanRejectionEffects — need not carry it.
   */
  effectiveCurrentIdx?: number;
}

export interface CompletionPipelineDeps {
  /**
   * Frozen-kernel evaluation for this done() attempt, computed lazily so the
   * live authority path only evaluates the kernel once summary + grounding have
   * passed (matching legacy order + side-effects). Replay returns a
   * precomputed pure decision.
   */
  getKernelDecision: () => CompletionEvaluation;
  /** `Boolean(this.completedResult)` — duplicate terminal short-circuit. */
  isDuplicateTerminal: boolean;
  /**
   * Injected planner validation (model call live; stubbed with the recorded
   * result in replay). Returns null when no plan applies (`taskId` +
   * `planSubtaskCount > 0` gates the stage).
   */
  validatePlan: () => Promise<PlannerValidationResult | null>;
  /**
   * Apply the kernel-reject effects (the loop-coupled
   * Single-authority (RFC LP-16 Phase 2): rather than mutating loop state
   * directly, the loop RETURNS the kernel-rejection effects (rejection counters,
   * last-rejection record, escalation check, the completion_decision +
   * conditional pending-autocomplete traces, and the diagnostic message) and the
   * pipeline appends them to the decision so applyCompletionEffects performs the
   * mutations in order. Called on a kernel rejection; returns
   * [] in replay (only the verdict is compared there).
   */
  buildKernelRejectionEffects: (
    decision: CompletionEvaluation,
  ) => CompletionEffect[];
  /**
   * Build the done-against-active-plan rejection effects (RFC LP-16 Phase 2
   * single-authority): rather than the injected validatePlan dep applying the
   * rejection policy inline, the loop returns a run_done_plan_rejection effect
   * and the pipeline carries it so applyCompletionEffects runs the policy.
   * Called only on a planner reject; returns [] in replay.
   */
  buildPlanRejectionEffects: (
    plan: PlannerValidationResult,
  ) => CompletionEffect[];
}

export async function runCompletionPipeline(
  ctx: CompletionGuardContext,
  deps: CompletionPipelineDeps,
): Promise<CompletionPipelineDecision> {
  const effects: CompletionEffect[] = [];

  const rejectFrom = (
    outcome: Extract<GuardOutcome, { kind: "reject" }>,
    basis: CompletionPipelineDecision["basis"] = "legacy_done_guards",
    contractKind = "legacy_done_guards",
  ): CompletionPipelineDecision => ({
    verdict: "reject",
    basis,
    contractKind: outcome.contractKind ?? contractKind,
    rejectedBy: outcome.guardId,
    reason: outcome.reason,
    recoveryHint: outcome.recoveryHint ?? null,
    effects: [...effects, ...outcome.effects],
  });

  // Runs a pure guard; on reject returns the assembled decision, on pass
  // accumulates its pass-effects and returns null to advance.
  const runGuard = (
    outcome: GuardOutcome,
  ): CompletionPipelineDecision | null => {
    if (outcome.kind === "pass") {
      if (outcome.effects) effects.push(...outcome.effects);
      return null;
    }
    if (outcome.kind === "reject") return rejectFrom(outcome);
    // accept
    effects.push(...outcome.effects);
    return {
      verdict: "accept",
      basis: outcome.basis,
      contractKind: outcome.contractKind ?? "unknown",
      rejectedBy: outcome.guardId,
      reason: outcome.reason,
      recoveryHint: null,
      effects: [...effects],
    };
  };

  // 1. Idempotency / duplicate-terminal accept short-circuit.
  if (deps.isDuplicateTerminal) {
    return {
      verdict: "accept",
      basis: "duplicate_terminal",
      contractKind: "unknown",
      rejectedBy: "idempotency",
      reason: "duplicate_done_after_terminal_completion",
      recoveryHint: null,
      effects: [],
    };
  }

  // 2. Summary preflight. 3. Grounding read.
  let decided = runGuard(assessSummaryGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessGroundingGuard(ctx));
  if (decided) return decided;

  // 4. Kernel evaluation (lazy: only now, after summary + grounding passed).
  const kernel = deps.getKernelDecision();
  if (kernel.status === "accepted") {
    return {
      verdict: "accept",
      basis: "kernel",
      contractKind: kernel.contract?.kind ?? "unknown",
      rejectedBy: "kernel",
      reason: kernel.reason ?? "",
      recoveryHint: null,
      effects: [...effects],
    };
  }
  // Only "rejected" / "needs_verification" decide at the kernel; any other
  // status (e.g. "inconclusive") falls through to the legacy bundle exactly
  // as legacy does.
  if (kernel.status === "rejected" || kernel.status === "needs_verification") {
    // Repeating a claim does not add evidence. Keep the kernel's rejection
    // authoritative; its effects still track attempts and trigger recovery.
    return {
      verdict: "reject",
      basis: "kernel_reject",
      contractKind: kernel.contract?.kind ?? "unknown",
      rejectedBy: "kernel",
      reason: kernel.reason ?? "",
      recoveryHint: null,
      // Preserve effect order: recovery/counters precede pass-time effects.
      effects: [...deps.buildKernelRejectionEffects(kernel), ...effects],
    };
  }

  // 5. Legacy bundle, in the exact rejectDoneBeforePlanValidation order.
  decided = runGuard(assessMaxRejectionsGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessMoneyTableGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessEarlyMultiStepGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessTaskContractGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessWorkflowContractGuard(ctx));
  if (decided) return decided;

  // 6. Planner validation (injected). Only when a plan applies.
  const plan = await deps.validatePlan();
  if (plan && plan.rejected) {
    return {
      verdict: "reject",
      basis: "legacy_done_guards",
      contractKind: "plan_validation",
      rejectedBy: "plan_validation",
      reason: plan.reason,
      recoveryHint: null,
      // Prepend the plan-rejection effect so the policy applies before any
      // accumulated pass-time effects — matching the pre-absorption order where
      // handleDonePlanRejection ran inline (during this stage) ahead of the
      // deferred applyCompletionEffects pass.
      effects: [...deps.buildPlanRejectionEffects(plan), ...effects],
    };
  }

  // 7. Pending autocomplete. 8. Missing required evidence.
  decided = runGuard(assessPendingAutocompleteGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessMissingEvidenceGuard(ctx));
  if (decided) return decided;

  // 9. Fallthrough accept.
  return {
    verdict: "accept",
    basis: "legacy_done_guards",
    contractKind: "legacy_done_guards",
    rejectedBy: "fallthrough_accept",
    reason: "legacy_done_guards_passed",
    recoveryHint: null,
    effects: [...effects],
  };
}
