import React, { useRef, useEffect } from "react";
import { Send, StopCircle, MessageCircle } from "lucide-react";
import { useStore } from "../store";

import { clsx } from "clsx";

export function InputArea({
  onSend,
  onSendHint,
  onStop,
}: {
  onSend: (text: string) => void;
  onSendHint: (text: string) => void;
  onStop: () => void;
}) {
  const inputText = useStore((s) => s.inputText);
  const setInputText = useStore((s) => s.setInputText);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize: hide overflow during measurement to prevent scrollbar-induced inflation
  const MAX_HEIGHT = 120;
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.overflowY = "hidden";
    el.style.height = "0px";
    const scrollH = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = scrollH + "px";
    el.style.overflowY = scrollH >= MAX_HEIGHT ? "auto" : "hidden";
  }, [inputText]);

  const hasText = inputText.trim().length > 0;

  const handleSubmit = () => {
    if (!hasText) return;
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
    <div className="p-2 bg-surface-light dark:bg-surface-dark">
      <div className="relative flex items-end gap-2 bg-gray-100 dark:bg-gray-800 p-1.5 rounded-xl ring-1 ring-transparent focus-within:ring-primary-500 transition-all">
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isAgentRunning ? "Send a hint..." : "Ask OpenSidebar..."
          }
          className="w-full bg-transparent border-none outline-none resize-none max-h-[120px] min-h-[36px] py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500"
          rows={1}
        />
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
  );
}
