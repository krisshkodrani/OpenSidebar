/**
 * OpenSidebar - Side Panel UI
 *
 * React 18 + Tailwind CSS UI rendered in Chrome's side panel.
 * Handles user input, displays agent responses, and shows status updates.
 *
 * Communication: Receives messages from background via the UI runtime port
 * State: Managed via Zustand store
 */

import React, { useEffect, useRef, useState, useMemo } from "react";
import { X } from "lucide-react";
import { useStore } from "./store";
import { uiRuntime } from "./runtime";
import {
  Header,
  MessageBubble,
  InputArea,
  PersonalProfileDrawer,
  TaskStatusRegion,
  WebsiteSkillsDrawer,
} from "./components";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { SavedPromptsDrawer } from "./components/SavedPromptsDrawer";
import {
  getInteractionMode,
  getInteractionModeBadge,
} from "./interaction-mode";
import { useSidepanelBootstrap } from "./hooks/useSidepanelBootstrap";
import { useWorkspaceSync } from "./hooks/useWorkspaceSync";
import { useSidepanelBridge } from "./hooks/useSidepanelBridge";
import { useTranscriptAutoScroll } from "./hooks/useTranscriptAutoScroll";
import { useComposerActions } from "./hooks/useComposerActions";
import { useSkillRecordingActions } from "./hooks/useSkillRecordingActions";
import { useTaskUiState } from "./task-ui-state";
import {
  hasReadyProfileDigest,
  hasUsablePersonalProfile,
} from "../utils/personal-profile";

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
  const setInputText = useStore((s) => s.setInputText);
  const settings = useStore((s) => s.settings);
  const setError = useStore((s) => s.setError);
  const error = useStore((s) => s.error);
  const setRecordSkillIntroDismissed = useStore(
    (s) => s.setRecordSkillIntroDismissed,
  );
  const skillRecordingStatus = useStore((s) => s.skillRecordingStatus);
  const activeUserWebsiteSkill = useStore((s) => s.activeUserWebsiteSkill);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const personalProfileState = useStore((s) => s.personalProfileState);
  // Avoid re-running filter/map work on every streaming delta.
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
  const [isPersonalProfileOpen, setIsPersonalProfileOpen] = useState(false);
  const [isSavedPromptsOpen, setIsSavedPromptsOpen] = useState(false);
  const [isWebsiteSkillsOpen, setIsWebsiteSkillsOpen] = useState(false);
  const [isRecordIntroOpen, setIsRecordIntroOpen] = useState(false);
  const [recordIntroDontShowAgain, setRecordIntroDontShowAgain] =
    useState(false);
  const [isSkillChipOpen, setIsSkillChipOpen] = useState(false);
  const [savedPromptsPrefill, setSavedPromptsPrefill] = useState<
    string | undefined
  >(undefined);
  const splashLogoUrl = uiRuntime.getUrl("public/icons/icon-128.png");
  const hasPersonalProfile = useMemo(
    () => hasUsablePersonalProfile(personalProfileState),
    [personalProfileState],
  );
  const profileDigestReady = useMemo(
    () => hasReadyProfileDigest(personalProfileState),
    [personalProfileState],
  );

  useEffect(() => {
    const root = themeRoot ?? document.documentElement;
    root.toggleAttribute("data-opensidebar-ready", ready);
    return () => root.removeAttribute("data-opensidebar-ready");
  }, [ready, themeRoot]);

  useSidepanelBootstrap();
  const blockedSiteWarning = useWorkspaceSync(settings);
  const { screenshot, clearScreenshot } = useSidepanelBridge();
  const taskUi = useTaskUiState();

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

  const { scrollRef, followLatest } = useTranscriptAutoScroll(
    visibleMessages,
    isAgentRunning,
  );
  const { handleSend, handleSendFeedback, handleStop } = useComposerActions({
    onSendStarted: followLatest,
  });
  const { handleRecordSkill, handleConfirmRecordIntro } =
    useSkillRecordingActions({
      closeRecordIntro: () => setIsRecordIntroOpen(false),
      closeWebsiteSkills: () => setIsWebsiteSkillsOpen(false),
      openRecordIntro: () => setIsRecordIntroOpen(true),
      resetRecordIntroPreference: () => setRecordIntroDontShowAgain(false),
      recordIntroDontShowAgain,
    });

  // Auto-dismiss error after 8 seconds (persistent errors stay until user acts)
  const errorPersistent = useStore((s) => s.errorPersistent);
  useEffect(() => {
    if (!error || errorPersistent) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error, errorPersistent, setError]);

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
        {/* Thin ambient activity bar while the agent is running. */}
        {taskUi.showAmbientActivity && (
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
          onOpenPersonalProfile={() => setIsPersonalProfileOpen(true)}
          onOpenSavedPrompts={() => {
            setSavedPromptsPrefill(undefined);
            setIsSavedPromptsOpen(true);
          }}
          onOpenWebsiteSkills={() => setIsWebsiteSkillsOpen(true)}
          onRecordSkill={handleRecordSkill}
          hasPersonalProfile={hasPersonalProfile}
          modeBadgeLabel={getHeaderModeBadge(settings)}
          profileEnabled={personalProfileState.enabled}
          recordingActive={skillRecordingStatus === "recording"}
        />

        <SettingsDrawer
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />

        <PersonalProfileDrawer
          isOpen={isPersonalProfileOpen}
          onClose={() => setIsPersonalProfileOpen(false)}
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

        <main className="flex-1 overflow-hidden relative flex flex-col">
          <TaskStatusRegion
            isPlanExpanded={isPlanExpanded}
            onTogglePlan={() => setIsPlanExpanded((v) => !v)}
            onSkillRecordingHelp={() => {
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
          {isAgentRunning &&
            profileDigestReady && (
              <div className="mx-4 mt-2 rounded-lg border border-primary-200 bg-primary-50/80 px-3 py-2 text-xs text-primary-800 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-200">
                Profile Digest available for this run.
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
            onOpenPersonalProfile={() => setIsPersonalProfileOpen(true)}
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
                  onClick={clearScreenshot}
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
