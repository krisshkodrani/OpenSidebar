/**
 * Task / workflow / evidence contract guards (RFC LP-15, Phase 7a).
 *
 * Pure mirrors of:
 *   - `rejectDoneForIncompleteTaskContract` (loop.ts:3284) — embeds the
 *     max-rejections branch;
 *   - `rejectDoneForWorkflowContract` (loop.ts:3384);
 *   - `rejectDoneForMissingRequiredEvidence` (loop.ts:3164) — its ServiceNow
 *     evidence inference is an injected pre-step; this guard reads the
 *     post-inference `ctx.missingRequiredEvidence`.
 */

import {
  evaluateCompletionRequiredEvidencePreflight,
  evaluateCompletionTaskContractPreflight,
  evaluateCompletionWorkflowContractPreflight,
} from "../preflight";
import type { CompletionGuardContext } from "./context";
import type { GuardOutcome } from "../pipeline-types";
import {
  countingRejectEffects,
  countingRejectEffectsWithMaxGate,
} from "./reject-effects";

export function assessTaskContractGuard(
  ctx: CompletionGuardContext,
): GuardOutcome {
  // Skip for orchestrator sub-nodes and intermediate root plan steps — the
  // executor objective is intentionally narrower there; plan validation covers
  // step completion and the full guard still runs on the final root step.
  const isIntermediateRootPlanStep =
    !ctx.isOrchestratorNode &&
    ctx.planSubtaskCount > 1 &&
    ctx.runningSubtaskIndex >= 0 &&
    ctx.runningSubtaskIndex < ctx.planSubtaskCount - 1;
  if (ctx.isOrchestratorNode || isIntermediateRootPlanStep) {
    return { kind: "pass" };
  }

  const guard = evaluateCompletionTaskContractPreflight({
    userRequest: ctx.userRequest,
    summary: ctx.summary,
    snapshot: ctx.snapshot,
  });
  if (!guard.blocked) return { kind: "pass" };

  const reason = guard.reason ?? "Task contract remains incomplete.";
  return {
    kind: "reject",
    guardId: "task_contract",
    reason,
    effects: countingRejectEffectsWithMaxGate({
      doneRejections: ctx.doneRejections,
      maxDoneRejections: ctx.maxDoneRejections,
      source: "task_contract",
      traceEvent: "done_rejected_task_contract",
      traceData: {
        rejections: ctx.doneRejections + 1,
        reason: guard.reason,
        missingEntities: guard.summaryCoverage.missingEntities,
        missingNumbers: guard.summaryCoverage.missingNumbers,
        missingReturnTarget: guard.missingReturnTarget,
      },
      blockedTraceData: { rejections: ctx.doneRejections + 1, reason: guard.reason },
      summary: ctx.summary,
      primaryReason: reason,
      normalFallbackInstruction:
        "Complete the missing task obligations, verify them on the page, then call done() again.",
      maxFallbackInstruction:
        "You have repeated done() too many times while the task is still incomplete. " +
        "Do not call done() again from this state. Take a different action or call escalate().",
    }),
  };
}

export function assessWorkflowContractGuard(
  ctx: CompletionGuardContext,
): GuardOutcome {
  const guard = evaluateCompletionWorkflowContractPreflight({
    userRequest: ctx.userRequest,
    summary: ctx.summary,
    selectedSkillId: ctx.selectedSkillId ?? undefined,
    pageUrl: ctx.snapshot?.url,
    pageTitle: ctx.snapshot?.title,
  });
  if (!guard.blocked) return { kind: "pass" };

  const reason = guard.reason ?? "Workflow contract remains incomplete.";
  return {
    kind: "reject",
    guardId: "workflow_contract",
    reason,
    effects: countingRejectEffects({
      traceEvent: "done_rejected_workflow_contract",
      traceData: {
        rejections: ctx.doneRejections + 1,
        selectedSkillId: ctx.selectedSkillId,
        reason: guard.reason,
      },
      summary: ctx.summary,
      primaryReason: reason,
      fallbackInstruction:
        "Continue the workflow, verify the requested final state, then call done() again.",
    }),
  };
}

export function assessMissingEvidenceGuard(
  ctx: CompletionGuardContext,
): GuardOutcome {
  const preflight = evaluateCompletionRequiredEvidencePreflight({
    missingRequiredEvidence: ctx.missingRequiredEvidence,
  });
  if (preflight.status === "valid") return { kind: "pass" };

  const missing = preflight.missingRequiredEvidence;
  const reason = `Missing required typed evidence: ${missing.join(", ")}.`;
  return {
    kind: "reject",
    guardId: "missing_evidence",
    reason,
    effects: countingRejectEffects({
      traceEvent: "done_rejected_missing_evidence",
      traceData: {
        rejections: ctx.doneRejections + 1,
        selectedSkillId: ctx.selectedSkillId,
        missingRequiredEvidence: missing,
      },
      summary: ctx.summary,
      primaryReason: reason,
      fallbackInstruction:
        "Use the selected workflow tool to complete and verify the action before calling done().",
    }),
  };
}
