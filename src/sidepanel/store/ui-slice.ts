import { AgentStatus } from "../../types";
import { logger } from "../../utils";
import { flushPersist } from "./chat-slice";
import type { UiSlice, SliceCreator } from "./types";

export const createUiSlice: SliceCreator<UiSlice> = (set, get) => ({
  ready: false,
  error: null,
  errorPersistent: false,
  activeWorkspaceId: null,
  demoRecording: false,
  demoActionCount: 0,
  manualRecording: null,

  setReady: () =>
    set((state) => {
      state.ready = true;
    }),

  setError: (error, options) =>
    set((state) => {
      state.error = error;
      state.errorPersistent = error != null && (options?.persistent ?? false);
      if (error) logger.error("ui", error);
    }),

  setActiveWorkspaceId: (id) => {
    const currentId = get().activeWorkspaceId;
    if (currentId === id) return;
    // Flush pending messages for CURRENT workspace before switching
    flushPersist(get().messages, currentId);
    set((state) => {
      state.activeWorkspaceId = id;
      // Cross-slice: clear chat messages and agent transient state
      state.messages = [];
      state.taskProgress = null;
      state.taskCompletion = null;
      state.stagnationState = null;
      state.turnProgress = null;
      state.pendingApproval = null;
      state.pendingEscalation = null;
      state.pendingPlanConfirmation = null;
      state.pendingClarification = null;
      state.taskRecovery = null;
      state.laneTelemetry = null;
      // Reset agent running state — WORKSPACE_SYNC from background will
      // re-set the correct state if an agent is running in the new workspace
      state.isAgentRunning = false;
      state.agentStatus = AgentStatus.IDLE;
      state.statusDetail = "";
      state.sessionMetrics = null;
    });
    // Load messages only for real workspace IDs.
    if (id != null) {
      get().loadMessagesFromStorage();
    }
  },

  setDemoRecording: (active, actionCount) =>
    set((state) => {
      state.demoRecording = active;
      if (actionCount !== undefined) state.demoActionCount = actionCount;
    }),

  setManualRecording: (r) =>
    set((state) => {
      state.manualRecording = r;
    }),
});
