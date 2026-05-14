import React from "react";
import { Mic } from "lucide-react";
import { clsx } from "clsx";

export function VoiceControlButton({
  isGuidance,
  isListening,
  onToggle,
  status,
}: {
  isGuidance: boolean;
  isListening: boolean;
  onToggle: () => void;
  status: "idle" | "connecting" | "ready" | "listening" | "error";
}) {
  return (
    <button
      onClick={onToggle}
      disabled={status === "connecting"}
      title={
        isListening
          ? "Release OpenAI Realtime voice (Alt+V)"
          : isGuidance
            ? "OpenAI Realtime guidance (Alt+V)"
            : "OpenAI Realtime voice (Alt+V)"
      }
      className={clsx(
        "mb-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors",
        isListening
          ? "animate-pulse bg-red-500 text-white hover:bg-red-600"
          : status === "connecting"
            ? "cursor-wait bg-warm-400 text-white"
            : "bg-warm-300 text-warm-700 hover:bg-warm-400 dark:bg-warm-600 dark:text-warm-200 dark:hover:bg-warm-500",
      )}
      aria-label={isListening ? "Stop Realtime voice" : "Start Realtime voice"}
    >
      <Mic size={16} />
    </button>
  );
}
