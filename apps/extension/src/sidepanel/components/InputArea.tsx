import React, { useCallback } from "react";
import { Bookmark, ShieldAlert, UserRound } from "lucide-react";
import { useStore } from "../store";
import { ApprovalOverlay } from "./ApprovalOverlay";
import { EscalationOverlay } from "./EscalationOverlay";
import { ClarificationOverlay } from "./ClarificationOverlay";
import {
  applyInteractionMode,
  getInteractionMode,
  type InteractionMode,
} from "../interaction-mode";
import { saveSettings } from "../../utils/settings-storage";
import { useComposerTextarea } from "../hooks/useComposerTextarea";
import { useSpeechRecorder } from "../hooks/useSpeechRecorder";
import { uiRuntime } from "../runtime";
import { ComposerBox } from "./input/ComposerBox";
import { InteractionModeMenu } from "./input/InteractionModeMenu";
import { WatchModeControl } from "./WatchModeControl";
import {
  hasUsablePersonalProfile,
  isProfileDigestStale,
} from "../../utils/personal-profile";

interface InputAreaProps {
  onSend: (text: string) => void;
  onSendFeedback: (text: string) => void;
  onStop: () => void;
  onOpenPersonalProfile: () => void;
  onOpenSavedPrompts: () => void;
}

function PendingInteractionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-warm-200 bg-warm-50 p-2 dark:border-warm-800 dark:bg-warm-900">
      {children}
    </div>
  );
}

