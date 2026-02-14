import React, { useRef, useEffect, useCallback, useState } from "react";
import { Send, StopCircle, MessageCircle, Mic, Loader2, Bookmark } from "lucide-react";
import { useStore } from "../store";
import { useSpeechToText } from "../hooks/useSpeechToText";
import { PromptPicker } from "./PromptPicker";

import { clsx } from "clsx";

export function InputArea({
  onSend,
  onSendHint,
  onStop,
  onOpenSavedPrompts,
  onSaveCurrent,
}: {
  onSend: (text: string) => void;
  onSendHint: (text: string) => void;
  onStop: () => void;
  onOpenSavedPrompts: () => void;
  onSaveCurrent: () => void;
}) {
  const inputText = useStore((s) => s.inputText);
  const setInputText = useStore((s) => s.setInputText);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const awaitingPlanApproval = useStore((s) => s.awaitingPlanApproval);
  const speechProvider = useStore((s) => s.settings.speechProvider);
  const groqApiKey = useStore((s) => s.settings.groqApiKey);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevHeightRef = useRef<number>(0);
  const interimRef = useRef<string>("");

  // Speech-to-text hook
  const handleTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      const current = useStore.getState().inputText;
      if (isFinal) {
        // Replace interim text with final, then clear interim
        const withoutInterim = interimRef.current
          ? current.slice(0, current.length - interimRef.current.length)
          : current;
        interimRef.current = "";
        const separator = withoutInterim && !withoutInterim.endsWith(" ") ? " " : "";
        setInputText(withoutInterim + separator + text);
      } else {
        // Replace previous interim with new interim
        const withoutInterim = interimRef.current
          ? current.slice(0, current.length - interimRef.current.length)
          : current;
        const separator = withoutInterim && !withoutInterim.endsWith(" ") ? " " : "";
        interimRef.current = separator + text;
        setInputText(withoutInterim + interimRef.current);
      }
    },
    [setInputText],
  );

  const speech = useSpeechToText(speechProvider, groqApiKey, handleTranscript);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Smooth auto-resize: measure with transition disabled, then animate
  const MAX_HEIGHT = 120;
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Store previous height
    const prev = prevHeightRef.current;

    // Disable transition and measure
    el.style.transition = "none";
    el.style.overflowY = "hidden";
    el.style.height = "0px";
    const scrollH = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = (prev || scrollH) + "px";

    // Force reflow, then re-enable transition
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
    // Stop recording on send
    if (speech.isRecording) speech.stop();
    interimRef.current = "";
    if (isAgentRunning) {
      onSendHint(inputText);
    } else {
      onSend(inputText);
    }
    setInputText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="p-2 bg-surface-light dark:bg-surface-dark relative">
      <PromptPicker
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onSelect={(content) => {
          setInputText(content);
          setIsPickerOpen(false);
        }}
        onManage={() => {
          setIsPickerOpen(false);
          onOpenSavedPrompts();
        }}
        onSaveCurrent={() => {
          setIsPickerOpen(false);
          onSaveCurrent();
        }}
        hasInputText={hasText}
      />
      <div className="relative flex items-end gap-2 bg-warm-100 dark:bg-warm-800 p-1.5 rounded-xl ring-1 ring-transparent focus-within:ring-primary-500 transition-all">
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            awaitingPlanApproval
              ? "Send corrections or click Approve..."
              : isAgentRunning
                ? "Send a hint..."
                : "Ask OpenSidebar..."
          }
          className="w-full bg-transparent border-none outline-none resize-none max-h-[120px] min-h-[36px] py-1.5 text-sm text-warm-800 dark:text-warm-100 placeholder:text-warm-500"
          rows={1}
        />
        <div className="flex items-end gap-1">
          {/* Saved prompts button */}
          <button
            onClick={() => setIsPickerOpen(!isPickerOpen)}
            className="p-1.5 mb-0.5 rounded-lg transition-colors flex-shrink-0 text-warm-400 hover:text-warm-600 dark:hover:text-warm-300"
            aria-label="Saved prompts"
          >
            <Bookmark size={16} />
          </button>
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
              aria-label={speech.isRecording ? "Stop recording" : "Start voice input"}
            >
              {speech.isProcessing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Mic size={16} />
              )}
            </button>
          )}
          {/* Send / Stop button */}
          {isAgentRunning && !hasText ? (
            <button
              onClick={onStop}
              className="p-1.5 mb-0.5 text-white rounded-lg transition-colors flex-shrink-0 bg-red-500 hover:bg-red-600"
              aria-label="Stop generation"
            >
              <StopCircle size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!hasText}
              className={clsx(
                "p-1.5 mb-0.5 text-white rounded-lg transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed",
                isAgentRunning
                  ? "bg-amber-500 hover:bg-amber-600"
                  : "bg-primary-600 hover:bg-primary-700",
              )}
              aria-label={isAgentRunning ? "Send hint" : "Send message"}
            >
              {isAgentRunning ? (
                <MessageCircle size={16} />
              ) : (
                <Send size={16} />
              )}
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
