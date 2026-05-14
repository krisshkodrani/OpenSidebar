import {
  AgentStatus,
  type ChatEntry,
  type Citation,
  type TaskCompletionMessage,
} from "../../types";
import { logger } from "../../utils";
import { uiRuntime } from "../runtime";
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
const MIN_FULL_SUMMARY_DELTA = 24;

const TERMINAL_PUNCTUATION_RE = /[.!?)\]}>"']$/;
const TRAILING_FRAGMENT_RE =
  /\b(?:and|or|the|a|an|of|for|to|with|without|in|on|at|by|from|as|into|through|including|such as|top|key|main)\s*$/i;

function chatStorageKey(wsId: string | null): string {
  return `chatMessages:${wsId}`;
}

function agentStateKey(wsId: string): string {
  return `agentState:${wsId}`;
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
    uiRuntime.storage.local.set({ [key]: toSave }).catch(() => {});
  }, 300);
}

function persistCompletedAgentState(wsId: string | null) {
  if (wsId == null) return;
  uiRuntime.storage.local
    .set({
      [agentStateKey(wsId)]: {
        isRunning: false,
        status: AgentStatus.IDLE,
        detail: "Task complete",
      },
    })
    .catch(() => {});
}

function sameTaskCompletion(
  a: TaskCompletionMessage["payload"] | undefined,
  b: TaskCompletionMessage["payload"],
): boolean {
  if (!a) return false;
  if (a.taskId && b.taskId) return a.taskId === b.taskId;
  return (
    a.status === b.status &&
    a.totalTurnsUsed === b.totalTurnsUsed &&
    a.summary === b.summary
  );
}

function normalizeSummaryForComparison(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksIncompleteSummary(summary: string): boolean {
  const text = summary.trim();
  if (text.length < 160) return false;

  const lastLine = text.split("\n").at(-1)?.trim() ?? text;
  return (
    !TERMINAL_PUNCTUATION_RE.test(text) ||
    /[:;,/-]\s*$/.test(lastLine) ||
    TRAILING_FRAGMENT_RE.test(lastLine)
  );
}

function shouldPreferVisibleCompletionContent(
  visibleContent: string,
  payloadSummary: string,
): boolean {
  const visible = visibleContent.trim();
  const summary = payloadSummary.trim();
  if (!visible) return false;
  if (!summary) return true;
  if (visible.length > summary.length && looksIncompleteSummary(summary)) {
    return true;
  }
  if (visible.length <= summary.length + MIN_FULL_SUMMARY_DELTA) return false;

  const normalizedVisible = normalizeSummaryForComparison(visible);
  const normalizedSummary = normalizeSummaryForComparison(summary);
  if (
    normalizedVisible.length <=
    normalizedSummary.length + MIN_FULL_SUMMARY_DELTA
  ) {
    return false;
  }

  return (
    normalizedVisible.startsWith(normalizedSummary) ||
    looksIncompleteSummary(summary)
  );
}

function mergeCompletionWithVisibleContent(
  message: ChatEntry,
  payload: TaskCompletionMessage["payload"],
): TaskCompletionMessage["payload"] {
  if (message.role !== "assistant") return payload;
  if (!shouldPreferVisibleCompletionContent(message.content, payload.summary)) {
    return payload;
  }
  return { ...payload, summary: message.content.trim() };
}

function isReplayCompletionTailMessage(
  message: ChatEntry,
  payload: TaskCompletionMessage["payload"],
): boolean {
  if (message.role !== "assistant") return false;
  if (sameTaskCompletion(message.completionData, payload)) return true;
  if (message.isStreaming && message.content.trim() === "") return true;
  return message.content.trim() === payload.summary.trim();
}

function dedupeCompletionMessages(messages: ChatEntry[]): ChatEntry[] {
  const seenTaskIds = new Set<string>();
  return messages.filter((message) => {
    const taskId =
      message.role === "assistant" ? message.completionData?.taskId : null;
    if (!taskId) return true;
    if (seenTaskIds.has(taskId)) return false;
    seenTaskIds.add(taskId);
    return true;
  });
}

function applyCompletionToMessages(
  state: { messages: ChatEntry[] },
  payload: TaskCompletionMessage["payload"],
): TaskCompletionMessage["payload"] {
  const existingIndex = state.messages.findIndex(
    (message) =>
      message.role === "assistant" &&
      sameTaskCompletion(message.completionData, payload),
  );
  if (existingIndex !== -1) {
    const existing = state.messages[existingIndex];
    const completionPayload = mergeCompletionWithVisibleContent(
      existing,
      payload,
    );
    existing.completionData = completionPayload;
    existing.isStreaming = false;
    if (!existing.content && completionPayload.summary) {
      existing.content = completionPayload.summary;
    }

    let userMessageSeen = false;
    state.messages = state.messages.filter((message, index) => {
      if (index <= existingIndex) return true;
      if (message.role === "user") {
        userMessageSeen = true;
        return true;
      }
      if (userMessageSeen) return true;
      return (
        !isReplayCompletionTailMessage(message, payload) &&
        !isReplayCompletionTailMessage(message, completionPayload)
      );
    });
    return completionPayload;
  }

  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i];
    if (message.role !== "assistant") continue;
    const completionPayload = mergeCompletionWithVisibleContent(
      message,
      payload,
    );
    message.completionData = completionPayload;
    message.isStreaming = false;
    if (!message.content && completionPayload.summary) {
      message.content = completionPayload.summary;
    }
    return completionPayload;
  }

  state.messages.push({
    id: crypto.randomUUID(),
    role: "assistant",
    content: payload.summary,
    timestamp: Date.now(),
    toolCalls: [],
    isStreaming: false,
    completionData: payload,
  });
  return payload;
}

