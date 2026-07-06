/**
 * Completion pipeline runner (RFC LP-15, Phase 7a).
 *
 * Assembles the pure completion guards + the frozen kernel + the injected
 * planner stage into a single ordered decision, preserving the EXACT order of
 * `AgentLoop.handleDoneToolCallInner` (loop.ts:2833):
 *
 *   idempotency → summary → grounding → kernel (accept / same-kind bypass /
 *   reject) → legacy bundle (max_rejections → grounding → money_table →
 *   early_multistep → task_contract → workflow_contract → list_detail) →
 *   planner validation → pending_autocomplete → missing_evidence → fallthrough.
 *
 * The kernel decision is precomputed by the caller (frozen kernel via
 * `evaluateGeneratedCompletionCandidate`) and the planner stage is an injected
 * async dep — the only two non-pure seams. In shadow the planner reuses the
 * legacy result; in replay it is stubbed. Effects accumulate in execution order
 * (pass-time side-effects included) for the 7b applier.
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
  assessListDetailGuard,
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
}

export interface CompletionPipelineDeps {
  /** Precomputed frozen-kernel evaluation for this done() attempt. */
  kernelDecision: CompletionEvaluation;
  /** `this.completionDeterministicAcceptanceEnabled`. */
  deterministicAcceptanceEnabled: boolean;
  /** `Boolean(this.completedResult)` — duplicate terminal short-circuit. */
  isDuplicateTerminal: boolean;
  /**
   * Injected planner validation (model call live; legacy-result in shadow;
   * stubbed in replay). Returns null when no plan applies (`taskId` +
   * `planSubtaskCount > 0` gates the stage).
   */
  validatePlan: () => Promise<PlannerValidationResult | null>;
}

/** Build the kernel-reject effect set (mirrors rejectDoneFromCompletionDecision:2667). */
function kernelRejectEffects(
  ctx: CompletionGuardContext,
  decision: CompletionEvaluation,
): CompletionEffect[] {
  const kind =
    decision.status === "accepted" ? "" : (decision.contract?.kind ?? "");
  const reason = decision.status === "accepted" ? "" : decision.reason;
  return [
    { type: "record_contract_rejection", kind },
    { type: "increment_done_rejections" },
    { type: "check_done_rejection_escalation" },
    { type: "set_last_completion_rejection", decision },
    {
      type: "emit_trace",
      event: "completion_decision",
      data: {
        turn: ctx.turnCount,
        status: decision.status,
        source: "model_done",
        reason,
        contractKind: kind,
      },
    },
    {
      type: "post_rejection_diagnostic",
      summary: ctx.summary,
      primaryReason: reason,
      // Exact fallback (getCompletionRejectionInstruction) is rendered at apply
      // time by the host in 7b; carry the reason as the structured anchor.
      fallbackInstruction: "",
    },
  ];
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

  // 4. Kernel evaluation (frozen kernel decision precomputed by the caller).
  const kernel = deps.kernelDecision;
  if (deps.deterministicAcceptanceEnabled) {
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
    // rejected / needs_verification → same-kind bounce bypass, else reject.
    const kind = kernel.contract?.kind ?? null;
    const bypass =
      ctx.lastContractRejectionKind === kind &&
      ctx.consecutiveSameKindRejections >= 2;
    if (bypass) {
      effects.push({
        type: "emit_trace",
        event: "completion_contract_bypassed",
        data: {
          kind: ctx.lastContractRejectionKind,
          consecutiveRejections: ctx.consecutiveSameKindRejections,
        },
      });
      // fall through to the legacy bundle
    } else {
      return {
        verdict: "reject",
        basis: "kernel_reject",
        contractKind: kind ?? "unknown",
        rejectedBy: "kernel",
        reason: kernel.reason ?? "",
        recoveryHint: null,
        effects: [...effects, ...kernelRejectEffects(ctx, kernel)],
      };
    }
  }
  // (flag off → legacy records a shadow trace; the pipeline just advances.)

  // 5. Legacy bundle, in the exact rejectDoneBeforePlanValidation order.
  decided = runGuard(assessMaxRejectionsGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessGroundingGuard(ctx)); // re-checked inside the bundle
  if (decided) return decided;
  decided = runGuard(assessMoneyTableGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessEarlyMultiStepGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessTaskContractGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessWorkflowContractGuard(ctx));
  if (decided) return decided;
  decided = runGuard(assessListDetailGuard(ctx));
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
      effects: [...effects],
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
