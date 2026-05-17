import { useMemo } from "react";
import {
  AgentStatus,
  type DurableRunStatusMessage,
  type PendingApproval,
  type PendingClarification,
  type PendingEscalation,
  type PendingPlanConfirmation,
  type SessionMetrics,
  type StagnationState,
  type TaskCompletionMessage,
  type TaskProgressMessage,
  type TurnProgress,
} from "../types";
import { usefulProgressLabel } from "./progress-labels";
import { useStore } from "./store";

export type TaskUiPhase =
  | "idle"
  | "planning"
  | "confirming_plan"
  | "running"
  | "awaiting_user"
  | "paused"
  | "stalled"
  | "recoverable"
  | "completed"
  | "partial"
  | "failed"
  | "stopped";

export type TaskRailTone =
  | "running"
  | "idle"
  | "paused"
  | "stalled"
  | "failed"
  | "completed"
  | "stopped";

export interface TaskRailViewModel {
  eyebrow: "Now doing" | "Latest run";
  primaryLabel: string;
  secondaryLabel: string;
  tone: TaskRailTone;
  showSpinner: boolean;
  canPause: boolean;
  showResume: boolean;
  showStop: boolean;
  stopRequested: boolean;
  turnProgress: TurnProgress | null;
  sessionMetrics: SessionMetrics | null;
}

export interface TaskUiState {
  phase: TaskUiPhase;
  hasTerminalCompletion: boolean;
  showAmbientActivity: boolean;
  showPlanStrip: boolean;
  showPrimaryRail: boolean;
  showStalledRecovery: boolean;
  rail: TaskRailViewModel;
}

export interface TaskUiStateInput {
  agentStatus: AgentStatus;
  statusDetail: string;
  isAgentRunning: boolean;
  turnProgress: TurnProgress | null;
  sessionMetrics: SessionMetrics | null;
  stagnationState: StagnationState | null;
  taskProgress: TaskProgressMessage["payload"] | null;
  taskCompletion: TaskCompletionMessage["payload"] | null;
  pendingApproval: PendingApproval | null;
  pendingEscalation: PendingEscalation | null;
  pendingPlanConfirmation: PendingPlanConfirmation | null;
  pendingClarification: PendingClarification | null;
  durableRunStatus: DurableRunStatusMessage["payload"] | null;
  latestStepLabel: string | null;
  isPlanning: boolean;
}

function currentSubtaskLabel(
  taskProgress: TaskProgressMessage["payload"] | null,
): string | null {
  if (!taskProgress || taskProgress.subtasks.length === 0) return null;
  const currentIndex = Math.min(
    Math.max(taskProgress.currentIndex, 0),
    taskProgress.subtasks.length - 1,
  );
  return usefulProgressLabel(taskProgress.subtasks[currentIndex]?.description);
}

function fallbackPrimaryLabel(status: AgentStatus, detail: string): string {
  const detailLabel = usefulProgressLabel(detail);
  if (status === AgentStatus.WAITING_FOR_PAGE_LOAD) {
    return "Waiting for page to finish loading";
  }
  if (status === AgentStatus.THINKING) {
    return detailLabel || "Planning next step";
  }
  if (status === AgentStatus.ACTING) {
    return detailLabel || "Taking action on the page";
  }
  if (status === AgentStatus.PAUSED) {
    return "Paused";
  }
  if (status === AgentStatus.ERROR) {
    return detailLabel || "Run failed";
  }
  return detailLabel || "Ready";
}

function resolvePhase(input: TaskUiStateInput): TaskUiPhase {
  if (!input.isAgentRunning && input.taskCompletion) {
    return input.taskCompletion.status;
  }
  if (input.stagnationState) return "stalled";
  if (
    input.pendingApproval ||
    input.pendingEscalation ||
    input.pendingClarification
  ) {
    return "awaiting_user";
  }
  if (input.pendingPlanConfirmation) return "confirming_plan";
  if (input.agentStatus === AgentStatus.PAUSED) return "paused";
  if (input.isPlanning) return "planning";
  if (input.isAgentRunning || input.taskProgress || input.turnProgress) {
    return "running";
  }
  if (input.agentStatus === AgentStatus.ERROR) return "failed";
  if (input.durableRunStatus?.canResume) return "recoverable";
  return "idle";
}

function resolvePrimaryLabel(input: TaskUiStateInput): string {
  if (input.stagnationState) {
    return `The agent may be stuck after ${input.stagnationState.stagnantTurns} turns`;
  }
  if (input.pendingApproval) {
    return "Approval required before continuing";
  }
  if (input.pendingEscalation) {
    return "The agent needs your decision";
  }
  if (input.pendingClarification) {
    return "The agent needs more information";
  }
  if (!input.isAgentRunning && input.taskCompletion) {
    if (input.taskCompletion.status === "completed") return "Task completed";
    if (input.taskCompletion.status === "partial") {
      return "Task partially completed";
    }
    if (input.taskCompletion.status === "stopped") return "Task stopped";
    return "Task failed";
  }
  if (!input.isAgentRunning && input.durableRunStatus?.canResume) {
    return "Recoverable durable run";
  }
  const latestStepLabel = usefulProgressLabel(input.latestStepLabel);
  if (latestStepLabel) return latestStepLabel;
  const subtaskLabel = currentSubtaskLabel(input.taskProgress);
  if (subtaskLabel) return subtaskLabel;
  return fallbackPrimaryLabel(input.agentStatus, input.statusDetail);
}

