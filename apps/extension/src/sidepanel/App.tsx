/**
 * OpenSidebar - Side Panel UI
 *
 * React 18 + Tailwind CSS UI rendered in Chrome's side panel.
 * Handles user input, displays agent responses, and shows status updates.
 *
 * Communication: Receives messages from background via chrome.runtime.onMessage
 * State: Managed via Zustand store
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { X, Sparkles, ClipboardList } from "lucide-react";
import { logger } from "../utils";
import { speakText } from "./hooks/useTextToSpeech";
import { useStore } from "./store";
import { initializeBridge } from "./bridge";
import { Header, MessageBubble, InputArea, PlanStrip } from "./components";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SavedPromptsDrawer } from "./components/SavedPromptsDrawer";
import {
  getInteractionMode,
  getInteractionModeBadge,
} from "./interaction-mode";
import { AgentStatus, MessageSource, ChatEntry, Workspace } from "../types";
import { getBlockedRuleForUrl } from "../utils/site-access";

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
  const loadAgentStateFromStorage = useStore(
    (s) => s.loadAgentStateFromStorage,
  );
  const setReady = useStore((s) => s.setReady);
  const loadSavedPrompts = useStore((s) => s.loadSavedPrompts);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  // Memoize filtered messages — avoids re-running filter/map on every delta
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (msg) =>
          msg.isPlanCard ||
          msg.role === "user" ||
          msg.isStreaming ||
          msg.content.trim() ||
          msg.toolCalls.length > 0 ||
          msg.completionData ||
          (msg.steps?.length ?? 0) > 0,
      ),
    [messages],
  );

  // Plan strip state
  const pendingPlanConfirmation = useStore((s) => s.pendingPlanConfirmation);
  const taskProgress = useStore((s) => s.taskProgress);
  const taskCompletion = useStore((s) => s.taskCompletion);
  const isPlanning = useStore((s) => s.isPlanning);
  const [isPlanExpanded, setIsPlanExpanded] = useState(false);
  const planExpandedOnceRef = useRef(false);

  // Auto-expand on confirmation arrival
  useEffect(() => {
    if (pendingPlanConfirmation) setIsPlanExpanded(true);
  }, [pendingPlanConfirmation]);

  // Auto-expand on first taskProgress arrival
  useEffect(() => {
    if (taskProgress && !planExpandedOnceRef.current) {
      setIsPlanExpanded(true);
      planExpandedOnceRef.current = true;
    }
  }, [taskProgress]);

  // Auto-collapse when all plan data clears; reset ref for next run
  useEffect(() => {
    if (
      !pendingPlanConfirmation &&
      !taskProgress &&
      !taskCompletion &&
      !isPlanning
    ) {
      setIsPlanExpanded(false);
      planExpandedOnceRef.current = false;
    }
  }, [pendingPlanConfirmation, taskProgress, taskCompletion, isPlanning]);

  // Sidebar UI State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavedPromptsOpen, setIsSavedPromptsOpen] = useState(false);
  const [savedPromptsPrefill, setSavedPromptsPrefill] = useState<
    string | undefined
  >(undefined);
  const [screenshot, setScreenshot] = useState<{
    dataUrl: string;
    context: string;
    timestamp: number;
  } | null>(null);
  const [blockedSiteWarning, setBlockedSiteWarning] = useState<string | null>(
    null,
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldFollowLatestRef = useRef(true);

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

  // Initial load — resolve workspace, then load data
  useEffect(() => {
    logger.info("ui", "Side Panel Mounted");

    (async () => {
      // 1. Load settings first (synchronously needed for theme etc.)
      await loadSettingsFromStorage();

      // 2. Resolve active workspace from current tab
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id) {
          // Look up workspace from chrome.storage.local (persisted by WorkspaceManager)
          const stored = await chrome.storage.local.get(
            "opensidebar:workspaces",
          );
          const workspaces: Workspace[] =
            stored["opensidebar:workspaces"] || [];
          const ws = workspaces.find((w) => w.tabIds.includes(tab.id!));
          if (ws) {
            useStore.getState().setActiveWorkspaceId(ws.id);
          }

          // 3. Notify background that panel is open — response carries workspace ID
          //    (workspace may be created by background if this is a first open)
          try {
            const resp = await chrome.runtime.sendMessage({
              type: "SIDE_PANEL_OPENED",
              requestId: crypto.randomUUID(),
              source: MessageSource.SIDEPANEL,
              payload: { tabId: tab.id, windowId: tab.windowId },
            });
            if (resp?.workspaceId && !useStore.getState().activeWorkspaceId) {
              useStore.getState().setActiveWorkspaceId(resp.workspaceId);
            }
          } catch (e) {
            logger.error("ui", "Failed to notify background of panel open", {
              error: e,
            });
          }
        }
      } catch (e) {
        logger.warn("ui", "Failed to resolve workspace on mount", { error: e });
      }

      // 4. Load persisted state (now workspace-aware)
      await loadAgentStateFromStorage();
      await loadMessagesFromStorage();
      // 5. Load saved prompts
      await loadSavedPrompts();
      setReady();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab activation listener — detect workspace switches
  useEffect(() => {
    const refreshBlockedWarning = async (tabId?: number) => {
      try {
        const tab =
          tabId != null
            ? await chrome.tabs.get(tabId)
            : (
                await chrome.tabs.query({
                  active: true,
                  currentWindow: true,
                })
              )[0];
        const url = tab?.url ?? "";
        const blocked = getBlockedRuleForUrl(url, settings);
        setBlockedSiteWarning(
          blocked
            ? `Agent is blocked on ${blocked.host} by site access rule "${blocked.rule}".`
            : null,
        );
      } catch {
        setBlockedSiteWarning(null);
      }
    };

    void refreshBlockedWarning();

    const listener = async (activeInfo: chrome.tabs.TabActiveInfo) => {
      try {
        const stored = await chrome.storage.local.get("opensidebar:workspaces");
        const workspaces: Workspace[] = stored["opensidebar:workspaces"] || [];
        const ws = workspaces.find((w) => w.tabIds.includes(activeInfo.tabId));
        const newWsId = ws?.id ?? null;
        const currentWsId = useStore.getState().activeWorkspaceId;
        if (newWsId !== currentWsId && newWsId != null) {
          useStore.getState().setActiveWorkspaceId(newWsId);
          // Ask background to re-broadcast current state for this workspace
          chrome.runtime
            .sendMessage({
              type: "WORKSPACE_SYNC",
              requestId: crypto.randomUUID(),
              source: MessageSource.SIDEPANEL,
              payload: { workspaceId: newWsId },
            })
            .catch(() => {});
        }
        await refreshBlockedWarning(activeInfo.tabId);
      } catch (e) {
        logger.warn("ui", "Failed to resolve workspace on tab switch", {
          error: e,
        });
      }
    };

    chrome.tabs.onActivated.addListener(listener);
    return () => chrome.tabs.onActivated.removeListener(listener);
  }, [settings]);

  // Visibility resync — recover state when panel becomes visible again
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const wsId = useStore.getState().activeWorkspaceId;
      // Reload persisted state (picks up background-persisted entries)
      loadAgentStateFromStorage();
      loadMessagesFromStorage();
      // Ask background to re-broadcast current status
      if (wsId) {
        chrome.runtime
          .sendMessage({
            type: "WORKSPACE_SYNC",
            requestId: crypto.randomUUID(),
            source: MessageSource.SIDEPANEL,
            payload: { workspaceId: wsId },
          })
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
            logger.info("ui", "Panel close requested, flushing and closing", {
              windowId,
            });
            // Flush pending messages before panel destruction
            useStore.getState().setActiveWorkspaceId(null);
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

  // Auto-scroll — uses message count + streaming flag as lightweight trigger
  // instead of the full messages array reference (which changes on every delta).
  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const scrollSignal = useMemo(
    () =>
      [
        visibleMessages.length,
        isAgentRunning ? 1 : 0,
        lastVisibleMessage?.id ?? "",
        lastVisibleMessage?.content.length ?? 0,
        lastVisibleMessage?.isStreaming ? 1 : 0,
        lastVisibleMessage?.steps?.length ?? 0,
        lastVisibleMessage?.thinking?.length ?? 0,
      ].join(":"),
    [visibleMessages, isAgentRunning, lastVisibleMessage],
  );
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateFollowState = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      shouldFollowLatestRef.current = distanceFromBottom < 120;
    };

    updateFollowState();
    el.addEventListener("scroll", updateFollowState);
    return () => el.removeEventListener("scroll", updateFollowState);
  }, []);

  useEffect(() => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = setTimeout(() => {
      const el = scrollRef.current;
      if (el && (shouldFollowLatestRef.current || isAgentRunning)) {
        el.scrollTop = el.scrollHeight;
      }
      scrollTimerRef.current = null;
    }, 100);
    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = null;
      }
    };
  }, [scrollSignal, isAgentRunning]);

  // Force-scroll to bottom on task completion so the summary is visible.
  // Uses a ref to track the previous running state and detect the transition.
  const prevRunningRef = useRef(isAgentRunning);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = isAgentRunning;
    if (wasRunning && !isAgentRunning) {
      // Agent just finished — scroll to bottom after a short delay
      // so the final message / completion summary has rendered.
      setTimeout(() => {
        const el = scrollRef.current;
        shouldFollowLatestRef.current = true;
        if (el) el.scrollTop = el.scrollHeight;
      }, 250);
    }
  }, [isAgentRunning]);

  // Auto-TTS — speak the final assistant message when the agent finishes
  const prevRunningForVoice = useRef(isAgentRunning);
  useEffect(() => {
    const wasRunning = prevRunningForVoice.current;
    prevRunningForVoice.current = isAgentRunning;

    if (
      wasRunning &&
      !isAgentRunning &&
      settings.enableVoiceOutput &&
      settings.autoVoiceResponse &&
      (settings.groqApiKey || settings.openaiApiKey || settings.geminiApiKey)
    ) {
      const msgs = useStore.getState().messages;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.role === "assistant" && m.content.trim() && !m.isStreaming) {
          speakText(
            m.content,
            {
              groqApiKey: settings.groqApiKey,
              openaiApiKey: settings.openaiApiKey,
              geminiApiKey: settings.geminiApiKey,
            },
            settings.ttsVoice || "nova",
            settings.ttsProvider,
            settings.ttsStylePreset,
          ).catch(() => {});
          break;
        }
      }
    }
  }, [isAgentRunning, settings]);

  // Auto-dismiss error after 8 seconds (persistent errors stay until user acts)
  const errorPersistent = useStore((s) => s.errorPersistent);
  useEffect(() => {
    if (!error || errorPersistent) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error, errorPersistent, setError]);

  // Send message to agent
  const handleSend = useCallback(
    async (text: string) => {
      const store = useStore.getState();
      const trimmedText = text.trim();
      if (!trimmedText || store.isAgentRunning) return;

      // Check for API key before sending (read fresh from store, not stale closure)
      if (!store.settings.openRouterApiKey) {
        setError(
          "Please add your OpenRouter API key in Settings to get started.",
          { persistent: true },
        );
        return;
      }

      // Add user message to chat
      const userEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmedText,
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: false,
      };

      addMessage(userEntry);

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
            workspaceId: useStore.getState().activeWorkspaceId,
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

  // Send feedback to running agent
  const handleSendFeedback = useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!trimmedText) return;

      // Show feedback in chat
      addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: trimmedText,
        timestamp: Date.now(),
        toolCalls: [],
        isStreaming: false,
        isFeedback: true,
      });

      try {
        await chrome.runtime.sendMessage({
          type: "USER_CHAT",
          requestId: crypto.randomUUID(),
          source: MessageSource.SIDEPANEL,
          payload: {
            text: trimmedText,
            tabId: 0,
            workspaceId: useStore.getState().activeWorkspaceId,
            isFeedback: true,
          },
        });
      } catch (e) {
        logger.error("ui", "Failed to send feedback", { error: e });
        setError("Failed to send feedback to agent.");
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
        payload: {
          workspaceId: useStore.getState().activeWorkspaceId,
        },
      });
      setAgentRunning(false);
      updateStatus(AgentStatus.IDLE, "Stopped by user");
    } catch (e) {
      logger.error("ui", "Failed to stop agent", { error: e });
    }
  }, [setAgentRunning, updateStatus]);

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-warm-gradient">
        <div className="animate-pulse flex flex-col items-center gap-3">
          <div className="px-4 py-3 bg-primary-600 rounded-2xl flex items-center justify-center shadow-lg shadow-primary-600/20">
            <span className="text-white font-bold text-lg tracking-tight">
              OpenSidebar
            </span>
          </div>
          <span className="text-xs text-warm-400 dark:text-warm-500">
            Loading...
          </span>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-full bg-warm-gradient text-warm-800 dark:text-warm-100 font-sans transition-colors duration-200">
        {/* Ambient activity bar — thin animated gradient when agent is running */}
        {isAgentRunning && (
          <div
            className="h-0.5 shrink-0 animate-shimmer"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--tw-gradient-via, #0d9488), transparent)",
              backgroundSize: "200% 100%",
            }}
          />
        )}
        <Header
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenSavedPrompts={() => {
            setSavedPromptsPrefill(undefined);
            setIsSavedPromptsOpen(true);
          }}
          modeBadgeLabel={getInteractionModeBadge(getInteractionMode(settings))}
        />

        <SettingsDrawer
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />

        <SavedPromptsDrawer
          isOpen={isSavedPromptsOpen}
          onClose={() => {
            setIsSavedPromptsOpen(false);
            setSavedPromptsPrefill(undefined);
          }}
          onSelectPrompt={(content) => {
            setInputText(content);
            setIsSavedPromptsOpen(false);
            setSavedPromptsPrefill(undefined);
          }}
          prefillContent={savedPromptsPrefill}
        />

        <PlanStrip
          isExpanded={isPlanExpanded}
          onToggle={() => setIsPlanExpanded((v) => !v)}
        />

        <main className="flex-1 overflow-hidden relative flex flex-col">
          {blockedSiteWarning && (
            <div className="mx-4 mt-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {blockedSiteWarning}
            </div>
          )}
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
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="max-w-[260px]">
                  <div className="w-14 h-14 bg-primary-100 dark:bg-primary-900/30 rounded-2xl mb-5 flex items-center justify-center mx-auto">
                    <Sparkles size={24} className="text-primary-500" />
                  </div>
                  {!(settings.fireworksApiKey || settings.openRouterApiKey) ? (
                    <>
                      <h2 className="font-semibold mb-1 text-warm-800 dark:text-warm-100">
                        Welcome to OpenSidebar
                      </h2>
                      <p className="text-xs text-warm-500 dark:text-warm-400 mt-1 mb-4">
                        Add your Fireworks AI API key to get started.
                      </p>
                      <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors shadow-sm shadow-primary-600/20"
                      >
                        Open Settings
                      </button>
                    </>
                  ) : (
                    <>
                      <h2 className="font-semibold mb-1 text-warm-800 dark:text-warm-100">
                        Hi! What can I help with?
                      </h2>
                      <div className="flex flex-wrap gap-2 justify-center mt-4">
                        {SUGGESTED_ACTIONS.map((action) => (
                          <button
                            key={action}
                            onClick={() => setInputText(action)}
                            className="text-xs px-3 py-1.5 rounded-full border border-warm-200 dark:border-warm-700 text-warm-600 dark:text-warm-300 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200 dark:hover:bg-primary-900/20 dark:hover:text-primary-300 dark:hover:border-primary-800 transition-all hover:-translate-y-0.5 hover:shadow-sm"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              visibleMessages.map((msg) =>
                msg.isPlanCard ? (
                  <button
                    key={msg.id}
                    onClick={() => setIsPlanExpanded(true)}
                    className="w-full text-left px-3 py-1.5 my-1 rounded border border-warm-200 dark:border-warm-700 bg-warm-50/60 dark:bg-warm-800/40 text-[11px] text-warm-500 dark:text-warm-400 hover:bg-warm-100 dark:hover:bg-warm-800/60 transition-colors flex items-center gap-1.5"
                  >
                    <ClipboardList size={11} className="shrink-0" />
                    Plan created — tap to view
                  </button>
                ) : (
                  <MessageBubble key={msg.id} message={msg} />
                ),
              )
            )}
          </div>
        </main>

        <div className="flex flex-col shrink-0 z-20">
          <InputArea
            onSend={handleSend}
            onSendFeedback={handleSendFeedback}
            onStop={handleStop}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
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
    </ErrorBoundary>
  );
}
