import React, { useEffect, useRef, useState, useCallback } from "react";
import { X } from "lucide-react";
import { logger } from "../utils";
import { useStore } from "./store";
import { Header, MessageBubble, InputArea, ControlBar } from "./components";
import { SettingsDrawer } from "./components/SettingsDrawer";
import {
  AgentStatus,
  RuntimeMessage,
  MessageSource,
  ChatEntry,
  ToolCallSummary,
} from "../types";

export default function App() {
  const messages = useStore((s) => s.messages);
  const addMessage = useStore((s) => s.addMessage);
  const updateStatus = useStore((s) => s.updateStatus);
  const setAgentRunning = useStore((s) => s.setAgentRunning);
  const setInputText = useStore((s) => s.setInputText);
  const settings = useStore((s) => s.settings);
  const appendStreamDelta = useStore((s) => s.appendStreamDelta);
  const finalizeStream = useStore((s) => s.finalizeStream);
  const addStep = useStore((s) => s.addStep);
  const updateStep = useStore((s) => s.updateStep);
  const setError = useStore((s) => s.setError);
  const error = useStore((s) => s.error);
  const loadSettingsFromStorage = useStore((s) => s.loadSettingsFromStorage);
  const loadMessagesFromStorage = useStore((s) => s.loadMessagesFromStorage);

  // Sidebar UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<{
    dataUrl: string;
    context: string;
    timestamp: number;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const screenshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dark Mode Logic
  useEffect(() => {
    const applyTheme = () => {
      const root = document.documentElement;
      const isDark =
        settings.theme === "dark" ||
        (settings.theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);

      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    applyTheme();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme();
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [settings.theme]);

  // Initial load
  useEffect(() => {
    logger.info("ui", "Side Panel Mounted");

    loadSettingsFromStorage();
    loadMessagesFromStorage();

    // Notify background that panel is open (triggers workspace creation if needed)
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.runtime
          .sendMessage({
            type: "SIDE_PANEL_OPENED",
            requestId: crypto.randomUUID(),
            source: MessageSource.SIDEPANEL,
            payload: { tabId: tab.id, windowId: tab.windowId },
          })
          .catch((e) =>
            logger.error("ui", "Failed to notify background of panel open", {
              error: e,
            }),
          );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Message Listener for Agent Communication
  useEffect(() => {
    const listener = (message: RuntimeMessage) => {
      if (message.source !== MessageSource.BACKGROUND) return;

      logger.debug("ui", "Received message", { type: message.type });

      switch (message.type) {
        case "AGENT_STATUS":
          updateStatus(message.payload.status, message.payload.detail);
          if (
            message.payload.status === AgentStatus.IDLE ||
            message.payload.status === AgentStatus.ERROR
          ) {
            setAgentRunning(false);
          } else {
            setAgentRunning(true);
          }
          break;

        case "STREAM_CHUNK":
          handleStreamChunk(message.payload);
          break;

        case "CLOSE_SIDE_PANEL":
          chrome.windows.getCurrent().then((currentWindow) => {
            if (currentWindow.id === message.payload.windowId) {
              logger.info("ui", "Received close request from background", {
                windowId: currentWindow.id,
              });
              window.close();
              // Actually window.close() in React component closes the window/frame it is in.
              // But chrome.windows.getCurrent returns a Window object which does not have close().
              // We need to call the global close().
              // So just calling close() or globalThis.close() works for the frame.
              globalThis.close();
            }
          });
          break;

        case "AGENT_STEP":
          if (message.payload.update) {
            updateStep(message.payload.step);
          } else {
            addStep(message.payload.step);
          }
          break;

        case "AGENT_RESPONSE":
          handleAgentResponse(message.payload);
          break;

        case "SCREENSHOT_CAPTURED":
          // Clear any existing screenshot timer
          if (screenshotTimerRef.current) {
            clearTimeout(screenshotTimerRef.current);
          }
          setScreenshot(message.payload);
          // Auto-dismiss after 30 seconds
          screenshotTimerRef.current = setTimeout(() => {
            setScreenshot(null);
            screenshotTimerRef.current = null;
          }, 30000);
          break;

        default:
          logger.debug("ui", "Unhandled message type", { type: message.type });
          break;
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      if (screenshotTimerRef.current) {
        clearTimeout(screenshotTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-dismiss error after 8 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error, setError]);

  // Handle stream chunks from background
  const handleStreamChunk = useCallback(
    (payload: { delta: string; done: boolean }) => {
      const { delta, done } = payload;
      if (done) {
        finalizeStream();
      } else if (delta) {
        appendStreamDelta(delta);
      }
    },
    [appendStreamDelta, finalizeStream],
  );

  // Handle final agent response
  const handleAgentResponse = useCallback(
    (payload: {
      text: string;
      isStreaming: boolean;
      toolCalls: ToolCallSummary[];
    }) => {
      // The streaming handler should have already built the content
      // This just finalizes if needed
      if (!payload.isStreaming) {
        finalizeStream();
      }
    },
    [finalizeStream],
  );

  // Send message to agent
  const handleSend = useCallback(
    async (text: string) => {
      const store = useStore.getState();
      const trimmedText = text.trim();
      if (!trimmedText || store.isAgentRunning) return;

      // Add user message to chat
      const userEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmedText,
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: false,
      };

      // Add placeholder assistant message for streaming
      const assistantEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: true,
      };

      // Add both messages to store
      addMessage(userEntry);
      addMessage(assistantEntry);

      // Clear input and set running state
      setInputText("");
      setAgentRunning(true);
      updateStatus(AgentStatus.THINKING, "Sending request...");

      // Get current tab
      let activeTabId = 0;
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id) activeTabId = tab.id;
      } catch (e) {
        logger.warn("ui", "Failed to get active tab", { error: e });
      }

      // Send to service worker
      try {
        await chrome.runtime.sendMessage({
          type: "USER_CHAT",
          requestId: crypto.randomUUID(),
          source: MessageSource.SIDEPANEL,
          payload: {
            text: trimmedText,
            tabId: activeTabId,
            workspaceId: null,
          },
        });
      } catch (e) {
        logger.error("ui", "Failed to send message", { error: e });
        setError("Failed to communicate with the agent.");
        setAgentRunning(false);
        updateStatus(AgentStatus.ERROR, "Connection failed");
      }
    },
    [addMessage, setInputText, setAgentRunning, updateStatus, setError],
  );

  const handleStop = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "STOP_AGENT",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: {},
      });
      setAgentRunning(false);
      updateStatus(AgentStatus.IDLE, "Stopped by user");
    } catch (e) {
      logger.error("ui", "Failed to stop agent", { error: e });
    }
  }, [setAgentRunning, updateStatus]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans transition-colors duration-200">
      <Header onOpenSettings={() => setIsSettingsOpen(true)} />

      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <main className="flex-1 overflow-hidden relative flex flex-col">
        {error && (
          <div
            role="alert"
            className="mx-4 mt-2 flex items-center justify-between gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
          >
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40 rounded"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 scroll-smooth"
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-50">
              <div className="w-16 h-16 bg-gray-200 dark:bg-gray-800 rounded-2xl mb-4 flex items-center justify-center">
                <span className="text-2xl">✨</span>
              </div>
              <h2 className="font-semibold mb-1">Welcome to OpenSidebar</h2>
              <p className="text-sm">
                Ask me to browse, research, or automate tasks.
              </p>
            </div>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
        </div>
      </main>

      <div className="flex flex-col shrink-0 bg-surface-light dark:bg-surface-dark z-20 border-t border-gray-200 dark:border-gray-800 shadow-lg">
        <ControlBar />
        <InputArea onSend={handleSend} onStop={handleStop} />
      </div>

      {screenshot && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Debug Screenshot
              </span>
              <button
                onClick={() => setScreenshot(null)}
                className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={14} />
              </button>
            </div>
            <img
              src={screenshot.dataUrl}
              alt="Debug screenshot with element tags"
              className="max-h-48 w-full object-contain"
            />
            <div className="p-2 text-xs text-gray-500 dark:text-gray-400">
              {screenshot.context}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
