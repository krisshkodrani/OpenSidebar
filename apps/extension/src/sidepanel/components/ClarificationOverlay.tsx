import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { HelpCircle } from "lucide-react";
import { MessageSource } from "../../types";
import { useStore } from "../store";
import { logger } from "../../utils";

export function ClarificationOverlay() {
  const pending = useStore((s) => s.pendingClarification);
  const clearPending = useStore((s) => s.clearPendingClarification);
  const [answer, setAnswer] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const titleId = useId();
  const descriptionId = useId();

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
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50/80 dark:bg-primary-900/20 p-2.5"
    >
      <div className="flex items-start gap-2 mb-2">
        <HelpCircle
          size={14}
          className="mt-0.5 shrink-0 text-primary-600 dark:text-primary-400"
        />
        <div className="min-w-0 flex-1">
          <div
            id={titleId}
            className="text-xs font-medium uppercase tracking-[0.08em] text-primary-800 dark:text-primary-200"
          >
            Agent needs clarification
          </div>
          <div
            id={descriptionId}
            className="text-xs text-primary-700 dark:text-primary-300 mt-0.5"
          >
            {pending.question}
          </div>
        </div>
      </div>

      {/* Progress bar + countdown */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1 rounded-full bg-primary-100 dark:bg-primary-950/30 overflow-hidden">
          <div
            className="h-full bg-primary-500 transition-[width] duration-200"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-primary-600 dark:text-primary-400 shrink-0">
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
              className="rounded-full border border-primary-300 dark:border-primary-700 px-2.5 py-1 text-xs text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
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
          className="flex-1 px-2 py-1.5 text-xs border border-primary-200 dark:border-primary-700 rounded-md bg-white dark:bg-primary-950/20 text-primary-800 dark:text-primary-200 placeholder:text-primary-400 dark:placeholder:text-primary-500 outline-none focus:ring-1 focus:ring-primary-400"
          autoFocus
        />
        <button
          onClick={() => void sendAnswer(answer)}
          disabled={!answer.trim()}
          className="rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
