import { AgentStatus } from "../../types";
import type { AgentSlice, SliceCreator } from "./types";

export const createAgentSlice: SliceCreator<AgentSlice> = (set) => ({
  agentStatus: AgentStatus.IDLE,
  statusDetail: "Ready",
  isAgentRunning: false,
  turnProgress: null,
  stuckState: null,
  taskProgress: null,
  taskCompletion: null,
  taskRecovery: null,
  pendingApproval: null,
  pendingEscalation: null,
  sessionMetrics: null,
  laneTelemetry: null,

  updateStatus: (status, detail) =>
    set((state) => {
      state.agentStatus = status;
      state.statusDetail = detail;
    }),

  setAgentRunning: (isRunning) =>
    set((state) => {
      state.isAgentRunning = isRunning;
    }),

  setTaskProgress: (payload) =>
    set((state) => {
      state.taskProgress = payload;
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
    }),

  setStuckState: (stuckState) =>
    set((state) => {
      state.stuckState = stuckState;
    }),

  clearStuckState: () =>
    set((state) => {
      state.stuckState = null;
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

  setTaskRecovery: (recovery) =>
    set((state) => {
      state.taskRecovery = recovery;
    }),

  clearTaskRecovery: () =>
    set((state) => {
      state.taskRecovery = null;
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
});
