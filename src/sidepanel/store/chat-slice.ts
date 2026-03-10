import type { ChatEntry, Citation } from "../../types";
import { logger } from "../../utils";
import type { ChatSlice, SliceCreator } from "./types";

/** Strip screenshotUrl from steps before persisting (each is ~100KB base64). */
function stripScreenshots(messages: ChatEntry[]): ChatEntry[] {
  return messages.map((msg) => {
    if (!msg.steps?.some((s) => s.screenshotUrl)) return msg;
    return {
      ...msg,
      steps: msg.steps.map(({ screenshotUrl: _, ...rest }) => rest),
    };
  });
}

let persistTimeout: ReturnType<typeof setTimeout> | null = null;

/** Max messages to persist per workspace (prevents storage bloat) */
const MAX_PERSISTED_MESSAGES = 200;

function chatStorageKey(wsId: string | null): string {
  return `chatMessages:${wsId}`;
}

function persistMessages(messages: ChatEntry[], wsId: string | null = null) {
  if (wsId == null) return;
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
  if (wsId == null) return;
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

  addMessage: (msg) => {
    set((state) => {
      state.messages.push(msg);
      logger.debug("ui", "Message added to store", {
        id: msg.id,
        role: msg.role,
      });
    });
    persistMessages(get().messages, get().activeWorkspaceId);
  },

  appendStreamDelta: (delta) => {
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
    });
    persistMessages(get().messages, get().activeWorkspaceId);
  },

  replaceStreamContent: (content) => {
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (last?.role === "assistant" && last.isStreaming) {
        last.content = content;
      }
    });
    persistMessages(get().messages, get().activeWorkspaceId);
  },

  setStreamThinking: (thinking) =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (last?.role === "assistant") {
        last.thinking = thinking;
      }
    }),

  /**
   * Apply all STREAM_CHUNK fields in a single Zustand transaction to avoid
   * multiple re-renders per message (replaceContent + thinking + done/delta
   * used to trigger 2-3 separate set() calls).
   */
  applyStreamChunk: (chunk: {
    delta?: string;
    done?: boolean;
    replaceContent?: string;
    thinking?: string;
    citations?: Citation[];
  }) => {
    set((state) => {
      let last = state.messages[state.messages.length - 1];
      let isStreaming = last?.role === "assistant" && last.isStreaming;

      // Replace content (must come before delta append)
      if (chunk.replaceContent !== undefined) {
        if (isStreaming) {
          last.content = chunk.replaceContent;
        } else {
          // No streaming message exists (e.g. task completion summary arriving
          // after stream was already finalized) — create one so it's visible.
          state.messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: chunk.replaceContent,
            timestamp: Date.now(),
            toolCalls: [],
            isStreaming: true,
          });
          // Re-derive so subsequent done/thinking blocks see the new message
          last = state.messages[state.messages.length - 1];
          isStreaming = true;
        }
      }

      // Thinking
      if (chunk.thinking && last?.role === "assistant") {
        last.thinking = chunk.thinking;
      }

      // Finalize or append
      if (chunk.done) {
        if (isStreaming) {
          last.isStreaming = false;
          if (chunk.citations && chunk.citations.length > 0) {
            last.citations = chunk.citations;
          }
        }
      } else if (chunk.delta) {
        if (isStreaming) {
          last.content += chunk.delta;
        } else {
          state.messages.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content: chunk.delta,
            timestamp: Date.now(),
            toolCalls: [],
            isStreaming: true,
          });
        }
      }
    });
    if (chunk.done || chunk.replaceContent !== undefined || chunk.delta) {
      persistMessages(get().messages, get().activeWorkspaceId);
    }
  },

  finalizeStream: (citations?: Citation[]) => {
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (last?.role === "assistant" && last.isStreaming) {
        last.isStreaming = false;
        if (citations && citations.length > 0) {
          last.citations = citations;
        }
      }
    });
    persistMessages(get().messages, get().activeWorkspaceId);
  },

  addStep: (step) => {
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
    });
    persistMessages(get().messages, get().activeWorkspaceId);
  },

  updateStep: (step) => {
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
    });
    persistMessages(get().messages, get().activeWorkspaceId);
  },

  setInputText: (text) =>
    set((state) => {
      state.inputText = text;
    }),

  clearHistory: () =>
    set((state) => {
      state.messages = [];
      logger.info("ui", "Chat history cleared");
      const wsId = get().activeWorkspaceId;
      if (wsId != null) {
        const key = chatStorageKey(wsId);
        chrome.storage.local.set({ [key]: [] }).catch(() => {});
      }
    }),

  loadMessagesFromStorage: async () => {
    try {
      const wsId = get().activeWorkspaceId;
      if (wsId == null) return;
      const key = chatStorageKey(wsId);
      const result = await chrome.storage.local.get(key);
      if (result[key] && Array.isArray(result[key]) && result[key].length > 0) {
        const stored = (result[key] as ChatEntry[]).map((msg) =>
          msg.isStreaming ? { ...msg, isStreaming: false } : msg,
        );
        const current = get().messages;
        // Non-destructive merge: if in-memory messages exist and are newer
        // (by last message timestamp), skip storage load to avoid clobbering
        // live data. Otherwise load from storage (panel was rebuilt or stale).
        if (current.length > 0) {
          const lastCurrent = current[current.length - 1].timestamp;
          const lastStored = stored[stored.length - 1].timestamp;
          if (lastCurrent >= lastStored) {
            logger.debug("ui", "Skipping storage load — in-memory messages are newer", {
              inMemoryCount: current.length,
              storedCount: stored.length,
            });
            return;
          }
        }
        set((state) => {
          state.messages = stored;
        });
        logger.debug("ui", "Messages restored from storage", {
          count: stored.length,
          storageKey: key,
        });
      }
    } catch (e) {
      logger.warn("ui", "Failed to load messages from storage", { error: e });
    }
  },
});
