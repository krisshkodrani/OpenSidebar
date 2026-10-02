import type { OrchestratorStartInput, OrchestratorTask } from "./types";
import { MAX_RECENT_COMPLETION_CONTEXT_CHARS } from "./recent-completion-tracker";
import { resolveLaneTopologyFromSettings } from "./lane-topology";
import { createTaskTabCoordination } from "./tab-coordination";
import {
  DEFAULT_MAX_REPLANS,
  DEFAULT_MAX_SESSION_TIME_MS,
  DEFAULT_MAX_TOTAL_COST_USD,
  DEFAULT_MAX_TOTAL_TOKENS,
  emptySessionMetrics,
} from "./sanitizers";
import { clampInteger } from "./utils";
import { DEFAULT_MAX_WORKERS } from "./runtime-policy";
import { sendMessage } from "./task-messaging";

/** Build the initial task state before any workspace or trace writes. */
export function buildNewTask(
  input: OrchestratorStartInput,
  personalContextBrief: string,
  recentCompletionContext: string,
): {
  task: OrchestratorTask;
  plannerQuery: string;
  laneTopology: ReturnType<typeof resolveLaneTopologyFromSettings>;
} {
  const conversationContextBrief = [
    input.conversationContextBrief?.trim() || "",
    recentCompletionContext,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_RECENT_COMPLETION_CONTEXT_CHARS);

  const plannerContextSections = [
    conversationContextBrief
      ? `RECENT WORKSPACE CONVERSATION:\n${conversationContextBrief}`
      : "",
    personalContextBrief,
  ].filter(Boolean);
  const plannerQuery =
    plannerContextSections.length > 0
      ? `${plannerContextSections.join("\n\n")}\n\nCURRENT REQUEST:\n${input.query}`
      : input.query;
  const taskId = crypto.randomUUID();
  const laneTopology = resolveLaneTopologyFromSettings(input.settings);
  const task: OrchestratorTask = {
    runId: input.runId ?? crypto.randomUUID(),
    id: taskId,
    workspaceId: input.workspaceId,
    rootTabId: input.tabId,
    rootTabUrl: null,
    query: input.query,
    turnNumber: 1,
    personalContextBrief: personalContextBrief || undefined,
    conversationContextBrief: conversationContextBrief || undefined,
    status: "planning",
    createdAt: Date.now(),
    nodes: [],
    plannerReflexionLog: [],
    maxWorkers: Math.max(
      1,
      Math.min(8, laneTopology.maxWorkers ?? DEFAULT_MAX_WORKERS),
    ),
    maxReplans: DEFAULT_MAX_REPLANS,
    replansUsed: 0,
    horizonExpansions: 0,
    currentIndex: 0,
    sessionMetrics: emptySessionMetrics(),
    budget: {
      maxSessionTimeMs: DEFAULT_MAX_SESSION_TIME_MS,
      maxTotalTokens: clampInteger(DEFAULT_MAX_TOTAL_TOKENS, 1),
      maxTotalCostUsd: DEFAULT_MAX_TOTAL_COST_USD,
    },
    tabCoordination: createTaskTabCoordination(input.tabId),
    laneTopologyMode: laneTopology.mode,
    enabledSkillPackIds: input.settings.enabledSkillPackIds
      ? [...input.settings.enabledSkillPackIds]
      : undefined,
    interactionDelivery: input.interactionDelivery,
  };
  return { task, plannerQuery, laneTopology };
}

export function emitPlanningSkipped(workspaceId: string): void {
  sendMessage({
    type: "AGENT_STEP",
    workspaceId,
    payload: {
      step: {
        id: crypto.randomUUID(),
        type: "info",
        label: "Planning skipped",
        detail: "Simple lane topology selected a single executor path.",
        status: "done",
        timestamp: Date.now(),
      },
      update: false,
    },
  });
}
