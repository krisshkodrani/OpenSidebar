import type { StateCreator } from "zustand";
import type {
  AgentStatus,
  AgentStep,
  ChatEntry,
  Citation,
  LaneTelemetrySnapshot,
  PendingApproval,
  PendingClarification,
  PendingEscalation,
  PendingPlanConfirmation,
  SavedPrompt,
  SessionMetrics,
  StagnationState,
  TaskCompletionMessage,
  TaskProgressMessage,
  TaskRecoveryState,
  TurnProgress,
  UserSettings,
} from "../../types";

// --- Slice Interfaces ---

export interface ChatSlice {
  messages: ChatEntry[];
  inputText: string;
  addMessage: (msg: ChatEntry) => void;
  appendStreamDelta: (delta: string) => void;
  replaceStreamContent: (content: string) => void;
  setStreamThinking: (thinking: string) => void;
  applyStreamChunk: (chunk: {
    delta?: string;
    done?: boolean;
    replaceContent?: string;
    thinking?: string;
    citations?: Citation[];
  }) => void;
  finalizeStream: (citations?: Citation[]) => void;
  addStep: (step: AgentStep) => void;
  updateStep: (step: AgentStep) => void;
  setInputText: (text: string) => void;
  clearHistory: () => void;
  loadMessagesFromStorage: () => Promise<void>;
}

export interface AgentSlice {
  agentStatus: AgentStatus;
  statusDetail: string;
  isAgentRunning: boolean;
  turnProgress: TurnProgress | null;
  stagnationState: StagnationState | null;
  taskProgress: TaskProgressMessage["payload"] | null;
  taskCompletion: TaskCompletionMessage["payload"] | null;
  taskRecovery: TaskRecoveryState | null;
  pendingApproval: PendingApproval | null;
  pendingEscalation: PendingEscalation | null;
  pendingPlanConfirmation: PendingPlanConfirmation | null;
  pendingClarification: PendingClarification | null;
  sessionMetrics: SessionMetrics | null;
  laneTelemetry: LaneTelemetrySnapshot | null;
  updateStatus: (status: AgentStatus, detail: string) => void;
  setAgentRunning: (isRunning: boolean) => void;
  loadAgentStateFromStorage: () => Promise<void>;
  setTaskProgress: (payload: TaskProgressMessage["payload"]) => void;
  setTaskCompletion: (payload: TaskCompletionMessage["payload"]) => void;
  clearTaskProgress: () => void;
  setStagnationState: (state: StagnationState) => void;
  clearStagnationState: () => void;
  setTurnProgress: (progress: TurnProgress) => void;
  clearTurnProgress: () => void;
  setPendingApproval: (approval: PendingApproval) => void;
  clearPendingApproval: () => void;
  setPendingEscalation: (packet: PendingEscalation) => void;
  clearPendingEscalation: () => void;
  setPendingPlanConfirmation: (confirmation: PendingPlanConfirmation) => void;
  clearPendingPlanConfirmation: () => void;
  setPendingClarification: (clarification: PendingClarification) => void;
  clearPendingClarification: () => void;
  setTaskRecovery: (recovery: TaskRecoveryState) => void;
  clearTaskRecovery: () => void;
  setSessionMetrics: (metrics: SessionMetrics) => void;
  clearSessionMetrics: () => void;
  setLaneTelemetry: (telemetry: LaneTelemetrySnapshot | null) => void;
  clearLaneTelemetry: () => void;
}

export interface SettingsSlice {
  settings: UserSettings;
  updateSettings: (settings: Partial<UserSettings>) => void;
  loadSettingsFromStorage: () => Promise<void>;
}

export interface SavedPromptsSlice {
  savedPrompts: SavedPrompt[];
  loadSavedPrompts: () => Promise<void>;
  addSavedPrompt: (
    title: string,
    content: string,
    category: string,
  ) => Promise<void>;
  updateSavedPrompt: (
    id: string,
    updates: Partial<Pick<SavedPrompt, "title" | "content" | "category">>,
  ) => Promise<void>;
  deleteSavedPrompt: (id: string) => Promise<void>;
}

export interface UiSlice {
  ready: boolean;
  error: string | null;
  /** When true, the error banner stays until the user dismisses it manually. */
  errorPersistent: boolean;
  activeWorkspaceId: string | null;
  demoRecording: boolean;
  demoActionCount: number;
  manualRecording: {
    sessionId: string;
    turnCount: number;
    name: string;
  } | null;
  setReady: () => void;
  setError: (error: string | null, options?: { persistent?: boolean }) => void;
  setActiveWorkspaceId: (id: string | null) => void;
  setDemoRecording: (active: boolean, actionCount?: number) => void;
  setManualRecording: (
    r: { sessionId: string; turnCount: number; name: string } | null,
  ) => void;
}

// --- Combined Store ---

export type Store = ChatSlice &
  AgentSlice &
  SettingsSlice &
  SavedPromptsSlice &
  UiSlice;

/** Utility type for creating a slice with immer middleware */
export type SliceCreator<T> = StateCreator<
  Store,
  [["zustand/immer", never]],
  [],
  T
>;
