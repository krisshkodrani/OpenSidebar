/**
 * feedback phase (RFC LP-16 Phase 3, extending the LP-15 Phase 11 turn machine).
 *
 * Pre-inference context injection: fold any pending user feedback into the
 * conversation (resetting the rescue-policy clocks on a user redirection) and,
 * on a turn-budget cadence, inject the budget reminder that nudges the model
 * toward done()/escalate(). Pure side-effects on the conversation context, so it
 * always continues. Everything it touches is a real AgentLoop field/method, so
 * loop() passes `this` (the established dispatch-host idiom).
 */

import type { ContextManager } from "../context";
import type { TraceRecorder } from "../trace";

export interface FeedbackPhaseHost {
  pendingFeedback: string | null;
  readonly turnCount: number;
  readonly traceRecorder: TraceRecorder | null;
  readonly context: ContextManager;
  readonly escalationRescue: { noteUserIntervention(turn: number): void };
}

export type FeedbackPhaseResult = { kind: "continue" };

export function runFeedbackPhase(host: FeedbackPhaseHost): FeedbackPhaseResult {
  // Inject pending hint from user before LLM call
  if (host.pendingFeedback) {
    host.traceRecorder?.recordEvent("feedback", {
      text: host.pendingFeedback,
    });
    host.context.addMessage({
      role: "user",
      content: `[User feedback]: ${host.pendingFeedback}`,
    });
    host.pendingFeedback = null;
    // User redirection restarts the rescue-policy progress clocks.
    host.escalationRescue.noteUserIntervention(host.turnCount);
  }

  const historicalToolCalls = host.context
    .getMessages()
    .reduce(
      (count, msg) =>
        count +
        (msg.role === "assistant" && Array.isArray(msg.tool_calls)
          ? msg.tool_calls.length
          : 0),
      0,
    );
  const shouldInjectTurnBudgetReminder =
    (host.turnCount > 0 && host.turnCount % 15 === 0) ||
    (host.turnCount === 1 && historicalToolCalls >= 15);
  if (shouldInjectTurnBudgetReminder) {
    const attemptsSoFar = host.turnCount + historicalToolCalls;
    host.traceRecorder?.recordEvent("turn_budget_reminder", {
      turn: host.turnCount,
      historicalToolCalls,
    });
    host.context.addMessage({
      role: "user",
      content:
        `TURN BUDGET: You have already used about ${attemptsSoFar} action turns on this objective. ` +
        `If the goal is already satisfied, call done(). Otherwise, if you are not making clear progress, ` +
        `call escalate({"reason": "Stuck after ${attemptsSoFar} turns without completing the goal"}) now. Do not keep cycling.`,
    });
  }

  // LP-17 fill checklist: when the set of confirmed-filled form fields
  // changed, tell the model once. The always-current copy lives in the system
  // prompt; this ping just draws attention to the change.
  const checklistLine = host.context.consumeChecklistFeedbackLine();
  if (checklistLine) {
    host.traceRecorder?.recordEvent("fill_checklist_feedback", {
      turn: host.turnCount,
    });
    host.context.addMessage({ role: "user", content: checklistLine });
  }

  return { kind: "continue" };
}
