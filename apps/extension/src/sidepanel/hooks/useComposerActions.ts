import { useCallback } from "react";
import { AgentStatus, type ChatEntry } from "../../types";
import { logger } from "../../utils";
import {
  formatMissingProviderKeys,
  getProviderKeyStatus,
} from "../../utils/provider-keys";
import { getE2EPanelConfig, uiRuntime } from "../runtime";
import { useStore } from "../store";

function isNewChatCommand(text: string): boolean {
  return text.trim() === "/new";
}

export function isExplicitStopCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "").trim();
  return /^(?:please\s+)?(?:stop|cancel|abort)(?:\s+(?:this|the|current))?(?:\s+(?:task|run|work))?(?:\s+now)?$/.test(
    normalized,
  ) || /^(?:please\s+)?(?:do not|don't|dont)\s+continue$/.test(normalized);
}

function hasActiveRunOrWatch(store: ReturnType<typeof useStore.getState>): boolean {
  return (
    store.isAgentRunning ||
    store.passiveStatus === "watching" ||
    store.passiveStatus === "paused" ||
    store.pendingApproval != null ||
    store.pendingEscalation != null ||
    store.pendingPlanConfirmation != null ||
    store.pendingClarification != null
  );
}

export function useComposerActions(options: { onSendStarted: () => void }): {
  handleSend: (text: string) => Promise<void>;
  handleSendFeedback: (text: string) => Promise<void>;
  handleStop: () => Promise<void>;
} {
  const { onSendStarted } = options;
  const addMessage = useStore((s) => s.addMessage);
  const setInputText = useStore((s) => s.setInputText);
  const setAgentRunning = useStore((s) => s.setAgentRunning);
  const updateStatus = useStore((s) => s.updateStatus);
  const setError = useStore((s) => s.setError);
  const startNewChat = useStore((s) => s.startNewChat);

  const handleSend = useCallback(
    async (text: string) => {
      const store = useStore.getState();
      const trimmedText = text.trim();
      if (!trimmedText) return;

      if (isNewChatCommand(trimmedText)) {
        if (hasActiveRunOrWatch(store)) {
          setError("Stop the active run or watch mode before starting a new chat.");
          setInputText("");
          return;
        }
        startNewChat();
        return;
      }

      if (store.isAgentRunning) return;

      const isE2EPanel = getE2EPanelConfig() != null;
      const providerKeyStatus = getProviderKeyStatus(store.settings);
      // E2E overlays intentionally do not receive local credential keys.
      // The background runtime remains the source of truth for provider access.
      if (!isE2EPanel && !providerKeyStatus.hasRequiredKeys) {
        const missingKeys = formatMissingProviderKeys(providerKeyStatus);
        const keyNoun =
          providerKeyStatus.missingKeyNames.length === 1
            ? "API key"
            : "API keys";
        setError(
          `Please add your ${missingKeys} ${keyNoun} in Settings to get started.`,
          { persistent: true },
        );
        return;
      }

      const userEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmedText,
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: false,
      };

      addMessage(userEntry);
      onSendStarted();
      setAgentRunning(true);
      updateStatus(AgentStatus.THINKING, "Sending request...");

      let activeTabId = 0;
      try {
        const tab = await uiRuntime.getActiveTab();
        if (tab?.id) activeTabId = tab.id;
      } catch (error) {
        logger.warn("ui", "Failed to get active tab", { error });
      }

      try {
        const requestId = crypto.randomUUID();
        await uiRuntime.sendMessage({
          type: "USER_CHAT",
          requestId,
          source: uiRuntime.source,
          payload: {
            text: trimmedText,
            tabId: activeTabId,
            workspaceId: useStore.getState().activeWorkspaceId,
            messageId: userEntry.id,
            timestamp: userEntry.timestamp,
          },
        });
        setInputText("");
      } catch (error) {
        logger.error("ui", "Failed to send message", { error });
        setError("Failed to communicate with the agent.");
        setInputText(trimmedText);
        setAgentRunning(false);
        updateStatus(AgentStatus.ERROR, "Connection failed");
      }
    },
    [
      addMessage,
      onSendStarted,
      setAgentRunning,
      setError,
      setInputText,
      startNewChat,
      updateStatus,
    ],
  );

  const stopActiveRun = useCallback(async () => {
    await uiRuntime.sendMessage({
      type: "STOP_AGENT",
      requestId: crypto.randomUUID(),
      source: uiRuntime.source,
      payload: {
        workspaceId: useStore.getState().activeWorkspaceId,
      },
    });
    setAgentRunning(false);
    updateStatus(AgentStatus.IDLE, "Stopped by user");
  }, [setAgentRunning, updateStatus]);

  const handleSendFeedback = useCallback(
    async (text: string) => {
      const store = useStore.getState();
      const trimmedText = text.trim();
      if (!trimmedText) return;

      if (isNewChatCommand(trimmedText)) {
        if (hasActiveRunOrWatch(store)) {
          setError("Stop the active run or watch mode before starting a new chat.");
          setInputText("");
          return;
        }
        startNewChat();
        return;
      }

      if (isExplicitStopCommand(trimmedText)) {
        try {
          await stopActiveRun();
          setInputText("");
        } catch (error) {
          logger.error("ui", "Failed to stop agent", { error });
          setError("Failed to stop the current task.");
        }
        return;
      }

      const userEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmedText,
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: false,
        isFeedback: true,
      };
      addMessage(userEntry);

      try {
        const requestId = crypto.randomUUID();
        await uiRuntime.sendMessage({
          type: "USER_CHAT",
          requestId,
          source: uiRuntime.source,
          payload: {
            text: trimmedText,
            tabId: 0,
            workspaceId: useStore.getState().activeWorkspaceId,
            messageId: userEntry.id,
            timestamp: userEntry.timestamp,
            isFeedback: true,
          },
        });
        setInputText("");
      } catch (error) {
        logger.error("ui", "Failed to send feedback", { error });
        setError("Failed to send feedback to agent.");
        setInputText(trimmedText);
      }
    },
    [addMessage, setError, setInputText, startNewChat, stopActiveRun],
  );

  const handleStop = useCallback(async () => {
    try {
      await stopActiveRun();
    } catch (error) {
      logger.error("ui", "Failed to stop agent", { error });
      setError("Failed to stop the current task.");
    }
  }, [setError, stopActiveRun]);

  return { handleSend, handleSendFeedback, handleStop };
}
