/**
 * Domain completion guards (RFC LP-15, Phase 7a).
 *
 * Pure mirrors of:
 *   - `rejectDoneForPendingAutocompletePreflight` (loop.ts:3083);
 *   - `rejectDoneForMoneyTableAggregate` (loop.ts:3474) — two reject kinds;
 *   - `rejectDoneForIncompleteListDetailReview` (loop.ts:3425);
 *   - `rejectDoneForEarlyMultiStepTask` (loop.ts:3552).
 *
 * None embed the max-rejections branch. Loop-coupled counts/reasons (list-detail
 * counts, money-table aggregate reasons, autocomplete objective) are precomputed
 * into the context by the pipeline caller.
 */

import {
  evaluateCompletionEarlyMultiStepPreflight,
  evaluateCompletionListDetailReviewPreflight,
  evaluateCompletionMoneyTableAggregatePreflight,
  evaluateCompletionPendingAutocompletePreflight,
} from "../preflight";
import type { CompletionGuardContext } from "./context";
import type { GuardOutcome } from "../pipeline-types";
import { countingRejectEffects } from "./reject-effects";

export function assessPendingAutocompleteGuard(
  ctx: CompletionGuardContext,
): GuardOutcome {
  const decision = evaluateCompletionPendingAutocompletePreflight({
    snapshot: ctx.snapshot,
    userRequest: ctx.userRequest,
    activeObjective: ctx.activeObjective,
    successCriteria: ctx.successCriteria,
    summary: ctx.summary,
  });
  if (decision.status === "valid") return { kind: "pass" };

  return {
    kind: "reject",
    guardId: "pending_autocomplete",
    reason: decision.reason,
    effects: countingRejectEffects({
      traceEvent: "done_rejected_autocomplete_suggestion_pending",
      traceData: {
        rejections: ctx.doneRejections + 1,
        inputTag: decision.inputTag,
        suggestionTag: decision.suggestionTag,
        value: decision.value,
      },
      summary: ctx.summary,
      primaryReason: decision.reason,
      fallbackInstruction: `YOUR NEXT ACTION: click_element({"id": ${decision.suggestionTag}}), then verify the selected value is visible.`,
    }),
  };
}

export function assessMoneyTableGuard(
  ctx: CompletionGuardContext,
): GuardOutcome {
  const preflight = evaluateCompletionMoneyTableAggregatePreflight({
    incompleteScanReason: ctx.moneyTableIncompleteScanReason,
    incorrectAnswerReason: ctx.moneyTableIncorrectAnswerReason,
  });
  if (preflight.status === "valid") return { kind: "pass" };

  if (preflight.kind === "incomplete_money_table_scan") {
    return {
      kind: "reject",
      guardId: "money_table",
      reason: preflight.reason,
      effects: countingRejectEffects({
        traceEvent: "done_rejected_incomplete_money_table_scan",
        traceData: { turn: ctx.turnCount, reason: preflight.reason },
        summary: ctx.summary,
        primaryReason: preflight.reason,
        fallbackInstruction: "Do not call done() until the scan is exhaustive.",
      }),
    };
  }

  // incorrect_money_table_answer
  return {
    kind: "reject",
    guardId: "money_table",
    reason: preflight.reason,
    effects: countingRejectEffects({
      traceEvent: "done_rejected_incorrect_money_table_answer",
      traceData: { turn: ctx.turnCount, reason: preflight.reason },
      summary: ctx.summary,
      primaryReason: preflight.reason,
      fallbackInstruction: "Use the tracked aggregate candidate in the final answer.",
    }),
  };
}

export function assessListDetailGuard(
  ctx: CompletionGuardContext,
): GuardOutcome {
  const preflight = evaluateCompletionListDetailReviewPreflight({
    selectedSkillId: ctx.selectedSkillId,
    userRequest: ctx.userRequest,
    reviewedDetailCount: ctx.listDetailReviewedCount,
    visibleDetailActionCount: ctx.listDetailVisibleActionCount,
  });
  if (preflight.status === "valid") return { kind: "pass" };

  return {
    kind: "reject",
    guardId: "list_detail",
    reason: preflight.reason ?? "List-detail review remains incomplete.",
    effects: countingRejectEffects({
      traceEvent: "done_rejected_list_detail_incomplete",
      traceData: {
        rejections: ctx.doneRejections + 1,
        openedDetailCount: ctx.listDetailOpenedCount,
        reviewedDetailCount: ctx.listDetailReviewedCount,
        visibleDetailActionCount: ctx.listDetailVisibleActionCount,
      },
      summary: ctx.summary,
      primaryReason: preflight.reason ?? "List-detail review remains incomplete.",
      fallbackInstruction:
        "Do NOT synthesize the recommendation from list-card snippets alone.",
    }),
  };
}

export function assessEarlyMultiStepGuard(
  ctx: CompletionGuardContext,
): GuardOutcome {
  const preflight = evaluateCompletionEarlyMultiStepPreflight({
    userRequest: ctx.userRequest,
    doneRejections: ctx.doneRejections,
    turnCount: ctx.turnCount,
    hasNodeId: ctx.isOrchestratorNode,
  });
  if (preflight.status === "valid") return { kind: "pass" };

  const reason = `The task has ${preflight.stepCount} steps but you have only completed the first action.`;
  return {
    kind: "reject",
    guardId: "early_multistep",
    reason,
    effects: countingRejectEffects({
      traceEvent: "done_rejected_early_multistep",
      traceData: { turn: ctx.turnCount, stepCount: preflight.stepCount },
      summary: ctx.summary,
      primaryReason: reason,
      fallbackInstruction:
        "Continue working through the remaining steps before calling done().",
    }),
  };
}
