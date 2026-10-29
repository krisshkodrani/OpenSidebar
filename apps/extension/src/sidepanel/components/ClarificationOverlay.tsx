import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { HelpCircle } from "lucide-react";
import { useStore } from "../store";
import { logger } from "../../utils";
import { uiRuntime } from "../runtime";
import { Button, Card } from "@/ui";

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
        await uiRuntime.sendMessage({
          type: "CLARIFICATION_RESPONSE",
          requestId: crypto.randomUUID(),
          source: uiRuntime.source,
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
    <Card
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="rounded-lg border border-accent/30 bg-accent-subtle p-2.5"
    >
      <div className="flex items-start gap-2 mb-2">
        <HelpCircle
          size={14}
          className="mt-0.5 shrink-0 text-accent-text"
        />
        <div className="min-w-0 flex-1">
          <div
            id={titleId}
            className="text-ui-control font-medium uppercase tracking-[0.08em] text-accent-text"
          >
            Agent needs clarification
          </div>
          <div
            id={descriptionId}
            className="text-ui-control text-accent-text mt-0.5"
          >
            {pending.question}
          </div>
        </div>
      </div>

      {/* Progress bar + countdown */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1 rounded-full bg-accent-subtle overflow-hidden">
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-ui-caption tabular-nums text-accent-text shrink-0">
          {Math.ceil(remainingMs / 1000)}s
        </span>
      </div>

      {/* Suggestion chips */}
      {pending.suggestions && pending.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pending.suggestions.map((suggestion, i) => (
            <Button
              type="button"
              variant="outline"
              size="sm"
              key={i}
              onClick={() => void sendAnswer(suggestion)}
              className="h-auto rounded-full border-accent/30 px-2.5 py-1 text-ui-control text-accent-text hover:bg-accent-subtle"
            >
              {suggestion}
            </Button>
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
          className="flex-1 px-2 py-1.5 text-ui-control border border-accent/30 rounded-md bg-surface text-accent-text placeholder:text-fg-tertiary outline-none focus:ring-1 focus:ring-accent"
          autoFocus
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void sendAnswer(answer)}
          disabled={!answer.trim()}
          className="text-ui-control"
        >
          Submit
        </Button>
      </div>
    </Card>
  );
}
