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
export const DEESCALATION_REFLECTION = renderPrompt("agent.reflection.deescalation");

/** Reflection injected when plan-then-act handoff completes (orientation phase ends). */
export const HANDOFF_REFLECTION = (briefing: string) =>
  renderPrompt("agent.reflection.handoff", { briefing });

/** Message injected during a strategy pivot — tells the agent what NOT to retry. */
export const PIVOT_MESSAGE = (attemptSummary: string) =>
  renderPrompt("agent.reflection.pivot", { attemptSummary });
