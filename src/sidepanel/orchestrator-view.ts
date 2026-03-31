import {
  AgentStatus,
  AgentStep,
  ChatEntry,
  SidePanelState,
  SubtaskSummary,
} from "../types";

export type ConsoleRole =
  | "planner"
  | "executor"
  | "verifier"
  | "policy"
  | "idle";

export interface OrchestratorDecision {
  id: string;
  label: string;
  timestamp: number;
  status: AgentStep["status"];
}

const DECISION_MARKERS = [
  "verifier",
  "retry",
  "reroute",
  "drift",
  "budget",
  "approval",
  "blocked",
  "checkpoint",
  "handoff",
];

function latestAssistantMessage(messages: ChatEntry[]): ChatEntry | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i];
  }
  return null;
}

export function getLatestAssistantSteps(messages: ChatEntry[]): AgentStep[] {
  return latestAssistantMessage(messages)?.steps ?? [];
}

export function inferConsoleRole(
  state: Pick<
    SidePanelState,
    | "agentStatus"
    | "statusDetail"
    | "pendingApproval"
    | "pendingPlanConfirmation"
    | "messages"
  >,
): ConsoleRole {
  if (state.pendingApproval || state.pendingPlanConfirmation) return "policy";
  if (state.agentStatus === AgentStatus.ACTING) return "executor";
  if (
    state.agentStatus === AgentStatus.IDLE ||
    state.agentStatus === AgentStatus.ERROR
  ) {
    return "idle";
  }

  const detail = state.statusDetail.toLowerCase();
  if (detail.includes("verif")) return "verifier";

  const latestSteps = getLatestAssistantSteps(state.messages);
  const runningThinking = latestSteps.find(
    (s) => s.type === "thinking" && s.status === "running",
  );
  if (
    runningThinking &&
    runningThinking.label.toLowerCase().includes("verif")
  ) {
    return "verifier";
  }

  return "planner";
}

export function buildDecisionFeed(
  steps: AgentStep[],
  limit = 8,
): OrchestratorDecision[] {
  return [...steps]
    .filter((step) => {
      const label = step.label.toLowerCase();
      return DECISION_MARKERS.some((marker) => label.includes(marker));
    })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((step) => ({
      id: step.id,
      label: step.label,
      timestamp: step.timestamp,
      status: step.status,
    }));
}

export function subtaskHealth(subtasks: SubtaskSummary[]): {
  completed: number;
  running: number;
  blocked: number;
  pending: number;
} {
  let completed = 0;
  let running = 0;
  let blocked = 0;
  let pending = 0;

  for (const subtask of subtasks) {
    if (subtask.status === "completed") completed++;
    else if (subtask.status === "running") running++;
    else if (subtask.status === "failed") blocked++;
    else pending++;
  }

  return { completed, running, blocked, pending };
}