function normalizeLoadedMessage(message: ChatEntry): ChatEntry {
  const finalized = message.isStreaming
    ? { ...message, isStreaming: false }
    : message;
  if (finalized.role !== "assistant" || !finalized.completionData) {
    return finalized;
  }

  const completionData = mergeCompletionWithVisibleContent(
    finalized,
    finalized.completionData,
  );
  return {
    ...finalized,
    content: finalized.content || completionData.summary,
    completionData,
  };
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
  uiRuntime.storage.local.set({ [key]: toSave }).catch(() => {});
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
          // after stream was already finalized) - create one so it's visible.
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

  setCompletionOnLastMessage: (payload) => {
    set((state) => {
      applyCompletionToMessages(state, payload);
    });
    persistMessages(get().messages, get().activeWorkspaceId);
  },

  applyTaskCompletion: (payload) => {
    set((state) => {
      const completionPayload = applyCompletionToMessages(state, payload);
      state.taskCompletion = completionPayload;
      state.taskProgress = null;
      state.isPlanning = false;
      state.isAgentRunning = false;
      state.stagnationState = null;
      state.turnProgress = null;
      state.pendingApproval = null;
      state.pendingEscalation = null;
      state.pendingPlanConfirmation = null;
      state.pendingClarification = null;
      state.taskRecovery = null;
      state.laneTelemetry = null;
      state.latestStepLabel = null;
    });
    persistMessages(get().messages, get().activeWorkspaceId);
    persistCompletedAgentState(get().activeWorkspaceId);
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
      // Don't create ghost bubbles for late-arriving or replayed steps after
      // stream finalization/completion.
      if (!get().isAgentRunning || get().taskCompletion) return;
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
        uiRuntime.storage.local.set({ [key]: [] }).catch(() => {});
        uiRuntime
          .sendMessage({
            type: "DATA_CONTROL_REQUEST",
            requestId: crypto.randomUUID(),
            source: "sidepanel",
            workspaceId: wsId,
            payload: { action: "clear_workspace_chat_history" as const },
          })
          .catch(() => {});
      }
    }),

  loadMessagesFromStorage: async () => {
    try {
      const wsId = get().activeWorkspaceId;
      if (wsId == null) return;
      const key = chatStorageKey(wsId);
      const result = await uiRuntime.storage.local.get(key);
      if (result[key] && Array.isArray(result[key]) && result[key].length > 0) {
        const stored = dedupeCompletionMessages(
          (result[key] as ChatEntry[]).map(normalizeLoadedMessage),
        );
        const current = get().messages;
        // Non-destructive merge: if in-memory messages exist and are newer
        // (by last message timestamp), skip storage load to avoid clobbering
        // live data. Otherwise load from storage (panel was rebuilt or stale).
        if (current.length > 0) {
          const lastCurrent = current[current.length - 1].timestamp;
          const lastStored = stored[stored.length - 1].timestamp;
          if (lastCurrent >= lastStored) {
            logger.debug(
              "ui",
              "Skipping storage load - in-memory messages are newer",
              {
                inMemoryCount: current.length,
                storedCount: stored.length,
              },
            );
            return;
          }
        }
        set((state) => {
          state.messages = stored;
          const latestCompletion = [...stored]
            .reverse()
            .find((message) => message.role === "assistant")?.completionData;
          if (latestCompletion) {
            state.taskCompletion = latestCompletion;
            state.taskProgress = null;
            state.isPlanning = false;
            state.isAgentRunning = false;
            state.agentStatus = AgentStatus.IDLE;
            state.statusDetail = "Task complete";
            state.stagnationState = null;
            state.turnProgress = null;
          }
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
