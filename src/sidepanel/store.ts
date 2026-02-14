import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  AgentStatus,
  AgentStep,
  ChatEntry,
  SessionMetrics,
  SidePanelState,
  StuckState,
  TaskCompletionMessage,
  TaskProgressMessage,
  TurnProgress,
  UserSettings,
} from "../types";
import { logger } from "../utils";

interface Actions {
  addMessage: (msg: ChatEntry) => void;
  appendStreamDelta: (delta: string) => void;
  finalizeStream: () => void;
  addStep: (step: AgentStep) => void;
  updateStep: (step: AgentStep) => void;
  updateStatus: (status: AgentStatus, detail: string) => void;
  setInputText: (text: string) => void;
  setAgentRunning: (isRunning: boolean) => void;
  setError: (error: string | null) => void;
  clearHistory: () => void;
  updateSettings: (settings: Partial<UserSettings>) => void;
  loadSettingsFromStorage: () => Promise<void>;
  loadMessagesFromStorage: () => Promise<void>;
  // Agent feedback actions
  setTaskProgress: (payload: TaskProgressMessage["payload"]) => void;
  setTaskCompletion: (payload: TaskCompletionMessage["payload"]) => void;
  clearTaskProgress: () => void;
  setStuckState: (state: StuckState) => void;
  clearStuckState: () => void;
  setTurnProgress: (progress: TurnProgress) => void;
  clearTurnProgress: () => void;
  setAwaitingPlanApproval: (awaiting: boolean) => void;
  setSessionMetrics: (metrics: SessionMetrics) => void;
  clearSessionMetrics: () => void;
  setReady: () => void;
  // Workspace awareness
  setActiveWorkspaceId: (id: string | null) => void;
}

type Store = SidePanelState & Actions;

const DEFAULT_SETTINGS: UserSettings = {
  openRouterApiKey: __OPENROUTER_API_KEY__,
  groqApiKey: __GROQ_API_KEY__,
  cerebrasApiKey: __CEREBRAS_API_KEY__,
  useGroqFast: false,
  maxTurns: 30,
  contextWindowSize: 128000,
  memoryEnabled: true,
  workspaceEnabled: true,
  theme: "system",
  showElementTags: false,
  visionModel: "qwen/qwen3-vl-235b-a22b-instruct",
  confirmPlan: false,
  showSessionMetrics: false,
  disableScreenshot: false,
  disableNavigation: false,
  speechProvider: "browser",
};

let persistTimeout: ReturnType<typeof setTimeout> | null = null;

/** Get the storage key scoped by workspace */
function chatStorageKey(wsId: string | null): string {
  return wsId ? `chatMessages:${wsId}` : "chatMessages";
}

function persistMessages(messages: ChatEntry[], wsId: string | null = null) {
  if (persistTimeout) clearTimeout(persistTimeout);
  const key = chatStorageKey(wsId);
  persistTimeout = setTimeout(() => {
    chrome.storage.session.set({ [key]: messages }).catch(() => {});
  }, 300);
}

