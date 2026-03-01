import React, { useRef, useEffect, useCallback, useState } from "react";
import { StopCircle, Mic, Loader2, ArrowUp } from "lucide-react";
import { useStore } from "../store";
import { useSpeechToText } from "../hooks/useSpeechToText";
import { StatusLine } from "./StatusLine";
import { ApprovalOverlay } from "./ApprovalOverlay";
import { EscalationOverlay } from "./EscalationOverlay";
import {
  isSlashCommand,
  getCommandCompletions,
  CommandHint,
} from "../slash-commands";

import { clsx } from "clsx";

export function InputArea({
  onSend,
  onSendFeedback,
  onSendAnnotation,
  onManualCommand,
  onStop,
}: {
  onSend: (text: string) => void;
  onSendFeedback: (text: string) => void;
  onSendAnnotation: (text: string) => void;
  onManualCommand: (text: string) => void;
  onStop: () => void;
}) {
  const inputText = useStore((s) => s.inputText);
  const setInputText = useStore((s) => s.setInputText);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const demoRecording = useStore((s) => s.demoRecording);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const pendingEscalation = useStore((s) => s.pendingEscalation);
  const groqApiKey = useStore((s) => s.settings.groqApiKey);
  const manualRecording = useStore((s) => s.manualRecording);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevHeightRef = useRef<number>(0);
  const interimRef = useRef<string>("");
  const [completions, setCompletions] = useState<CommandHint[]>([]);
  const [selectedCompletion, setSelectedCompletion] = useState(0);

  // Speech-to-text hook
  const handleTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      const current = useStore.getState().inputText;
      if (isFinal) {
        const withoutInterim = interimRef.current
          ? current.slice(0, current.length - interimRef.current.length)
          : current;
        interimRef.current = "";
        const separator =
          withoutInterim && !withoutInterim.endsWith(" ") ? " " : "";
        setInputText(withoutInterim + separator + text);
      } else {
        const withoutInterim = interimRef.current
          ? current.slice(0, current.length - interimRef.current.length)
          : current;
        const separator =
          withoutInterim && !withoutInterim.endsWith(" ") ? " " : "";
        interimRef.current = separator + text;
        setInputText(withoutInterim + interimRef.current);
      }
    },
    [setInputText],
  );

  const speech = useSpeechToText(groqApiKey, handleTranscript);

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

  const hasText = inputText.trim().length > 0;

  const handleSubmit = () => {
    if (!hasText) return;
    if (speech.isRecording) speech.stop();
    interimRef.current = "";
    setCompletions([]);

    // Route slash commands (only when agent is not running)
    if (isSlashCommand(inputText) && !isAgentRunning) {
      onManualCommand(inputText);
      setInputText("");
      return;
    }

    if (demoRecording && !isAgentRunning) {
      onSendAnnotation(inputText);
    } else if (isAgentRunning) {
      onSendFeedback(inputText);
    } else {
      onSend(inputText);
    }
    setInputText("");
  };

  // Update autocomplete on input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    if (val.trim().startsWith("/") && !isAgentRunning) {
      const hints = getCommandCompletions(val.trim());
      setCompletions(hints);
      setSelectedCompletion(0);
    } else {
      setCompletions([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Autocomplete: Tab to accept, Escape to dismiss, arrow keys to navigate
    if (completions.length > 0) {
      if (e.key === "Tab") {
        e.preventDefault();
        const hint = completions[selectedCompletion];
        if (hint) {
          setInputText(hint.name + " ");
          setCompletions([]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCompletions([]);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedCompletion((i) => Math.min(i + 1, completions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedCompletion((i) => Math.max(i - 1, 0));
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

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

  return (
    <div className="p-2 bg-warm-50 dark:bg-warm-900 relative">
      <StatusLine />
      {manualRecording && (
        <div className="mb-1 px-2 py-1 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md border border-red-200 dark:border-red-800 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          Recording: {manualRecording.name} ({manualRecording.turnCount} turns)
        </div>
      )}
      <div className="relative flex items-end gap-1.5 bg-warm-100 dark:bg-warm-800 p-1.5 rounded-xl ring-1 ring-transparent focus-within:ring-primary-500 transition-all">
        {completions.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-1 bg-warm-50 dark:bg-warm-800 border border-warm-200 dark:border-warm-700 rounded-lg shadow-lg overflow-hidden z-50">
            {completions.map((hint, i) => (
              <button
                key={hint.name}
                className={clsx(
                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2",
                  i === selectedCompletion
                    ? "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                    : "text-warm-600 dark:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-700",
                )}
                onClick={() => {
                  setInputText(hint.name + " ");
                  setCompletions([]);
                  textareaRef.current?.focus();
                }}
              >
                <span className="font-mono font-medium">{hint.name}</span>
                <span className="text-warm-400 dark:text-warm-500 truncate">
                  {hint.description}
                </span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            demoRecording && !isAgentRunning
              ? "Add annotation..."
              : isAgentRunning
                ? "Send feedback..."
                : "Ask OpenSidebar..."
          }
          className="w-full bg-transparent border-none outline-none resize-none max-h-[120px] min-h-[36px] py-1.5 text-sm text-warm-800 dark:text-warm-100 placeholder:text-warm-500"
          rows={1}
        />
        <div className="flex items-end gap-1">
          {/* Mic button */}
          {speech.isSupported && (
            <button
              onClick={() => {
                if (speech.isRecording) interimRef.current = "";
                speech.toggle();
              }}
              disabled={speech.isProcessing}
              className={clsx(
                "p-1.5 mb-0.5 rounded-lg transition-colors flex-shrink-0",
                speech.isProcessing
                  ? "text-warm-400 cursor-wait"
                  : speech.isRecording
                    ? "bg-red-500 text-white mic-recording"
                    : "text-warm-400 hover:text-warm-600 dark:hover:text-warm-300",
              )}
              aria-label={
                speech.isRecording ? "Stop recording" : "Start voice input"
              }
            >
              {speech.isProcessing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Mic size={16} />
              )}
            </button>
          )}
          {/* Stop button — only when agent is running */}
          {isAgentRunning && (
            <button
              onClick={onStop}
              className="p-1.5 mb-0.5 text-white rounded-lg transition-colors flex-shrink-0 bg-red-500 hover:bg-red-600"
              aria-label="Stop generation"
            >
              <StopCircle size={16} />
            </button>
          )}
          {/* Send button — appears when text is present */}
          {hasText && (
            <button
              onClick={handleSubmit}
              className={clsx(
                "p-1.5 mb-0.5 rounded-full transition-colors flex-shrink-0",
                demoRecording && !isAgentRunning
                  ? "bg-violet-500 hover:bg-violet-600 text-white"
                  : isAgentRunning
                    ? "bg-amber-500 hover:bg-amber-600 text-white"
                    : "bg-primary-600 hover:bg-primary-700 text-white",
              )}
              aria-label={
                demoRecording && !isAgentRunning
                  ? "Send annotation"
                  : isAgentRunning
                    ? "Send feedback"
                    : "Send message"
              }
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      {speech.error && (
        <p className="text-xs text-red-500 mt-1 px-1">{speech.error}</p>
      )}
    </div>
  );
}