export function InputArea({
  onSend,
  onSendFeedback,
  onStop,
  onOpenPersonalProfile,
  onOpenSavedPrompts,
}: InputAreaProps) {
  const inputText = useStore((s) => s.inputText);
  const setInputText = useStore((s) => s.setInputText);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const pendingEscalation = useStore((s) => s.pendingEscalation);
  const pendingClarification = useStore((s) => s.pendingClarification);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const personalProfileState = useStore((s) => s.personalProfileState);
  const setPersonalProfileEnabled = useStore(
    (s) => s.setPersonalProfileEnabled,
  );

  const interactionMode = getInteractionMode(settings);
  const autonomousMode = interactionMode === "autonomous";
  const profileAvailable = hasUsablePersonalProfile(personalProfileState);
  const profileActive = personalProfileState.enabled && profileAvailable;
  const profileDigestReady =
    profileActive &&
    Boolean(personalProfileState.digest) &&
    !isProfileDigestStale(personalProfileState);
  const setInteractionMode = useCallback(
    (mode: InteractionMode) => {
      const next = applyInteractionMode(settings, mode);
      updateSettings(next);
      void saveSettings(next, uiRuntime.storage);
    },
    [settings, updateSettings],
  );

  const handleProfileToggle = useCallback(() => {
    if (!profileAvailable) {
      onOpenPersonalProfile();
      return;
    }
    void setPersonalProfileEnabled(!profileActive);
  }, [
    onOpenPersonalProfile,
    profileActive,
    profileAvailable,
    setPersonalProfileEnabled,
  ]);

  const hasText = inputText.trim().length > 0;
  const handleSubmit = useCallback(() => {
    if (!hasText) return;
    if (isAgentRunning) {
      onSendFeedback(inputText);
    } else {
      onSend(inputText);
    }
    setInputText("");
  }, [
    hasText,
    inputText,
    isAgentRunning,
    onSend,
    onSendFeedback,
    setInputText,
  ]);

  const composer = useComposerTextarea({
    isAgentRunning,
    inputText,
    interactionPending: Boolean(
      pendingApproval || pendingEscalation || pendingClarification,
    ),
    onSubmit: handleSubmit,
    onStop,
  });

  const insertTranscript = useCallback(
    (transcriptText: string) => {
      const transcript = transcriptText.trim();
      if (!transcript) return;
      const textarea = composer.textareaRef.current;
      const selectionStart = textarea?.selectionStart ?? inputText.length;
      const selectionEnd = textarea?.selectionEnd ?? inputText.length;
      const before = inputText.slice(0, selectionStart);
      const after = inputText.slice(selectionEnd);
      const leading = before && !/\s$/.test(before) ? " " : "";
      const trailing = after && !/^\s/.test(after) ? " " : "";
      const insertion = `${leading}${transcript}${trailing}`;
      const nextText = `${before}${insertion}${after}`;
      const nextCursor = before.length + insertion.length;
      setInputText(nextText);
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [composer.textareaRef, inputText, setInputText],
  );

  const speech = useSpeechRecorder({
    disabled: Boolean(pendingApproval || pendingEscalation || pendingClarification),
    onTranscript: insertTranscript,
  });

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(event.target.value);
    },
    [setInputText],
  );

  if (pendingApproval) {
    return (
      <PendingInteractionShell>
        <ApprovalOverlay />
      </PendingInteractionShell>
    );
  }

  if (pendingEscalation) {
    return (
      <PendingInteractionShell>
        <EscalationOverlay />
      </PendingInteractionShell>
    );
  }

  if (pendingClarification) {
    return (
      <PendingInteractionShell>
        <ClarificationOverlay />
      </PendingInteractionShell>
    );
  }

  return (
    <div className="relative shrink-0 border-t border-warm-200 bg-warm-50 dark:border-warm-800 dark:bg-warm-900">
      {autonomousMode && !isAgentRunning ? (
        <div className="mx-2 mt-1 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <ShieldAlert size={12} className="shrink-0" />
          <span>Autonomous mode - agent acts without asking</span>
        </div>
      ) : null}

      <div className="p-2">
        {!isAgentRunning ? <WatchModeControl /> : null}
        {/* Keep one composer mounted so run-state updates cannot reset its caret. */}
        <div className={isAgentRunning ? "space-y-1.5" : undefined}>
          {isAgentRunning ? (
            <div className="px-1">
              <div className="text-[11px] font-medium text-warm-600 dark:text-warm-300">
                Guide the agent
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-warm-500 dark:text-warm-400">
                Add guidance, a correction, or a new constraint while the
                current run continues.
              </div>
            </div>
          ) : null}
          <ComposerBox
            key="composer"
            hasText={hasText}
            inputRef={composer.textareaRef}
            isGuidance={isAgentRunning}
            onBlur={composer.handleBlur}
            onChange={handleInputChange}
            onFocus={composer.handleFocus}
            onKeyDown={composer.handleKeyDown}
            onSpeechToggle={
              settings.groqApiKey?.trim() ? speech.toggle : undefined
            }
            onSubmit={handleSubmit}
            placeholder={
              isAgentRunning ? "Guide the agent..." : "What can I help with?"
            }
            speechState={speech.state}
            value={inputText}
          />
          {isAgentRunning ? (
            <p className="select-none px-1 text-[10px] text-warm-400 dark:text-warm-500">
              Guidance is sent into the current run. Press{" "}
              <kbd className="rounded bg-warm-200/60 px-1 py-0.5 font-mono text-[9px] text-warm-500 dark:bg-warm-700/60 dark:text-warm-400">
                Esc
              </kbd>{" "}
              to stop immediately.
            </p>
          ) : (
            <>
              <div className="relative mt-1.5 flex items-center px-1">
                <InteractionModeMenu
                  mode={interactionMode}
                  onChange={setInteractionMode}
                />
                <button
                  type="button"
                  onClick={onOpenSavedPrompts}
                  aria-label="Saved Prompts"
                  className="ml-1 inline-flex h-6 items-center gap-1.5 rounded-md border border-warm-200 px-2 text-[11px] font-medium text-warm-500 transition hover:bg-warm-100 dark:border-warm-700 dark:text-warm-300 dark:hover:bg-warm-800"
                  title="Use a saved prompt"
                >
                  <Bookmark size={12} />
                  Prompts
                </button>
                <button
                  type="button"
                  onClick={handleProfileToggle}
                  aria-label="Personalize"
                  aria-pressed={profileActive}
                  className={`ml-auto inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition ${
                    profileActive
                      ? "border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-200"
                      : "border-warm-200 text-warm-500 hover:bg-warm-100 dark:border-warm-700 dark:text-warm-300 dark:hover:bg-warm-800"
                  }`}
                  title={
                    profileAvailable
                      ? profileActive
                        ? profileDigestReady
                          ? "Profile is on. Digest ready for new tasks."
                          : "Profile is on. Analyze notes for the best results."
                        : "Turn profile on for new tasks"
                      : "Add Profile Notes"
                  }
                >
                  <UserRound size={12} />
                  {profileActive ? "Profile on" : "Profile off"}
                </button>
              </div>
              <p className="mt-1 select-none text-center text-[10px] text-warm-400 dark:text-warm-500">
                AI can make mistakes. Please double-check responses.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
