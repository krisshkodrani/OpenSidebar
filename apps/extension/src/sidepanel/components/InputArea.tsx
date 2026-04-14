import React, { useRef, useEffect, useCallback, useState } from "react";
import { clsx } from "clsx";
import {
  ArrowUp,
  Play,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  Check,
  Square,
  Mic,
  Loader2,
} from "lucide-react";
import { useStore } from "../store";
import { StatusLine } from "./StatusLine";
import { ApprovalOverlay } from "./ApprovalOverlay";
import { EscalationOverlay } from "./EscalationOverlay";
import { ClarificationOverlay } from "./ClarificationOverlay";
import {
  applyInteractionMode,
  InteractionMode,
  getInteractionMode,
  getInteractionModeDescription,
  getInteractionModeLabel,
} from "../interaction-mode";
import { saveSettings } from "../../utils/settings-storage";
import { useSpeechToText } from "../hooks/useSpeechToText";

export function InputArea({
  onSend,
  onSendFeedback,
  onStop,
  onOpenSettings: _onOpenSettings,
}: {
  onSend: (text: string) => void;
  onSendFeedback: (text: string) => void;
  onStop: () => void;
  onOpenSettings: () => void;
}) {
  const inputText = useStore((s) => s.inputText);
  const setInputText = useStore((s) => s.setInputText);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const pendingEscalation = useStore((s) => s.pendingEscalation);
  const pendingClarification = useStore((s) => s.pendingClarification);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const interactionMode = getInteractionMode(settings);
  const autonomousMode = interactionMode === "autonomous";
  const [autonomyMenuOpen, setAutonomyMenuOpen] = useState(false);

  // Voice input (STT)
  const voiceEnabled = settings?.enableVoiceInput ?? false;
  const stt = useSpeechToText({
    groqApiKey: settings?.groqApiKey,
    openaiApiKey: settings?.openaiApiKey,
  });
  const {
    transcript,
    clearTranscript,
    isRecording,
    isTranscribing,
    startRecording,
    stopRecording,
    error: sttError,
  } = stt;

  const setInteractionMode = useCallback(
    (mode: InteractionMode) => {
      const next = applyInteractionMode(settings, mode);
      updateSettings(next);
      void saveSettings(next);
    },
    [settings, updateSettings],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevHeightRef = useRef<number>(0);

  // Smooth auto-resize
  const MAX_HEIGHT = 120;
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    const prev = prevHeightRef.current;

    el.style.transition = "none";
    el.style.overflowY = "hidden";
    el.style.height = "0px";
    const scrollH = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = (prev || scrollH) + "px";

    void el.offsetHeight;
    el.style.transition = "height 0.15s ease";
    el.style.height = scrollH + "px";
    el.style.overflowY = scrollH >= MAX_HEIGHT ? "auto" : "hidden";

    prevHeightRef.current = scrollH;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [inputText, resizeTextarea]);

  // Populate input when voice transcript arrives
  useEffect(() => {
    if (transcript) {
      const current = useStore.getState().inputText;
      setInputText(current ? `${current} ${transcript}` : transcript);
      clearTranscript();
    }
  }, [transcript, setInputText, clearTranscript]);

  // Alt+V keyboard shortcut — toggle voice recording from anywhere in the panel
  useEffect(() => {
    if (!voiceEnabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && e.key === "v") {
        e.preventDefault();
        if (isRecording) {
          stopRecording();
        } else if (!isTranscribing) {
          startRecording();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [voiceEnabled, isRecording, isTranscribing, startRecording, stopRecording]);

  // Auto-dismiss STT errors after 5 seconds
  useEffect(() => {
    if (!sttError) return;
    const timer = setTimeout(() => clearTranscript(), 5000);
    return () => clearTimeout(timer);
  }, [sttError, clearTranscript]);

  const hasText = inputText.trim().length > 0;

  const handleSubmit = () => {
    if (!hasText) return;

    if (isAgentRunning) {
      onSendFeedback(inputText);
    } else {
      onSend(inputText);
    }
    setInputText("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Escape-to-stop: global keyboard shortcut
  useEffect(() => {
    if (!isAgentRunning) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onStop();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isAgentRunning, onStop]);

  // Approval overlay replaces the entire input area
  if (pendingApproval) {
    return (
      <div className="p-2 bg-warm-50 dark:bg-warm-900 border-t border-warm-200 dark:border-warm-800">
        <StatusLine />
        <ApprovalOverlay />
      </div>
    );
  }

  // Escalation overlay replaces the entire input area
  if (pendingEscalation) {
    return (
      <div className="p-2 bg-warm-50 dark:bg-warm-900 border-t border-warm-200 dark:border-warm-800">
        <StatusLine />
        <EscalationOverlay />
      </div>
    );
  }

  // Clarification overlay replaces the entire input area
  if (pendingClarification) {
    return (
      <div className="p-2 bg-warm-50 dark:bg-warm-900 border-t border-warm-200 dark:border-warm-800">
        <StatusLine />
        <ClarificationOverlay />
      </div>
    );
  }

  return (
    <div className="bg-warm-50 dark:bg-warm-900 relative border-t border-warm-200 dark:border-warm-800">
      <StatusLine />
      {/* Risk banner when autonomous mode is on */}
      {autonomousMode && !isAgentRunning && (
        <div className="mx-2 mt-1 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-md border border-amber-200 dark:border-amber-800 flex items-center gap-1.5">
          <ShieldAlert size={12} className="shrink-0" />
          <span>Autonomous mode — agent acts without asking</span>
        </div>
      )}
      <div className="p-2">
        {/* Running-state panel: prominent stop + optional feedback input */}
        {isAgentRunning ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 bg-warm-100 dark:bg-warm-800 px-3 py-2 rounded-2xl ring-1 ring-warm-200/60 dark:ring-warm-700/60">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-60 animate-ping" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" />
                  </span>
                  <span className="text-xs font-medium text-warm-700 dark:text-warm-200 truncate">
                    Working on your task...
                  </span>
                </div>
              </div>
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0"
                aria-label="Stop agent"
              >
                <Square size={12} fill="currentColor" />
                Stop
              </button>
            </div>
            {/* Feedback input row */}
            <div className="relative flex items-end gap-1.5 bg-warm-100 dark:bg-warm-800 p-1.5 rounded-2xl ring-1 ring-warm-200/60 dark:ring-warm-700/60 focus-within:ring-warm-300 dark:focus-within:ring-warm-600 transition-all">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Reply to agent..."
                className="w-full bg-transparent border-none outline-none resize-none max-h-[120px] min-h-[36px] py-1.5 text-sm text-warm-800 dark:text-warm-100 placeholder:text-warm-400 dark:placeholder:text-warm-500"
                rows={1}
              />
              {hasText && (
                <button
                  onClick={handleSubmit}
                  className="w-8 h-8 mb-0.5 rounded-full transition-colors flex-shrink-0 flex items-center justify-center bg-amber-500 hover:bg-amber-600 text-white"
                  aria-label="Send feedback"
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
            <p className="text-center text-[10px] text-warm-400 dark:text-warm-500 select-none">
              Press{" "}
              <kbd className="px-1 py-0.5 rounded bg-warm-200/60 dark:bg-warm-700/60 text-warm-500 dark:text-warm-400 font-mono text-[9px]">
                Esc
              </kbd>{" "}
              to stop
            </p>
          </div>
        ) : (
          <>
            <div className="relative flex items-end gap-1.5 bg-warm-100 dark:bg-warm-800 p-1.5 rounded-2xl ring-1 ring-warm-200/60 dark:ring-warm-700/60 focus-within:ring-warm-300 dark:focus-within:ring-warm-600 transition-all">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="What can I help with?"
                className="w-full bg-transparent border-none outline-none resize-none max-h-[120px] min-h-[36px] py-1.5 text-sm text-warm-800 dark:text-warm-100 placeholder:text-warm-400 dark:placeholder:text-warm-500"
                rows={1}
              />
              <div className="flex items-end gap-1">
                {/* Mic button — always visible when voice is enabled (Alt+V) */}
                {voiceEnabled && (
                  <button
                    onClick={() => isRecording ? stopRecording() : startRecording()}
                    disabled={isTranscribing}
                    title={isRecording ? "Stop recording (Alt+V)" : "Voice input (Alt+V)"}
                    className={clsx(
                      "w-8 h-8 mb-0.5 rounded-full transition-colors flex-shrink-0 flex items-center justify-center",
                      isRecording
                        ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
                        : isTranscribing
                          ? "bg-warm-400 text-white cursor-wait"
                          : "bg-warm-300 hover:bg-warm-400 dark:bg-warm-600 dark:hover:bg-warm-500 text-warm-700 dark:text-warm-200",
                    )}
                    aria-label={isRecording ? "Stop recording" : "Start voice input"}
                  >
                    {isTranscribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
                  </button>
                )}
                {/* Send button — appears when text is present */}
                {hasText && (
                  <button
                    onClick={handleSubmit}
                    className="w-8 h-8 mb-0.5 rounded-full transition-colors flex-shrink-0 flex items-center justify-center bg-warm-700 hover:bg-warm-800 dark:bg-warm-300 dark:hover:bg-warm-200 text-white dark:text-warm-900"
                    aria-label="Send message"
                  >
                    <ArrowUp size={16} />
                  </button>
                )}
              </div>
            </div>
            {/* STT status / error */}
            {(sttError || isRecording || isTranscribing) && (
              <div className="px-1 mt-1 flex items-center gap-1.5">
                {sttError ? (
                  <span className="text-[11px] text-red-500 dark:text-red-400">{sttError}</span>
                ) : isRecording ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[11px] text-red-500 dark:text-red-400">Recording... press Alt+V or tap mic to stop</span>
                  </>
                ) : isTranscribing ? (
                  <span className="text-[11px] text-warm-400 dark:text-warm-500">Transcribing...</span>
                ) : null}
              </div>
            )}
            {/* Footer row: autonomy popover */}
            <div className="flex items-center mt-1.5 px-1 relative">
              <div className="relative">
                <button
                  onClick={() => setAutonomyMenuOpen((v) => !v)}
                  className={clsx(
                    "flex items-center gap-1.5 text-[11px] py-0.5 px-1.5 rounded-md transition-colors",
                    autonomousMode
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-warm-500 dark:text-warm-400 hover:text-warm-700 dark:hover:text-warm-200",
                  )}
                >
                  {autonomousMode ? (
                    <Play size={10} className="shrink-0" />
                  ) : (
                    <ShieldCheck size={10} className="shrink-0" />
                  )}
                  <span>{getInteractionModeLabel(interactionMode)}</span>
                  <ChevronDown size={10} className="shrink-0" />
                </button>
                {autonomyMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setAutonomyMenuOpen(false)}
                    />
                    <div className="absolute bottom-full left-0 mb-1.5 w-64 bg-warm-50 dark:bg-warm-800 border border-warm-200 dark:border-warm-700 rounded-lg shadow-lg z-50 overflow-hidden">
                      <button
                        onClick={() => {
                          setInteractionMode("confirm_all");
                          setAutonomyMenuOpen(false);
                        }}
                        className={clsx(
                          "w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                          interactionMode === "confirm_all"
                            ? "bg-warm-100 dark:bg-warm-700/50"
                            : "hover:bg-warm-100 dark:hover:bg-warm-700/30",
                        )}
                      >
                        <ShieldCheck
                          size={14}
                          className="shrink-0 mt-0.5 text-warm-500 dark:text-warm-400"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-warm-800 dark:text-warm-100">
                            Ask before acting
                          </div>
                          <div className="text-[10px] text-warm-500 dark:text-warm-400 mt-0.5">
                            {getInteractionModeDescription("confirm_all")}
                          </div>
                        </div>
                        {interactionMode === "confirm_all" && (
                          <Check
                            size={14}
                            className="shrink-0 mt-0.5 text-primary-500"
                          />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setInteractionMode("confirm_high_risk_only");
                          setAutonomyMenuOpen(false);
                        }}
                        className={clsx(
                          "w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                          interactionMode === "confirm_high_risk_only"
                            ? "bg-warm-100 dark:bg-warm-700/50"
                            : "hover:bg-warm-100 dark:hover:bg-warm-700/30",
                        )}
                      >
                        <ShieldAlert
                          size={14}
                          className="shrink-0 mt-0.5 text-warm-500 dark:text-warm-400"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-warm-800 dark:text-warm-100">
                            Ask for risky actions
                          </div>
                          <div className="text-[10px] text-warm-500 dark:text-warm-400 mt-0.5">
                            {getInteractionModeDescription(
                              "confirm_high_risk_only",
                            )}
                          </div>
                        </div>
                        {interactionMode === "confirm_high_risk_only" && (
                          <Check
                            size={14}
                            className="shrink-0 mt-0.5 text-primary-500"
                          />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setInteractionMode("confirm_plans_only");
                          setAutonomyMenuOpen(false);
                        }}
                        className={clsx(
                          "w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                          interactionMode === "confirm_plans_only"
                            ? "bg-warm-100 dark:bg-warm-700/50"
                            : "hover:bg-warm-100 dark:hover:bg-warm-700/30",
                        )}
                      >
                        <ShieldCheck
                          size={14}
                          className="shrink-0 mt-0.5 text-warm-500 dark:text-warm-400"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-warm-800 dark:text-warm-100">
                            Confirm plans only
                          </div>
                          <div className="text-[10px] text-warm-500 dark:text-warm-400 mt-0.5">
                            {getInteractionModeDescription(
                              "confirm_plans_only",
                            )}
                          </div>
                        </div>
                        {interactionMode === "confirm_plans_only" && (
                          <Check
                            size={14}
                            className="shrink-0 mt-0.5 text-primary-500"
                          />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setInteractionMode("autonomous");
                          setAutonomyMenuOpen(false);
                        }}
                        className={clsx(
                          "w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                          interactionMode === "autonomous"
                            ? "bg-warm-100 dark:bg-warm-700/50"
                            : "hover:bg-warm-100 dark:hover:bg-warm-700/30",
                        )}
                      >
                        <Play
                          size={14}
                          className="shrink-0 mt-0.5 text-warm-500 dark:text-warm-400"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-warm-800 dark:text-warm-100">
                            Act without asking
                          </div>
                          <div className="text-[10px] text-warm-500 dark:text-warm-400 mt-0.5">
                            {getInteractionModeDescription("autonomous")}
                          </div>
                        </div>
                        {interactionMode === "autonomous" && (
                          <Check
                            size={14}
                            className="shrink-0 mt-0.5 text-primary-500"
                          />
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <p className="text-center text-[10px] text-warm-400 dark:text-warm-500 mt-1 select-none">
              AI can make mistakes. Please double-check responses.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
