/**
 * Rejection-budget guard (RFC LP-15, Phase 7a).
 *
 * Pure mirror of the max-rejections hard gate at the top of
 * `rejectDoneBeforePlanValidation` (loop.ts:1869) → `rejectDoneAfterMaxRejections`
 * (loop.ts:1772). Fires when the running rejection count already meets the cap,
 * BEFORE any further guard runs. It does NOT bump the counter (the cap is
 * already met) and emits only the hard "stop calling done()" message.
 */

import type { CompletionGuardContext } from "./context";
import type { GuardOutcome } from "../pipeline-types";

export function assessMaxRejectionsGuard(
  ctx: CompletionGuardContext,
): GuardOutcome {
  if (ctx.doneRejections < ctx.maxDoneRejections) return { kind: "pass" };

  return {
    kind: "reject",
    guardId: "max_rejections",
    reason: "Maximum done() rejection limit exceeded.",
    effects: [
      {
        type: "post_context_message",
        role: "tool",
        content:
          "done() BLOCKED: You have already exceeded the maximum rejection limit. " +
          "You MUST take a different action - click a button, type into a field, " +
          "scroll the page, or call escalate(). Do NOT call done() again.",
      },
    ],
  };
}
