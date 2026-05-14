import { AgentStatus } from "../../types";
import { logger } from "../../utils";
import { uiRuntime } from "../runtime";
import type { AgentSlice, SliceCreator, Store } from "./types";

// ── Per-workspace agent state persistence ──
// Persists isAgentRunning + agentStatus + statusDetail so the side panel can
// render the correct UI immediately on mount / workspace switch, before
// WORKSPACE_SYNC arrives from the background service worker.

function agentStateKey(wsId: string): string {
  return `agentState:${wsId}`;
}

interface PersistedAgentState {
  isRunning: boolean;
  status: AgentStatus;
  detail: string;
}

/** Write agent state to local UI storage (fire-and-forget). */
function persistAgentState(get: () => Store) {
  const wsId = get().activeWorkspaceId;
  if (wsId == null) return;
  const data: PersistedAgentState = {
    isRunning: get().isAgentRunning,
    status: get().agentStatus,
    detail: get().statusDetail,
  };
  uiRuntime.storage.local.set({ [agentStateKey(wsId)]: data }).catch(() => {});
}

export const createAgentSlice: SliceCreator<AgentSlice> = (set, get) => ({
  agentStatus: AgentStatus.IDLE,
  statusDetail: "Ready",
  isAgentRunning: false,
  turnProgress: null,
  stagnationState: null,
  taskProgress: null,
  taskCompletion: null,
  taskRecovery: null,
  durableRunStatus: null,
  pendingApproval: null,
  pendingEscalation: null,
  pendingPlanConfirmation: null,
  pendingClarification: null,
  sessionMetrics: null,
  laneTelemetry: null,
  latestStepLabel: null,
  isPlanning: false,

  updateStatus: (status, detail) => {
    set((state) => {
      state.agentStatus = status;
      state.statusDetail = detail;
    });
    persistAgentState(get);
  },

  setAgentRunning: (isRunning) => {
    set((state) => {
      state.isAgentRunning = isRunning;
    });
    persistAgentState(get);
  },

  loadAgentStateFromStorage: async () => {
    const wsId = get().activeWorkspaceId;
    if (wsId == null) return;
    try {
      const key = agentStateKey(wsId);
      const result = await uiRuntime.storage.local.get(key);
      const stored = result[key] as PersistedAgentState | undefined;
      if (stored) {
        const hasCompletion =
          get().taskCompletion != null ||
          get().messages.some(
            (message) =>
              message.role === "assistant" && message.completionData != null,
          );
        if (hasCompletion && stored.isRunning) {
          set((state) => {
            state.isAgentRunning = false;
            state.agentStatus = AgentStatus.IDLE;
            state.statusDetail = "Task complete";
            state.isPlanning = false;
            state.taskProgress = null;
            state.turnProgress = null;
          });
          persistAgentState(get);
          logger.debug(
            "ui",
            "Ignored stale running agent state after completion",
            {
              status: stored.status,
            },
          );
          return;
        }
        set((state) => {
          state.isAgentRunning = stored.isRunning;
          state.agentStatus = stored.status;
          state.statusDetail = stored.detail;
        });
        logger.debug("ui", "Agent state restored from storage", {
          isRunning: stored.isRunning,
          status: stored.status,
        });
      }
    } catch (e) {
      logger.warn("ui", "Failed to load agent state from storage", {
        error: e,
      });
    }
  },

  setTaskProgress: (payload) =>
    set((state) => {
      state.taskProgress = payload;
      state.isPlanning = false;
    }),

  setTaskCompletion: (payload) =>
    set((state) => {
      state.taskCompletion = payload;
      state.taskProgress = null;
    }),

  clearTaskProgress: () =>
    set((state) => {
      state.taskProgress = null;
      state.taskCompletion = null;
      state.latestStepLabel = null;
    }),

  setStagnationState: (stagnationState) =>
    set((state) => {
      state.stagnationState = stagnationState;
    }),

  clearStagnationState: () =>
    set((state) => {
      state.stagnationState = null;
    }),

  setTurnProgress: (progress) =>
    set((state) => {
      state.turnProgress = progress;
    }),

  clearTurnProgress: () =>
    set((state) => {
      state.turnProgress = null;
    }),

  setPendingApproval: (approval) =>
    set((state) => {
      state.pendingApproval = approval;
    }),

  clearPendingApproval: () =>
    set((state) => {
      state.pendingApproval = null;
    }),

  setPendingEscalation: (packet) =>
    set((state) => {
      state.pendingEscalation = packet;
    }),

  clearPendingEscalation: () =>
    set((state) => {
      state.pendingEscalation = null;
    }),

  setPendingPlanConfirmation: (confirmation) =>
    set((state) => {
      state.pendingPlanConfirmation = confirmation;
    }),

  clearPendingPlanConfirmation: () =>
    set((state) => {
      state.pendingPlanConfirmation = null;
    }),

  setPendingClarification: (clarification) =>
    set((state) => {
      state.pendingClarification = clarification;
    }),

  clearPendingClarification: () =>
    set((state) => {
      state.pendingClarification = null;
    }),

  setLatestStepLabel: (label) =>
    set((state) => {
      state.latestStepLabel = label;
    }),

  clearLatestStepLabel: () =>
    set((state) => {
      state.latestStepLabel = null;
    }),

  setTaskRecovery: (recovery) =>
    set((state) => {
      state.taskRecovery = recovery;
    }),

  clearTaskRecovery: () =>
    set((state) => {
      state.taskRecovery = null;
    }),

  setDurableRunStatus: (durableRunStatus) =>
    set((state) => {
      state.durableRunStatus = durableRunStatus;
    }),

  clearDurableRunStatus: () =>
    set((state) => {
      state.durableRunStatus = null;
    }),

  setSessionMetrics: (metrics) =>
    set((state) => {
      state.sessionMetrics = metrics;
    }),

  clearSessionMetrics: () =>
    set((state) => {
      state.sessionMetrics = null;
    }),

  setLaneTelemetry: (telemetry) =>
    set((state) => {
      state.laneTelemetry = telemetry;
    }),

  clearLaneTelemetry: () =>
    set((state) => {
      state.laneTelemetry = null;
    }),

  setIsPlanning: (planning) =>
    set((state) => {
      state.isPlanning = planning;
    }),
});