function resolveSecondaryLabel(input: TaskUiStateInput): string {
  if (input.stagnationState) return "Intervention recommended";
  if (input.pendingApproval) return "Review the proposed action below";
  if (input.pendingEscalation) return "Choose how the agent should proceed";
  if (input.pendingClarification)
    return "Answer the question below to continue";
  if (input.taskProgress) {
    return `Step ${input.taskProgress.currentIndex + 1} of ${
      input.taskProgress.subtasks.length
    }`;
  }
  if (!input.isAgentRunning && input.taskCompletion) {
    return `${input.taskCompletion.totalTurnsUsed} turns used`;
  }
  if (!input.isAgentRunning && input.durableRunStatus?.canResume) {
    return input.durableRunStatus.query;
  }
  if (input.agentStatus === AgentStatus.PAUSED) return "Run is paused";
  if (input.agentStatus === AgentStatus.WAITING_FOR_PAGE_LOAD) {
    return "Waiting for the page to settle before continuing";
  }
  return usefulProgressLabel(input.statusDetail) ?? "";
}

function resolveRailTone(input: TaskUiStateInput): TaskRailTone {
  if (input.stagnationState) return "stalled";
  if (input.taskCompletion?.status === "completed") return "completed";
  if (input.taskCompletion?.status === "stopped") return "stopped";
  if (
    input.taskCompletion?.status === "failed" ||
    input.agentStatus === AgentStatus.ERROR
  ) {
    return "failed";
  }
  if (input.agentStatus === AgentStatus.PAUSED) return "paused";
  if (input.isAgentRunning) return "running";
  return "idle";
}

function canPauseAgent(status: AgentStatus): boolean {
  return (
    status === AgentStatus.THINKING ||
    status === AgentStatus.ACTING ||
    status === AgentStatus.WAITING_FOR_PAGE_LOAD
  );
}

export function deriveTaskUiState(input: TaskUiStateInput): TaskUiState {
  const hasTerminalCompletion = !input.isAgentRunning && !!input.taskCompletion;
  const showPrimaryRail =
    !hasTerminalCompletion &&
    (input.isAgentRunning ||
      input.agentStatus !== AgentStatus.IDLE ||
      !!input.durableRunStatus ||
      !!input.stagnationState ||
      !!input.pendingApproval ||
      !!input.pendingEscalation ||
      !!input.pendingClarification ||
      !!input.taskProgress ||
      !!input.turnProgress);

  return {
    phase: resolvePhase(input),
    hasTerminalCompletion,
    showAmbientActivity: input.isAgentRunning,
    showPlanStrip: Boolean(
      input.pendingPlanConfirmation || input.taskProgress || input.isPlanning,
    ),
    showPrimaryRail,
    showStalledRecovery: Boolean(input.stagnationState),
    rail: {
      eyebrow: input.isAgentRunning ? "Now doing" : "Latest run",
      primaryLabel: resolvePrimaryLabel(input),
      secondaryLabel: resolveSecondaryLabel(input),
      tone: resolveRailTone(input),
      showSpinner:
        input.isAgentRunning &&
        input.agentStatus !== AgentStatus.PAUSED &&
        !input.stagnationState,
      canPause: canPauseAgent(input.agentStatus),
      showResume: input.agentStatus === AgentStatus.PAUSED,
      showStop: input.isAgentRunning,
      stopRequested: Boolean(input.durableRunStatus?.stopRequestedAt),
      turnProgress: input.turnProgress,
      sessionMetrics: input.sessionMetrics,
    },
  };
}

export function useTaskUiState(): TaskUiState {
  const agentStatus = useStore((s) => s.agentStatus);
  const statusDetail = useStore((s) => s.statusDetail);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const turnProgress = useStore((s) => s.turnProgress);
  const sessionMetrics = useStore((s) => s.sessionMetrics);
  const stagnationState = useStore((s) => s.stagnationState);
  const taskProgress = useStore((s) => s.taskProgress);
  const taskCompletion = useStore((s) => s.taskCompletion);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const pendingEscalation = useStore((s) => s.pendingEscalation);
  const pendingPlanConfirmation = useStore((s) => s.pendingPlanConfirmation);
  const pendingClarification = useStore((s) => s.pendingClarification);
  const durableRunStatus = useStore((s) => s.durableRunStatus);
  const latestStepLabel = useStore((s) => s.latestStepLabel);
  const isPlanning = useStore((s) => s.isPlanning);

  return useMemo(
    () =>
      deriveTaskUiState({
        agentStatus,
        statusDetail,
        isAgentRunning,
        turnProgress,
        sessionMetrics,
        stagnationState,
        taskProgress,
        taskCompletion,
        pendingApproval,
        pendingEscalation,
        pendingPlanConfirmation,
        pendingClarification,
        durableRunStatus,
        latestStepLabel,
        isPlanning,
      }),
    [
      agentStatus,
      statusDetail,
      isAgentRunning,
      turnProgress,
      sessionMetrics,
      stagnationState,
      taskProgress,
      taskCompletion,
      pendingApproval,
      pendingEscalation,
      pendingPlanConfirmation,
      pendingClarification,
      durableRunStatus,
      latestStepLabel,
      isPlanning,
    ],
  );
}
