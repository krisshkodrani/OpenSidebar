/**
 * OpenSidebar - Side Panel UI
 *
 * React 18 + Tailwind CSS UI rendered in Chrome's side panel.
 * Handles user input, displays agent responses, and shows status updates.
 *
 * Communication: Receives messages from background via the UI runtime port
 * State: Managed via Zustand store
 */

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { X } from "lucide-react";
import { logger } from "../utils";
import { speakText } from "./hooks/useTextToSpeech";
import { useStore } from "./store";
import { initializeBridge } from "./bridge";
import { uiRuntime } from "./runtime";
import {
  Header,
  MessageBubble,
  InputArea,
  PlanStrip,
  PrimaryTaskRail,
  StalledRecoveryCard,
  SkillRecordingPanel,
  WebsiteSkillsDrawer,
} from "./components";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SavedPromptsDrawer } from "./components/SavedPromptsDrawer";
import {
  getInteractionMode,
  getInteractionModeBadge,
} from "./interaction-mode";
import { AgentStatus, ChatEntry, Workspace } from "../types";
import { getBlockedRuleForUrl } from "../utils/site-access";
import {
  formatMissingProviderKeys,
  getProviderKeyStatus,
} from "../utils/provider-keys";

const SUGGESTED_ACTIONS = [
  "Summarize this page",
  "Compare the options here",
  "Help me complete this task",
];

function getLaneTopologyBadge(mode = "full"): string | null {
  if (mode === "simple") return "Fast";
  if (mode === "standard") return "Balanced";
  return null;
}

function getHeaderModeBadge(settings: {
  requireApprovals: boolean;
  requirePlanConfirmation?: boolean;
  laneTopologyMode?: string;
}): string | null {
  return (
    getLaneTopologyBadge(settings.laneTopologyMode) ??
    getInteractionModeBadge(getInteractionMode(settings))
  );
}

export interface AppProps {
  themeRoot?: HTMLElement | null;
}

