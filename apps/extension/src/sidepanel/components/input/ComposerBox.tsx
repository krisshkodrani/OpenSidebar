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
    <div className="input-glow relative grid grid-cols-[minmax(0,1fr)_auto] items-end gap-1.5 rounded-2xl bg-surface-subtle p-1.5 ring-1 ring-line transition-colors">
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
                ? "bg-danger-subtle text-danger hover:bg-danger/90"
                : "text-fg-tertiary hover:bg-surface",
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
            "mb-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-accent-fg transition-colors",
            isGuidance
              ? "bg-accent"
              : "bg-fg",
            hasText
              ? isGuidance
                ? "hover:bg-accent-hover"
                : "hover:bg-fg"
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
