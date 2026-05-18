import React from "react";
import { ArrowUp, Loader2, Mic, Square } from "lucide-react";
import { clsx } from "clsx";
import { ComposerTextarea } from "./ComposerTextarea";
import type { SpeechRecorderState } from "../../hooks/useSpeechRecorder";

export function ComposerBox({
  hasText,
  inputRef,
  isGuidance,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  onSpeechToggle,
  onSubmit,
  placeholder,
  speechState = "idle",
  value,
}: {
  hasText: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  isGuidance: boolean;
  onBlur: () => void;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSpeechToggle?: () => void;
  onSubmit: () => void;
  placeholder: string;
  speechState?: SpeechRecorderState;
  value: string;
}) {
  const speechActive =
    speechState === "recording" || speechState === "requesting";
  const speechBusy = speechState === "transcribing";
  const SpeechIcon = speechBusy ? Loader2 : speechActive ? Square : Mic;
  return (
    <div className="input-glow relative grid grid-cols-[minmax(0,1fr)_auto] items-end gap-1.5 rounded-2xl bg-warm-100 p-1.5 ring-1 ring-warm-200/60 transition-colors dark:bg-warm-800 dark:ring-warm-700/60">
      <ComposerTextarea
        inputRef={inputRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
      />
      <div className="flex items-end gap-1">
        {onSpeechToggle ? (
          <button
            type="button"
            onClick={onSpeechToggle}
            disabled={speechBusy}
            className={clsx(
              "mb-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-60",
              speechActive
                ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-200 dark:hover:bg-red-900/50"
                : "text-warm-500 hover:bg-white/80 dark:text-warm-300 dark:hover:bg-warm-700",
            )}
            aria-label={speechActive ? "Stop dictation" : "Start dictation"}
            title={speechActive ? "Stop dictation" : "Start dictation"}
          >
            <SpeechIcon
              size={16}
              className={speechBusy ? "animate-spin" : undefined}
            />
          </button>
        ) : null}
        <button
          onClick={onSubmit}
          disabled={!hasText}
          className={clsx(
            "mb-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white transition-colors",
            isGuidance
              ? "bg-primary-600"
              : "bg-warm-700 dark:bg-warm-300 dark:text-warm-900",
            hasText
              ? isGuidance
                ? "hover:bg-primary-700"
                : "hover:bg-warm-800 dark:hover:bg-warm-200"
              : "pointer-events-none opacity-0",
          )}
          aria-label={isGuidance ? "Send guidance" : "Send message"}
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
