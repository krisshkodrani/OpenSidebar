export type AgentCueStepStatus = "running" | "done" | "error";
export type AgentCueBorderState = "active" | null;
export type AgentTaskOutcomeStatus = "completed" | "failed" | "stopped";
export type AgentOperationRailStatus =
  | "Idle"
  | "Running"
  | "Done"
  | "Failed"
  | "Stopped"
  | "Disconnected";
export type AgentOperationOutcome = "" | AgentTaskOutcomeStatus;

export interface AgentCueTransition {
  showCue: boolean;
  hideAfterMs: number | null;
  borderState: AgentCueBorderState;
}

export interface AgentOperationActivity {
  active: boolean;
  status: AgentOperationRailStatus;
  outcome: AgentOperationOutcome;
}

export interface AgentActivitySignalState {
  sessionActive: boolean;
  pageActivityActive: boolean;
  rail: AgentOperationActivity;
}

export type AgentActivitySignalEvent =
  | {
      type: "activity";
      active: boolean;
      pageActivity?: boolean;
      outcome?: { status: AgentTaskOutcomeStatus; label?: string };
    }
  | { type: "step"; status: AgentCueStepStatus }
  | { type: "disconnect" };

export interface AgentActivitySignalReduction {
  state: AgentActivitySignalState;
  accepted: boolean;
}

export const INITIAL_AGENT_ACTIVITY_SIGNAL_STATE: AgentActivitySignalState = {
  sessionActive: false,
  pageActivityActive: false,
  rail: { active: false, status: "Idle", outcome: "" },
};

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
    borderState: "active",
  };
}

export function deriveAgentOperationActivity(input: {
  taskActive: boolean;
  stepStatus: AgentCueStepStatus;
}): AgentOperationActivity {
  if (input.taskActive || input.stepStatus === "running") {
    return { active: true, status: "Running", outcome: "" };
  }

  if (input.stepStatus === "done") {
    return { active: false, status: "Done", outcome: "completed" };
  }

  return { active: false, status: "Failed", outcome: "failed" };
}

function terminalRail(
  outcome?: { status: AgentTaskOutcomeStatus },
): AgentOperationActivity {
  if (outcome?.status === "completed") {
    return { active: false, status: "Done", outcome: "completed" };
  }

  if (outcome?.status === "failed") {
    return { active: false, status: "Failed", outcome: "failed" };
  }

  if (outcome?.status === "stopped") {
    return { active: false, status: "Stopped", outcome: "stopped" };
  }

  return { active: false, status: "Idle", outcome: "" };
}

export function reduceAgentActivitySignal(
  state: AgentActivitySignalState,
  event: AgentActivitySignalEvent,
): AgentActivitySignalReduction {
  if (event.type === "activity") {
    if (event.active) {
      const pageActivityActive = state.sessionActive
        ? state.pageActivityActive || event.pageActivity === true
        : (event.pageActivity ?? true);

      return {
        accepted: true,
        state: {
          sessionActive: true,
          pageActivityActive,
          rail: { active: true, status: "Running", outcome: "" },
        },
      };
    }

    if (!state.sessionActive) {
      return { accepted: false, state };
    }

    return {
      accepted: true,
      state: {
        sessionActive: false,
        pageActivityActive: false,
        rail: terminalRail(event.outcome),
      },
    };
  }

  if (event.type === "step") {
    if (!state.sessionActive) {
      return { accepted: false, state };
    }

    return {
      accepted: true,
      state: {
        sessionActive: true,
        pageActivityActive:
          state.pageActivityActive || event.status === "running",
        rail: { active: true, status: "Running", outcome: "" },
      },
    };
  }

  if (!state.sessionActive) {
    return { accepted: false, state };
  }

  return {
    accepted: true,
    state: {
      sessionActive: false,
      pageActivityActive: false,
      rail: { active: false, status: "Disconnected", outcome: "" },
    },
  };
}
