import React, { useRef, useEffect } from "react";
import { Send, StopCircle } from "lucide-react";
import { useStore } from "../store";

import { clsx } from "clsx";

export function InputArea({
  onSend,
  onStop,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const inputText = useStore((s) => s.inputText);
  const setInputText = useStore((s) => s.setInputText);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "0px";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [inputText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Prevent submission if empty but allow stop? No, stop is click only usually.
      if (isAgentRunning) return;

      if (inputText.trim()) {
        onSend(inputText);
        setInputText("");
      }
    }
  };

  return (
    <div className="p-3 border-t border-gray-200 dark:border-gray-800 bg-surface-light dark:bg-surface-dark">
      <div className="relative flex items-end gap-2 bg-gray-100 dark:bg-gray-800 p-1.5 rounded-xl ring-1 ring-transparent focus-within:ring-primary-500 transition-all">
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isAgentRunning ? "Agent is processing..." : "Ask OpenSidebar..."
          }
          className="w-full bg-transparent border-none outline-none resize-none max-h-[120px] min-h-[36px] overflow-y-auto py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500"
          rows={1}
          disabled={isAgentRunning}
        />
        <button
          onClick={() => {
            if (isAgentRunning) {
              onStop();
            } else if (inputText.trim()) {
              onSend(inputText);
              setInputText("");
            }
          }}
          disabled={!inputText.trim() && !isAgentRunning}
          className={clsx(
            "p-1.5 mb-0.5 text-white rounded-lg transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed",
            isAgentRunning
              ? "bg-red-500 hover:bg-red-600"
              : "bg-primary-600 hover:bg-primary-700",
          )}
          aria-label={isAgentRunning ? "Stop generation" : "Send message"}
        >
          {isAgentRunning ? <StopCircle size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
