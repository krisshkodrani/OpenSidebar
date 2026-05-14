import { useCallback } from "react";
import { AgentStatus, type ChatEntry } from "../../types";
import { logger } from "../../utils";
import {
  formatMissingProviderKeys,
  getProviderKeyStatus,
} from "../../utils/provider-keys";
import { uiRuntime } from "../runtime";
import { useStore } from "../store";

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

  const handleSend = useCallback(
    async (text: string) => {
      const store = useStore.getState();
      const trimmedText = text.trim();
      if (!trimmedText || store.isAgentRunning) return;

      const providerKeyStatus = getProviderKeyStatus(store.settings);
      if (!providerKeyStatus.hasRequiredKeys) {
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
      setInputText("");
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
      } catch (error) {
        logger.error("ui", "Failed to send message", { error });
        setError("Failed to communicate with the agent.");
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
      updateStatus,
    ],
  );

  const handleSendFeedback = useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!trimmedText) return;

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
      } catch (error) {
        logger.error("ui", "Failed to send feedback", { error });
        setError("Failed to send feedback to agent.");
      }
    },
    [addMessage, setError],
  );

  const handleStop = useCallback(async () => {
    try {
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
    } catch (error) {
      logger.error("ui", "Failed to stop agent", { error });
    }
  }, [setAgentRunning, updateStatus]);

  return { handleSend, handleSendFeedback, handleStop };
}
