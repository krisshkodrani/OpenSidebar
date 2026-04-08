/**
 * Agent loop prompt constants — reflection and correction messages
 */

import { renderPrompt } from "../../prompts";

/** Format correction when LLM emits text instead of tool calls. */
export const TEXT_ONLY_CORRECTION = renderPrompt(
  "agent.reflection.text_only_correction",
);

/** Reflection injected when escalating to the planner model — orients it on the situation. */
export const ESCALATION_REFLECTION = (reason: string = "repeated failures") =>
  renderPrompt("agent.reflection.escalation", { escalationReason: reason });

/** Reflection injected when de-escalating back to the executor model. */
export const DEESCALATION_REFLECTION = renderPrompt(
  "agent.reflection.deescalation",
);

/** Reflection injected when plan-then-act handoff completes (orientation phase ends). */
export const HANDOFF_REFLECTION = (briefing: string) =>
  renderPrompt("agent.reflection.handoff", { briefing });

/** Recovery message for repeated escalations on the same step — forces a strategy break. */
export const ESCALATION_RECOVERY = (count: number, stepLabel?: string) =>
  `RECOVERY REQUIRED (escalation #${count}${stepLabel ? ` on ${stepLabel}` : ""}): Previous escalations did not resolve this. You MUST either:\n` +
  `1. Navigate to a different page (go_to_url, go_back).\n` +
  `2. Call done() explaining this step is blocked.\n` +
  `3. Call clarify() to ask the user.\n` +
  `Do NOT repeat the same investigation — the information is not on this page.`;

/** Message injected during a strategy pivot — tells the agent what NOT to retry. */
export const PIVOT_MESSAGE = (attemptSummary: string) =>
  renderPrompt("agent.reflection.pivot", { attemptSummary });