export const useStore = create<Store>()(
  immer((set, get) => ({
    // Initial State
    ready: false,
    activeWorkspaceId: null,
    messages: [],
    agentStatus: AgentStatus.IDLE,
    statusDetail: "Ready",
    inputText: "",
    isAgentRunning: false,
    settings: DEFAULT_SETTINGS,
    error: null,
    taskProgress: null,
    taskCompletion: null,
    stuckState: null,
    turnProgress: null,
    awaitingPlanApproval: false,
    sessionMetrics: null,

    // Actions
    addMessage: (msg) =>
      set((state) => {
        state.messages.push(msg);
        logger.debug("ui", "Message added to store", {
          id: msg.id,
          role: msg.role,
        });
        persistMessages(get().messages, get().activeWorkspaceId);
      }),

    appendStreamDelta: (delta) =>
      set((state) => {
        const last = state.messages[state.messages.length - 1];
        if (last?.role === "assistant" && last.isStreaming) {
          last.content += delta;
        } else {
          state.messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: delta,
            timestamp: Date.now(),
            toolCalls: [],
            isStreaming: true,
          });
        }
        persistMessages(get().messages, get().activeWorkspaceId);
      }),

    finalizeStream: () =>
      set((state) => {
        const last = state.messages[state.messages.length - 1];
        if (last?.role === "assistant" && last.isStreaming) {
          last.isStreaming = false;
        }
        persistMessages(get().messages, get().activeWorkspaceId);
      }),

    addStep: (step) =>
      set((state) => {
        // Find the last assistant message to attach the step to
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === "assistant") {
            if (!state.messages[i].steps) {
              state.messages[i].steps = [];
            }
            state.messages[i].steps!.push(step);
            break;
          }
        }
        persistMessages(get().messages, get().activeWorkspaceId);
      }),

    updateStep: (step) =>
      set((state) => {
        // Find the last assistant message and replace the step by ID
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const msg = state.messages[i];
          if (msg.role === "assistant" && msg.steps) {
            const idx = msg.steps.findIndex((s) => s.id === step.id);
            if (idx !== -1) {
              msg.steps[idx] = step;
              break;
            }
          }
        }
        persistMessages(get().messages, get().activeWorkspaceId);
      }),

    updateStatus: (status, detail) =>
      set((state) => {
        state.agentStatus = status;
        state.statusDetail = detail;
      }),

    setInputText: (text) =>
      set((state) => {
        state.inputText = text;
      }),

    setAgentRunning: (isRunning) =>
      set((state) => {
        state.isAgentRunning = isRunning;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
        if (error) logger.error("ui", error);
      }),

    clearHistory: () =>
      set((state) => {
        state.messages = [];
        logger.info("ui", "Chat history cleared");
        const key = chatStorageKey(get().activeWorkspaceId);
        chrome.storage.session.set({ [key]: [] }).catch(() => {});
      }),

    updateSettings: (updates) =>
      set((state) => {
        Object.assign(state.settings, updates);
      }),

    loadSettingsFromStorage: async () => {
      try {
        const result = await chrome.storage.sync.get("userSettings");
        if (result.userSettings) {
          set((state) => {
            state.settings = { ...DEFAULT_SETTINGS, ...result.userSettings };
          });
          logger.debug("ui", "Settings loaded from storage");
        }
      } catch (e) {
        logger.warn("ui", "Failed to load settings from storage", { error: e });
      }
    },

    loadMessagesFromStorage: async () => {
      try {
        const key = chatStorageKey(get().activeWorkspaceId);
        const result = await chrome.storage.session.get(key);
        if (result[key] && Array.isArray(result[key]) && result[key].length > 0) {
          const messages = (result[key] as ChatEntry[]).map((msg) =>
            msg.isStreaming ? { ...msg, isStreaming: false } : msg,
          );
          set((state) => {
            state.messages = messages;
          });
          logger.debug("ui", "Messages restored from storage", {
            count: messages.length,
            storageKey: key,
          });
        }
      } catch (e) {
        logger.warn("ui", "Failed to load messages from storage", { error: e });
      }
    },

    setReady: () =>
      set((state) => {
        state.ready = true;
      }),

    // --- Agent feedback actions ---

    setTaskProgress: (payload) =>
      set((state) => {
        state.taskProgress = payload;
      }),

    setTaskCompletion: (payload) =>
      set((state) => {
        state.taskCompletion = payload;
        state.taskProgress = null; // Clear live progress when task completes
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

    setAwaitingPlanApproval: (awaiting) =>
      set((state) => {
        state.awaitingPlanApproval = awaiting;
      }),

    setSessionMetrics: (metrics) =>
      set((state) => {
        state.sessionMetrics = metrics;
      }),

    clearSessionMetrics: () =>
      set((state) => {
        state.sessionMetrics = null;
      }),

    // Workspace awareness
    setActiveWorkspaceId: (id) => {
      const currentId = get().activeWorkspaceId;
      if (currentId === id) return;
      set((state) => {
        state.activeWorkspaceId = id;
        state.messages = []; // Clear current messages when switching workspace
      });
      // Load messages for the new workspace
      get().loadMessagesFromStorage();
    },
  })),
);