export default function App({ themeRoot }: AppProps = {}) {
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
  const loadUserWebsiteSkills = useStore((s) => s.loadUserWebsiteSkills);
  const startSkillRecording = useStore((s) => s.startSkillRecording);
  const recordSkillIntroDismissed = useStore(
    (s) => s.recordSkillIntroDismissed,
  );
  const setRecordSkillIntroDismissed = useStore(
    (s) => s.setRecordSkillIntroDismissed,
  );
  const skillRecordingStatus = useStore((s) => s.skillRecordingStatus);
  const activeUserWebsiteSkill = useStore((s) => s.activeUserWebsiteSkill);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  // Memoize filtered messages â€” avoids re-running filter/map on every delta
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (msg) =>
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
  const [isWebsiteSkillsOpen, setIsWebsiteSkillsOpen] = useState(false);
  const [isRecordIntroOpen, setIsRecordIntroOpen] = useState(false);
  const [recordIntroDontShowAgain, setRecordIntroDontShowAgain] =
    useState(false);
  const [isSkillChipOpen, setIsSkillChipOpen] = useState(false);
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
  const splashLogoUrl = useMemo(() => {
    return uiRuntime.getUrl("public/icons/icon-128.png");
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const screenshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldFollowLatestRef = useRef(true);

  // Dark Mode Logic
  useEffect(() => {
    const applyTheme = () => {
      const root = themeRoot ?? document.documentElement;
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
  }, [settings.theme, themeRoot]);

  // Initial load â€” resolve workspace, then load data
  useEffect(() => {
    logger.info("ui", "Side Panel Mounted");

    (async () => {
      // 1. Load settings first (synchronously needed for theme etc.)
      await loadSettingsFromStorage();

      // 2. Resolve active workspace from current tab
      try {
        const tab = await uiRuntime.getActiveTab();
        if (tab?.id) {
          // Look up workspace from UI runtime storage (persisted by WorkspaceManager)
          const stored = await uiRuntime.storage.local.get(
            "opensidebar:workspaces",
          );
          const workspaces =
            (stored["opensidebar:workspaces"] as Workspace[] | undefined) || [];
          const ws = workspaces.find((w) => w.tabIds.includes(tab.id!));
          if (ws) {
            useStore.getState().setActiveWorkspaceId(ws.id);
          }

          // 3. Notify background that panel is open â€” response carries workspace ID
          //    (workspace may be created by background if this is a first open)
          try {
            const resp = await uiRuntime.sendMessage<{ workspaceId?: string }>({
              type: "SIDE_PANEL_OPENED",
              requestId: crypto.randomUUID(),
              source: uiRuntime.source,
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
      await loadUserWebsiteSkills();
      setReady();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginSkillRecording = useCallback(async () => {
    let activeTabId = 0;
    try {
      const tab = await uiRuntime.getActiveTab();
      if (tab?.id) activeTabId = tab.id;
    } catch (e) {
      logger.warn("ui", "Failed to get active tab for skill recording", {
        error: e,
      });
    }
    if (!activeTabId) {
      setError("Open a normal web page before recording a site skill.");
      return;
    }
    await startSkillRecording(activeTabId);
    setIsRecordIntroOpen(false);
    setIsWebsiteSkillsOpen(false);
  }, [setError, startSkillRecording]);

  const handleRecordSkill = useCallback(() => {
    if (recordSkillIntroDismissed) {
      void beginSkillRecording();
    } else {
      setRecordIntroDontShowAgain(false);
      setIsRecordIntroOpen(true);
    }
  }, [beginSkillRecording, recordSkillIntroDismissed]);

  const handleConfirmRecordIntro = useCallback(async () => {
    if (recordIntroDontShowAgain) {
      await setRecordSkillIntroDismissed(true);
    }
    await beginSkillRecording();
  }, [
    beginSkillRecording,
    recordIntroDontShowAgain,
    setRecordSkillIntroDismissed,
  ]);

  // Tab activation listener â€” detect workspace switches
  useEffect(() => {
    const refreshBlockedWarning = async (tabId?: number) => {
      try {
        const tab =
          tabId != null
            ? await uiRuntime.getTab(tabId)
            : await uiRuntime.getActiveTab();
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

    const listener = async (activeInfo: { tabId: number }) => {
      try {
        const stored = await uiRuntime.storage.local.get(
          "opensidebar:workspaces",
        );
        const workspaces =
          (stored["opensidebar:workspaces"] as Workspace[] | undefined) || [];
        const ws = workspaces.find((w) => w.tabIds.includes(activeInfo.tabId));
        const newWsId = ws?.id ?? null;
        const currentWsId = useStore.getState().activeWorkspaceId;
        if (newWsId !== currentWsId && newWsId != null) {
          useStore.getState().setActiveWorkspaceId(newWsId);
          // Ask background to re-broadcast current state for this workspace
          uiRuntime
            .sendMessage({
              type: "WORKSPACE_SYNC",
              requestId: crypto.randomUUID(),
              source: uiRuntime.source,
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

    return uiRuntime.onActiveTabChanged(listener);
  }, [settings]);

  // Visibility resync â€” recover state when panel becomes visible again
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const wsId = useStore.getState().activeWorkspaceId;
      // Reload persisted state (picks up background-persisted entries)
      loadAgentStateFromStorage();
      loadMessagesFromStorage();
      // Ask background to re-broadcast current status
      if (wsId) {
        uiRuntime
          .sendMessage({
            type: "WORKSPACE_SYNC",
            requestId: crypto.randomUUID(),
            source: uiRuntime.source,
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

  // Message Bridge â€” centralized message routing from background to store
  useEffect(() => {
    const cleanup = initializeBridge(useStore, {
      onScreenshot: (payload) => {
        if (!useStore.getState().settings.showDebugScreenshots) {
          return;
        }
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
        uiRuntime.getCurrentWindow().then((currentWindow) => {
          if (currentWindow?.id === windowId) {
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

  useEffect(() => {
    if (settings.showDebugScreenshots === false && screenshot) {
      setScreenshot(null);
      if (screenshotTimerRef.current) {
        clearTimeout(screenshotTimerRef.current);
        screenshotTimerRef.current = null;
      }
    }
  }, [settings.showDebugScreenshots, screenshot]);

  // Auto-scroll â€” uses message count + streaming flag as lightweight trigger
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
    el.addEventListener("scroll", updateFollowState, { passive: true });
    return () => el.removeEventListener("scroll", updateFollowState);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && shouldFollowLatestRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [scrollSignal]);

  // Auto-TTS â€” speak the final assistant message when the agent finishes
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

      // Check for the active provider's API key before sending.
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
      shouldFollowLatestRef.current = true;

      // Clear input and set running state
      setInputText("");
      setAgentRunning(true);
      updateStatus(AgentStatus.THINKING, "Sending request...");

      // Get current tab
      let activeTabId = 0;
      try {
        const tab = await uiRuntime.getActiveTab();
        if (tab?.id) activeTabId = tab.id;
      } catch (e) {
        logger.warn("ui", "Failed to get active tab", { error: e });
      }

      // Send to service worker
      try {
        await uiRuntime.sendMessage({
          type: "USER_CHAT",
          requestId: crypto.randomUUID(),
          source: uiRuntime.source,
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
        await uiRuntime.sendMessage({
          type: "USER_CHAT",
          requestId: crypto.randomUUID(),
          source: uiRuntime.source,
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
    } catch (e) {
      logger.error("ui", "Failed to stop agent", { error: e });
    }
  }, [setAgentRunning, updateStatus]);

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-warm-gradient">
        <div className="animate-pulse flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center shadow-lg shadow-primary-600/20">
            <img
              src={splashLogoUrl}
              alt="OpenSidebar logo"
              className="w-16 h-16 object-contain"
            />
          </div>
          <span className="text-xs text-warm-500 dark:text-warm-400">
            Loading...
          </span>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-full bg-warm-gradient text-warm-800 dark:text-warm-100 font-sans transition-colors duration-200">
        {/* Ambient activity bar â€” thin animated gradient when agent is running */}
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
          onOpenWebsiteSkills={() => setIsWebsiteSkillsOpen(true)}
          onRecordSkill={handleRecordSkill}
          modeBadgeLabel={getHeaderModeBadge(settings)}
          recordingActive={skillRecordingStatus === "recording"}
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

        <WebsiteSkillsDrawer
          isOpen={isWebsiteSkillsOpen}
          onClose={() => setIsWebsiteSkillsOpen(false)}
          onStartRecording={handleRecordSkill}
        />

        <PlanStrip
          isExpanded={isPlanExpanded}
          onToggle={() => setIsPlanExpanded((v) => !v)}
        />

        <main className="flex-1 overflow-hidden relative flex flex-col">
          <PrimaryTaskRail />
          <StalledRecoveryCard />
          <SkillRecordingPanel
            onHelp={() => {
              setRecordIntroDontShowAgain(false);
              setIsRecordIntroOpen(true);
            }}
          />
          {activeUserWebsiteSkill && (
            <div className="mx-4 mt-2 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/80 dark:bg-primary-900/20 text-xs text-primary-800 dark:text-primary-200">
              <button
                onClick={() => setIsSkillChipOpen((value) => !value)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
              >
                <span className="truncate">
                  Using site skill: {activeUserWebsiteSkill.name}
                </span>
                <span className="text-[10px] uppercase text-primary-500">
                  {isSkillChipOpen ? "Hide" : "View"}
                </span>
              </button>
              {isSkillChipOpen && (
                <div className="border-t border-primary-200 dark:border-primary-800 px-3 py-2 text-warm-700 dark:text-warm-200">
                  <p className="font-semibold">{activeUserWebsiteSkill.name}</p>
                  <p className="mt-0.5 text-warm-500 dark:text-warm-400">
                    {activeUserWebsiteSkill.origin}
                    {activeUserWebsiteSkill.pathPattern}
                  </p>
                  <ol className="mt-2 space-y-1">
                    {activeUserWebsiteSkill.workflowSteps.map((step, index) => (
                      <li key={`${step}-${index}`}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
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
                  <div className="w-14 h-14 rounded-2xl overflow-hidden mb-5 flex items-center justify-center mx-auto shadow-sm shadow-primary-600/15">
                    <img
                      src={splashLogoUrl}
                      alt="OpenSidebar logo"
                      className="w-14 h-14 object-contain"
                    />
                  </div>
                  {!(
                    settings.fireworksApiKey ||
                    settings.deepseekApiKey ||
                    settings.kimiApiKey ||
                    settings.xiaomiApiKey ||
                    settings.openaiApiKey ||
                    settings.openRouterApiKey
                  ) ? (
                    <>
                      <h2 className="font-semibold mb-1 text-warm-800 dark:text-warm-100">
                        Welcome to OpenSidebar
                      </h2>
                      <p className="text-xs text-warm-500 dark:text-warm-400 mt-1 mb-4">
                        Add an API key in Settings to get started.
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
              visibleMessages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))
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

        {isRecordIntroOpen && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-enter"
            role="dialog"
            aria-modal="true"
            aria-label="Record Skill"
          >
            <div className="w-full max-w-[330px] rounded-lg border border-warm-200 dark:border-warm-700 bg-warm-50 dark:bg-warm-900 p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-warm-900 dark:text-warm-100">
                    Teach a website workflow
                  </h2>
                  <p className="mt-1 text-xs text-warm-500 dark:text-warm-400">
                    Recording captures clicks, field choices, and page changes.
                  </p>
                </div>
                <button
                  onClick={() => setIsRecordIntroOpen(false)}
                  className="p-1 rounded-full text-warm-500 hover:bg-warm-100 dark:hover:bg-warm-800"
                  aria-label="Cancel"
                >
                  <X size={16} />
                </button>
              </div>
              <ul className="mt-3 space-y-2 text-xs text-warm-700 dark:text-warm-200">
                <li>Typed values are redacted by default.</li>
                <li>The saved result is generalized agent guidance.</li>
                <li>It is not blind macro replay.</li>
              </ul>
              <label className="mt-3 flex items-center gap-2 text-xs text-warm-600 dark:text-warm-300">
                <input
                  type="checkbox"
                  checked={recordIntroDontShowAgain}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setRecordIntroDontShowAgain(checked);
                    void setRecordSkillIntroDismissed(checked);
                  }}
                  className="h-3.5 w-3.5 rounded border-warm-300"
                />
                Don&apos;t show this again
              </label>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleConfirmRecordIntro}
                  className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Start recording
                </button>
                <button
                  onClick={() => setIsRecordIntroOpen(false)}
                  className="rounded-md border border-warm-300 dark:border-warm-700 px-3 py-2 text-sm font-semibold text-warm-700 dark:text-warm-200 hover:bg-warm-100 dark:hover:bg-warm-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {screenshot && settings.showDebugScreenshots && (
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
