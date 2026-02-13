import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Sparkles } from "lucide-react";
import { logger } from "../utils";
import { useStore } from "./store";
import { initializeBridge } from "./bridge";
import { Header, MessageBubble, InputArea, ControlBar, StuckBanner, TaskProgressPanel, MetricsBar } from "./components";
import { SettingsDrawer } from "./components/SettingsDrawer";
import {
  AgentStatus,
  MessageSource,
  ChatEntry,
} from "../types";

const SUGGESTED_ACTIONS = [
  "Summarize this page",
  "Fill out this form",
  "Find pricing info",
];

export default function App() {
  const ready = useStore((s) => s.ready);
  const messages = useStore((s) => s.messages);
  const addMessage = useStore((s) => s.addMessage);
  const updateStatus = useStore((s) => s.updateStatus);
  const setAgentRunning = useStore((s) => s.setAgentRunning);
  const setInputText = useStore((s) => s.setInputText);
  const settings = useStore((s) => s.settings);
  const setError = useStore((s) => s.setError);
  const error = useStore((s) => s.error);
  const loadSettingsFromStorage = useStore((s) => s.loadSettingsFromStorage);
  const loadMessagesFromStorage = useStore((s) => s.loadMessagesFromStorage);
  const setReady = useStore((s) => s.setReady);
  const sessionMetrics = useStore((s) => s.sessionMetrics);
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

    Promise.all([loadSettingsFromStorage(), loadMessagesFromStorage()]).then(
      () => setReady(),
    );

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

  // Message Bridge — centralized message routing from background to store
  useEffect(() => {
    const cleanup = initializeBridge(useStore, {
      onScreenshot: (payload) => {
        if (screenshotTimerRef.current) {
          clearTimeout(screenshotTimerRef.current);
        }
        setScreenshot(payload);
        screenshotTimerRef.current = setTimeout(() => {
          setScreenshot(null);
          screenshotTimerRef.current = null;
        }, 30000);
      },
      onClose: (windowId) => {
        chrome.windows.getCurrent().then((currentWindow) => {
          if (currentWindow.id === windowId) {
            logger.info("ui", "Received close request from background", { windowId });
            globalThis.close();
          }
        });
      },
    });
    return () => {
      cleanup();
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

  // Send hint to running agent
  const handleSendHint = useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!trimmedText) return;

      // Show hint in chat
      addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: trimmedText,
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: false,
        isHint: true,
      });

      try {
        await chrome.runtime.sendMessage({
          type: "USER_CHAT",
          requestId: crypto.randomUUID(),
          source: MessageSource.SIDEPANEL,
          payload: {
            text: trimmedText,
            tabId: 0,
            workspaceId: null,
            isHint: true,
          },
        });
      } catch (e) {
        logger.error("ui", "Failed to send hint", { error: e });
        setError("Failed to send hint to agent.");
      }
    },
    [addMessage, setError],
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

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-warm-50 dark:bg-warm-900">
        <div className="animate-pulse flex flex-col items-center gap-3">
          <div className="w-14 h-14 bg-primary-600 rounded-2xl flex items-center justify-center shadow-lg shadow-primary-600/20">
            <span className="text-white font-bold text-xl tracking-tight">OS</span>
          </div>
          <span className="text-xs text-warm-400 dark:text-warm-500">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-warm-50 dark:bg-warm-900 text-warm-800 dark:text-warm-100 font-sans transition-colors duration-200">
      <Header onOpenSettings={() => setIsSettingsOpen(true)} />

      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <StuckBanner />

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
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="rounded-2xl bg-warm-100/50 dark:bg-warm-800/30 border border-warm-200/60 dark:border-warm-700/40 shadow-soft p-6 max-w-[280px]">
                <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/30 rounded-lg mb-3 flex items-center justify-center mx-auto">
                  <Sparkles size={20} className="text-primary-500" />
                </div>
                <h2 className="font-semibold mb-1 text-warm-800 dark:text-warm-100">Welcome to OpenSidebar</h2>
                <p className="text-sm text-warm-500 dark:text-warm-400 mb-4">
                  Ask me to browse, research, or automate tasks.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {SUGGESTED_ACTIONS.map((action) => (
                    <button
                      key={action}
                      onClick={() => setInputText(action)}
                      className="text-xs px-3 py-1.5 rounded-full border border-warm-200 dark:border-warm-700 text-warm-600 dark:text-warm-300 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200 dark:hover:bg-primary-900/20 dark:hover:text-primary-300 dark:hover:border-primary-800 transition-colors"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}
        </div>
      </main>

      <div className="flex flex-col shrink-0 glass-surface z-20 border-t border-warm-200 dark:border-warm-800 shadow-glass">
        <ControlBar />
        {settings.showSessionMetrics && sessionMetrics && <MetricsBar metrics={sessionMetrics} />}
        <TaskProgressPanel />
        <InputArea onSend={handleSend} onSendHint={handleSendHint} onStop={handleStop} />
      </div>

      {screenshot && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md">
          <div className="bg-warm-50 dark:bg-warm-800 rounded-lg shadow-xl border border-warm-200 dark:border-warm-700 overflow-hidden">
            <div className="p-2 bg-warm-100 dark:bg-warm-900 border-b border-warm-200 dark:border-warm-700 flex justify-between items-center">
              <span className="text-xs font-medium text-warm-600 dark:text-warm-400">
                Debug Screenshot
              </span>
              <button
                onClick={() => setScreenshot(null)}
                className="p-0.5 hover:bg-warm-200 dark:hover:bg-warm-700 rounded text-warm-400 hover:text-warm-600 dark:hover:text-warm-300"
              >
                <X size={14} />
              </button>
            </div>
            <img
              src={screenshot.dataUrl}
              alt="Debug screenshot with element tags"
              className="max-h-48 w-full object-contain"
            />
            <div className="p-2 text-xs text-warm-500 dark:text-warm-400">
              {screenshot.context}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
