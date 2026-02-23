import type { ChatEntry, Citation } from "../../types";
import { logger } from "../../utils";
import type { ChatSlice, SliceCreator } from "./types";

/** Strip screenshotUrl from steps before persisting (each is ~100KB base64). */
function stripScreenshots(messages: ChatEntry[]): ChatEntry[] {
  return messages.map((msg) => {
    if (!msg.steps?.some((s) => s.screenshotUrl)) return msg;
    return {
      ...msg,
      steps: msg.steps.map(({ screenshotUrl, ...rest }) => rest),
    };
  });
}

let persistTimeout: ReturnType<typeof setTimeout> | null = null;

/** Max messages to persist per workspace (prevents storage bloat) */
const MAX_PERSISTED_MESSAGES = 200;

function chatStorageKey(wsId: string | null): string {
  return wsId ? `chatMessages:${wsId}` : "chatMessages";
}

function persistMessages(messages: ChatEntry[], wsId: string | null = null) {
  if (persistTimeout) clearTimeout(persistTimeout);
  const key = chatStorageKey(wsId);
  persistTimeout = setTimeout(() => {
    // Trim to last N messages to keep storage bounded
    const trimmed =
      messages.length > MAX_PERSISTED_MESSAGES
        ? messages.slice(-MAX_PERSISTED_MESSAGES)
        : messages;
    const toSave = stripScreenshots(trimmed);
    chrome.storage.local.set({ [key]: toSave }).catch(() => {});
  }, 300);
}

/** Flush pending debounced messages to storage immediately. */
export function flushPersist(messages: ChatEntry[], wsId: string | null) {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
    persistTimeout = null;
  }
  if (messages.length === 0) return;
  const key = chatStorageKey(wsId);
  const trimmed =
    messages.length > MAX_PERSISTED_MESSAGES
      ? messages.slice(-MAX_PERSISTED_MESSAGES)
      : messages;
  const toSave = stripScreenshots(trimmed);
  chrome.storage.local.set({ [key]: toSave }).catch(() => {});
}

export const createChatSlice: SliceCreator<ChatSlice> = (set, get) => ({
  messages: [],
  inputText: "",

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

  replaceStreamContent: (content) =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (last?.role === "assistant" && last.isStreaming) {
        last.content = content;
      }
      persistMessages(get().messages, get().activeWorkspaceId);
    }),

  finalizeStream: (citations?: Citation[]) =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (last?.role === "assistant" && last.isStreaming) {
        last.isStreaming = false;
        if (citations && citations.length > 0) {
          last.citations = citations;
        }
      }
      persistMessages(get().messages, get().activeWorkspaceId);
    }),

  addStep: (step) =>
    set((state) => {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (
          state.messages[i].role === "assistant" &&
          state.messages[i].isStreaming
        ) {
          if (!state.messages[i].steps) {
            state.messages[i].steps = [];
          }
          state.messages[i].steps!.push(step);
          persistMessages(get().messages, get().activeWorkspaceId);
          return;
        }
      }
      // Don't create ghost bubbles for late-arriving steps after stream finalized
      if (!get().isAgentRunning) return;
      state.messages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: true,
        steps: [step],
      });
      persistMessages(get().messages, get().activeWorkspaceId);
    }),

  updateStep: (step) =>
    set((state) => {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i];
        if (msg.role === "assistant" && msg.steps) {
          const idx = msg.steps.findIndex((s) => s.id === step.id);
          if (idx !== -1) {
            msg.steps[idx] = { ...msg.steps[idx], ...step };
            break;
          }
        }
      }
      persistMessages(get().messages, get().activeWorkspaceId);
    }),

  setInputText: (text) =>
    set((state) => {
      state.inputText = text;
    }),

  clearHistory: () =>
    set((state) => {
      state.messages = [];
      logger.info("ui", "Chat history cleared");
      const key = chatStorageKey(get().activeWorkspaceId);
      chrome.storage.local.set({ [key]: [] }).catch(() => {});
    }),

  loadMessagesFromStorage: async () => {
    try {
      const key = chatStorageKey(get().activeWorkspaceId);
      const result = await chrome.storage.local.get(key);
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
});
