export const AGENT_ACTION_IDLE_MS = 2200;
export const AGENT_STEP_SETTLE_MS = 1400;

export type AgentCueStepStatus = "running" | "done" | "error";
export type AgentCueBorderState = "active" | "settle" | null;

export interface AgentCueTransition {
  showCue: boolean;
  hideAfterMs: number | null;
  borderState: AgentCueBorderState;
}

export function deriveAgentCueTransition(input: {
  sessionActive: boolean;
  stepStatus: AgentCueStepStatus;
}): AgentCueTransition {
  if (!input.sessionActive) {
    return { showCue: false, hideAfterMs: null, borderState: null };
  }

  if (input.stepStatus === "running") {
    return {
      showCue: true,
      hideAfterMs: AGENT_ACTION_IDLE_MS,
      borderState: "active",
    };
  }

  return {
    showCue: true,
    hideAfterMs: AGENT_STEP_SETTLE_MS,
    borderState: "settle",
  };
}
