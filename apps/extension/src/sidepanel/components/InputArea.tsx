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
import { logger } from "../../utils";
import { useComposerTextarea } from "../hooks/useComposerTextarea";
import { useSpeechRecorder } from "../hooks/useSpeechRecorder";
import { useComposerDraft } from "../hooks/useComposerDraft";
import { COMPOSER_DRAFT_MAX_CHARS } from "../composer-draft-storage";
import { uiRuntime } from "../runtime";
import { ComposerBox } from "./input/ComposerBox";
import { InteractionModeMenu } from "./input/InteractionModeMenu";
import { WatchModeControl } from "./WatchModeControl";
import {
  hasUsablePersonalProfile,
  isProfileDigestStale,
} from "../../utils/personal-profile";
import { useWorkSurface } from "../use-work-surface";

interface InputAreaProps {
  onSend: (text: string) => void;
  onSendFeedback: (text: string) => void | Promise<void>;
  onStop: () => void;
  onOpenPersonalProfile: () => void;
  onOpenSavedPrompts: () => void;
}

function PendingInteractionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-line bg-canvas p-2">
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
  const setError = useStore((s) => s.setError);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const pendingEscalation = useStore((s) => s.pendingEscalation);
  const pendingClarification = useStore((s) => s.pendingClarification);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const personalProfileState = useStore((s) => s.personalProfileState);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const setPersonalProfileEnabled = useStore(
    (s) => s.setPersonalProfileEnabled,
  );
  const { composer: composerPolicy } = useWorkSurface();

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
  const draft = useComposerDraft({
    text: inputText,
    workspaceId: activeWorkspaceId ?? "default",
    mode: composerPolicy.mode === "new_task" ? "task" : "guidance",
    setText: setInputText,
  });
  const handleSubmit = useCallback(() => {
    if (!hasText || !composerPolicy.enabled) return;
    if (composerPolicy.command === "resume") {
      void (async () => {
        try {
          await onSendFeedback(inputText);
          await uiRuntime.sendMessage({
            type: "RESUME_AGENT",
            requestId: crypto.randomUUID(),
            source: uiRuntime.source,
            payload: { workspaceId: useStore.getState().activeWorkspaceId },
          });
        } catch (error) {
          logger.error("ui", "Failed to resume with guidance", { error });
          setError("Failed to resume the current task.");
        }
      })();
    } else if (composerPolicy.mode !== "new_task") {
      void onSendFeedback(inputText);
    } else {
      onSend(inputText);
    }
  }, [
    hasText,
    inputText,
    composerPolicy.enabled,
    composerPolicy.command,
    composerPolicy.mode,
    onSend,
    onSendFeedback,
    setError,
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
    disabled: Boolean(
      pendingApproval ||
        pendingEscalation ||
        pendingClarification ||
        !composerPolicy.enabled,
    ),
    onTranscript: insertTranscript,
  });

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(event.target.value.slice(0, COMPOSER_DRAFT_MAX_CHARS));
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

  if (!composerPolicy.enabled) {
    return (
      <div className="shrink-0 border-t border-line bg-canvas px-3 py-3">
        <div className="rounded-xl border border-line bg-surface-subtle px-3 py-2.5">
          <div className="text-ui-control font-semibold text-fg-secondary">
            {composerPolicy.label}
          </div>
          {composerPolicy.disabledReason ? (
            <p className="mt-0.5 text-ui-caption leading-relaxed text-fg-tertiary">
              {composerPolicy.disabledReason}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const isGuidanceComposer = composerPolicy.mode !== "new_task";

  return (
    <div className="relative shrink-0 border-t border-line bg-canvas">
      {autonomousMode && composerPolicy.mode === "new_task" ? (
        <div className="mx-2 mt-1 flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning-subtle px-2 py-1 text-ui-caption text-warning">
          <ShieldAlert size={12} className="shrink-0" />
          <span>Autonomous mode - agent acts without asking</span>
        </div>
      ) : null}

      <div className="p-2">
        {composerPolicy.mode === "new_task" ? <WatchModeControl /> : null}
        {/* Keep one composer mounted so run-state updates cannot reset its caret. */}
        <div className={isGuidanceComposer ? "space-y-1.5" : undefined}>
          {isGuidanceComposer ? (
            <div className="px-1">
              <div className="text-ui-caption font-medium text-fg-secondary">
                {composerPolicy.label}
              </div>
              <div className="mt-0.5 text-ui-caption leading-relaxed text-fg-tertiary">
                Your message is routed to the current task.
              </div>
            </div>
          ) : null}
          <ComposerBox
            key="composer"
            hasText={hasText}
            inputRef={composer.textareaRef}
            isGuidance={isGuidanceComposer}
            onBlur={() => {
              composer.handleBlur();
              void draft.saveNow();
            }}
            onChange={handleInputChange}
            onFocus={composer.handleFocus}
            onKeyDown={composer.handleKeyDown}
            onSpeechToggle={
              settings.groqApiKey?.trim() ? speech.toggle : undefined
            }
            onSubmit={handleSubmit}
            placeholder={
              composerPolicy.placeholder ?? "What can I help with?"
            }
            speechState={speech.state}
            value={inputText}
          />
          {isGuidanceComposer ? (
            <p className="select-none px-1 text-ui-caption text-fg-tertiary">
              Guidance is sent into the current run. Press{" "}
              <kbd className="rounded bg-surface-hover px-1 py-0.5 font-mono text-ui-caption text-fg-tertiary">
                Esc
              </kbd>{" "}
              to stop immediately.
            </p>
          ) : (
            <>
              {hasText ? (
                <div className="mt-1 flex items-center justify-end gap-2 px-1 text-ui-caption text-fg-tertiary">
                  <span>{draft.saved ? "Saved on this device" : "Saving locally…"}</span>
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-fg-secondary"
                    onClick={() => void draft.discard()}
                  >
                    Discard draft
                  </button>
                </div>
              ) : null}
              <div className="relative mt-1.5 flex items-center px-1">
                <InteractionModeMenu
                  mode={interactionMode}
                  onChange={setInteractionMode}
                />
                <button
                  type="button"
                  onClick={onOpenSavedPrompts}
                  aria-label="Saved Prompts"
                  className="ml-1 inline-flex h-6 items-center gap-1.5 rounded-md border border-line px-2 text-ui-caption font-medium text-fg-tertiary transition hover:bg-surface-subtle"
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
                  className={`ml-auto inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-ui-caption font-medium transition ${
                    profileActive
                      ? "border-accent/30 bg-accent-subtle text-accent-text"
                      : "border-line text-fg-tertiary hover:bg-surface-subtle"
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
              <p className="mt-1 select-none text-center text-ui-caption text-fg-tertiary">
                AI can make mistakes. Please double-check responses.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
