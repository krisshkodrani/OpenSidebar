import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { AgentStatus, AgentStep, ChatEntry, SidePanelState, UserSettings } from "../types";
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
}

type Store = SidePanelState & Actions;

const DEFAULT_SETTINGS: UserSettings = {
  cerebrasApiKey: __CEREBRAS_API_KEY__,
  openRouterApiKey: __OPENROUTER_API_KEY__,
  maxTurns: 30,
  contextWindowSize: 128000,
  memoryEnabled: true,
  workspaceEnabled: true,
  theme: "system",
  showElementTags: false,
};

let persistTimeout: ReturnType<typeof setTimeout> | null = null;

function persistMessages(messages: ChatEntry[]) {
  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(() => {
    chrome.storage.session.set({ chatMessages: messages }).catch(() => {});
  }, 300);
}

export const useStore = create<Store>()(
  immer((set, get) => ({
    // Initial State
    messages: [],
    agentStatus: AgentStatus.IDLE,
    statusDetail: "Ready",
    inputText: "",
    isAgentRunning: false,
    settings: DEFAULT_SETTINGS,
    error: null,

    // Actions
    addMessage: (msg) =>
      set((state) => {
        state.messages.push(msg);
        logger.debug("ui", "Message added to store", {
          id: msg.id,
          role: msg.role,
        });
        persistMessages(get().messages);
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
        persistMessages(get().messages);
      }),

    finalizeStream: () =>
      set((state) => {
        const last = state.messages[state.messages.length - 1];
        if (last?.role === "assistant" && last.isStreaming) {
          last.isStreaming = false;
        }
        persistMessages(get().messages);
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
        persistMessages(get().messages);
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
        persistMessages(get().messages);
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
        chrome.storage.session.set({ chatMessages: [] }).catch(() => {});
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
        const result = await chrome.storage.session.get("chatMessages");
        if (result.chatMessages && Array.isArray(result.chatMessages) && result.chatMessages.length > 0) {
          const messages = (result.chatMessages as ChatEntry[]).map((msg) =>
            msg.isStreaming ? { ...msg, isStreaming: false } : msg,
          );
          set((state) => {
            state.messages = messages;
          });
          logger.debug("ui", "Messages restored from storage", {
            count: messages.length,
          });
        }
      } catch (e) {
        logger.warn("ui", "Failed to load messages from storage", { error: e });
      }
    },
  })),
);
