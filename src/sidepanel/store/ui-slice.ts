import { logger } from "../../utils";
import { flushPersist } from "./chat-slice";
import type { UiSlice, SliceCreator } from "./types";

export const createUiSlice: SliceCreator<UiSlice> = (set, get) => ({
  ready: false,
  showPlanBoard: false,
  error: null,
  activeWorkspaceId: null,
  demoRecording: false,
  demoActionCount: 0,
  manualRecording: null,

  setReady: () =>
    set((state) => {
      state.ready = true;
    }),

  togglePlanBoard: () =>
    set((state) => {
      state.showPlanBoard = !state.showPlanBoard;
    }),

  setError: (error) =>
    set((state) => {
      state.error = error;
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
