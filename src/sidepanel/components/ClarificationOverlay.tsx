import React, { useCallback, useEffect, useMemo, useState } from "react";
import { HelpCircle } from "lucide-react";
import { MessageSource } from "../../types";
import { useStore } from "../store";
import { logger } from "../../utils";

export function ClarificationOverlay() {
  const pending = useStore((s) => s.pendingClarification);
  const clearPending = useStore((s) => s.clearPendingClarification);
  const [answer, setAnswer] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());

  const remainingMs = useMemo(() => {
    if (!pending) return 0;
    const elapsed = nowMs - pending.requestedAt;
    return Math.max(0, pending.timeoutMs - elapsed);
  }, [pending, nowMs]);

  const progressPct = useMemo(() => {
    if (!pending || pending.timeoutMs <= 0) return 0;
    return Math.max(0, Math.min(100, (remainingMs / pending.timeoutMs) * 100));
  }, [pending, remainingMs]);

  useEffect(() => {
    if (!pending) return;
    setNowMs(Date.now());
    setAnswer("");

    const tick = setInterval(() => setNowMs(Date.now()), 250);
    const elapsed = Date.now() - pending.requestedAt;
    const timeoutRemaining = Math.max(0, pending.timeoutMs - elapsed);
    const timeout = setTimeout(() => {
      clearPending();
    }, timeoutRemaining);

    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
    };
  }, [pending, clearPending]);

  const sendAnswer = useCallback(
    async (text: string) => {
      if (!pending || !text.trim()) return;
      try {
        await chrome.runtime.sendMessage({
          type: "CLARIFICATION_RESPONSE",
          requestId: crypto.randomUUID(),
          source: MessageSource.SIDEPANEL,
          workspaceId: useStore.getState().activeWorkspaceId,
          payload: {
            clarificationId: pending.clarificationId,
            answer: text.trim(),
          },
        });
      } catch (error) {
        logger.error("ui", "Failed to send clarification response", { error });
      } finally {
        clearPending();
        setAnswer("");
      }
    },
    [pending, clearPending],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendAnswer(answer);
    }
  };

  if (!pending) return null;

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-900/20 p-2.5">
      <div className="flex items-start gap-2 mb-2">
        <HelpCircle
          size={14}
          className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400"
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-blue-800 dark:text-blue-200">
            Agent needs clarification
          </div>
          <div className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
            {pending.question}
          </div>
        </div>
      </div>

      {/* Progress bar + countdown */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1 rounded-full bg-blue-100 dark:bg-blue-950/40 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-[width] duration-200"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
          {Math.ceil(remainingMs / 1000)}s
        </span>
      </div>

      {/* Suggestion chips */}
      {pending.suggestions && pending.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pending.suggestions.map((suggestion, i) => (
            <button
              key={i}
              onClick={() => void sendAnswer(suggestion)}
              className="rounded-full border border-blue-300 dark:border-blue-700 px-2.5 py-1 text-xs text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* Text input + submit */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer..."
          className="flex-1 px-2 py-1.5 text-xs border border-blue-200 dark:border-blue-700 rounded-md bg-white dark:bg-blue-950/30 text-blue-800 dark:text-blue-200 placeholder:text-blue-400 dark:placeholder:text-blue-600 outline-none focus:ring-1 focus:ring-blue-400"
          autoFocus
        />
        <button
          onClick={() => void sendAnswer(answer)}
          disabled={!answer.trim()}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
