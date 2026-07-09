/**
 * Grounding-read guard (RFC LP-15, Phase 7a).
 *
 * Pure mirror of `rejectDoneBeforeGroundingRead` (loop.ts:1788). The legacy
 * method's only impurity — `forceGroundingRefresh` + the follow-up user message
 * on the `needsGroundingRead` path — is modeled as declarative effects
 * (`force_grounding_refresh` + `post_context_message`), so the guard stays pure.
 *
 * Three outcomes:
 *   - valid → pass;
 *   - grounded_from_snapshot → pass, but carrying the informational trace effect;
 *   - rejected → reject (NO counter bump), with the no-read trace + diagnostic,
 *     plus the refresh effects when a grounding read is required.
 */

import { evaluateCompletionGroundingReadPreflight } from "../preflight";
import { taskIntentForGrounding } from "../../loop-helpers";
import type { CompletionGuardContext } from "./context";
import type { CompletionEffect, GuardOutcome } from "../pipeline-types";

export function assessGroundingGuard(
  ctx: CompletionGuardContext,
): GuardOutcome {
  const preflight = evaluateCompletionGroundingReadPreflight({
    // Classify the grounding requirement from the actual task intent (the node
    // objective, or the composed prompt's `Objective:` section) — never the
    // full composed prompt, whose skill boilerplate incidentally mentions
    // "summarize"/"read the page" and false-positives the summarize-task
    // heuristic, wrongly demanding a read_page on a compose/action task.
    userRequest: taskIntentForGrounding(ctx.activeObjective, ctx.userRequest),
    summary: ctx.summary,
    snapshot: ctx.snapshot,
    hasReadPage: ctx.hasReadPage,
    hasExplicitPageRead: ctx.hasExplicitPageRead,
    hasTaskId: ctx.hasTaskId,
  });

  if (preflight.status === "valid") return { kind: "pass" };

  if (preflight.status === "grounded_from_snapshot") {
    return {
      kind: "pass",
      effects: [
        {
          type: "emit_trace",
          event: "done_grounded_from_snapshot",
          data: {
            turn: ctx.turnCount,
            elementCount: preflight.elementCount,
            visibleLen: preflight.visibleLen,
          },
        },
      ],
    };
  }

  // rejected — never read a substantive page. No counter bump.
  const effects: CompletionEffect[] = [
    {
      type: "emit_trace",
      event: "done_rejected_no_read",
      data: {
        turn: ctx.turnCount,
        elementCount: preflight.elementCount,
        visibleLen: preflight.visibleLen,
      },
    },
    {
      type: "post_rejection_diagnostic",
      summary: ctx.summary,
      primaryReason:
        "Call read_page first to verify actual page content before reporting.",
      fallbackInstruction: "Do NOT summarize from the page title or URL alone.",
    },
  ];
  if (preflight.needsGroundingRead) {
    effects.push({ type: "force_grounding_refresh" });
    effects.push({
      type: "post_context_message",
      role: "user",
      content:
        'The page has been refreshed for grounding. Use the current page content to answer, then call done({"summary": "..."}).',
    });
  }

  return {
    kind: "reject",
    guardId: "grounding_read",
    reason:
      "Call read_page first to verify actual page content before reporting.",
    effects,
  };
}
