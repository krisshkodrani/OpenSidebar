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
      hideAfterMs: null,
      borderState: "active",
    };
  }

  return {
    showCue: true,
    hideAfterMs: null,
    borderState: "settle",
  };
}
