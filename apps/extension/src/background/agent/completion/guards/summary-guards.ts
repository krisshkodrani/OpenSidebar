/**
 * Summary preflight guard (RFC LP-15, Phase 7a).
 *
 * Pure mirror of `AgentLoop.rejectDoneForCompletionSummaryPreflight`
 * (loop.ts:3001). Wraps the existing `evaluateCompletionSummaryPreflight`
 * evaluator and maps its three reject shapes to declarative effects:
 *   - needs_clarification → clarify redirect (NO counter bump, NO trace);
 *   - missing_multi_return_coverage → counter reject + multi-return trace;
 *   - incomplete_summary → counter reject + cut-off trace.
 */

import { evaluateCompletionSummaryPreflight } from "../preflight";
import type { CompletionGuardContext } from "./context";
import type { GuardOutcome } from "../pipeline-types";
import { countingRejectEffects } from "./reject-effects";

const GUARD_ID = "summary_preflight" as const;

export function assessSummaryGuard(ctx: CompletionGuardContext): GuardOutcome {
  const decision = evaluateCompletionSummaryPreflight({
    summary: ctx.summary,
    taskContext: ctx.taskContext,
    turnCount: ctx.turnCount,
    rootUserRequest: ctx.userRequest,
    isOrchestratorNode: ctx.isOrchestratorNode,
  });

  if (decision.status === "valid") return { kind: "pass" };

  if (decision.status === "needs_clarification") {
    // T1 summary-is-a-question → redirect to clarify(). No counter, no trace.
    return {
      kind: "reject",
      guardId: GUARD_ID,
      reason: decision.reason,
      effects: [
        {
          type: "post_context_message",
          role: "tool",
          content:
            "done() REJECTED: Your summary is a question, not a completion report. " +
            "Use the clarify() tool to ask the user a question. " +
            "Do NOT call done() to ask questions.",
        },
      ],
    };
  }

  if (decision.kind === "missing_multi_return_coverage") {
    return {
      kind: "reject",
      guardId: GUARD_ID,
      reason: decision.reason,
      effects: countingRejectEffects({
        traceEvent: "done_rejected_incomplete_multi_return",
        traceData: { reason: decision.reason },
        summary: ctx.summary,
        primaryReason: decision.reason,
        fallbackInstruction:
          "Return all requested results before calling done().",
      }),
    };
  }

  // incomplete_summary (cut-off).
  return {
    kind: "reject",
    guardId: GUARD_ID,
    reason: decision.reason,
    effects: countingRejectEffects({
      traceEvent: "done_rejected_incomplete_summary",
      traceData: {
        reason: decision.reason,
        summaryTail: ctx.summary.slice(-120),
      },
      summary: ctx.summary,
      primaryReason: `The summary appears cut off (${decision.reason}).`,
      fallbackInstruction:
        "YOUR NEXT ACTION: call done() again with a complete, concise summary using complete sentences. Do not continue browsing unless page evidence is missing.",
    }),
  };
}
