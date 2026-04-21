import React, { useCallback, useId, useMemo } from "react";
import { AlertTriangle, ArrowRight, SkipForward, Square } from "lucide-react";
import { MessageSource } from "../../types";
import { useStore } from "../store";
import { logger } from "../../utils";

function describeLocation(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

export function StalledRecoveryCard() {
  const stagnationState = useStore((s) => s.stagnationState);
  const taskProgress = useStore((s) => s.taskProgress);
  const setInputText = useStore((s) => s.setInputText);
  const clearStagnationState = useStore((s) => s.clearStagnationState);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const titleId = useId();
  const descriptionId = useId();

  const location = useMemo(
    () => (stagnationState ? describeLocation(stagnationState.url) : ""),
    [stagnationState],
  );

  const dismissWarning = useCallback(() => {
    clearStagnationState();
  }, [clearStagnationState]);

  const guideAgent = useCallback(() => {
    setInputText(
      "Try a different approach here. Avoid repeating the last action and explain the new plan.",
    );
    clearStagnationState();
  }, [setInputText, clearStagnationState]);

  const skipStep = useCallback(async () => {
    if (!taskProgress) return;
    try {
      await chrome.runtime.sendMessage({
        type: "SKIP_SUBTASK",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        workspaceId: activeWorkspaceId,
        payload: { taskId: taskProgress.taskId },
      });
      clearStagnationState();
    } catch (error) {
      logger.error("ui", "Failed to send skip subtask request", { error });
    }
  }, [taskProgress, activeWorkspaceId, clearStagnationState]);

  const stopAgent = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "STOP_AGENT",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: { workspaceId: activeWorkspaceId },
      });
      clearStagnationState();
    } catch (error) {
      logger.error("ui", "Failed to stop agent from stalled card", { error });
    }
  }, [activeWorkspaceId, clearStagnationState]);

  if (!stagnationState) return null;

  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="mx-4 mt-2 rounded-xl border border-amber-300/90 bg-amber-50/90 px-3 py-3 shadow-sm dark:border-amber-800 dark:bg-amber-900/20"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          size={15}
          className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="min-w-0 flex-1">
          <div
            id={titleId}
            className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300"
          >
            Agent may be stuck
          </div>
          <div
            id={descriptionId}
            className="mt-1 text-sm font-medium leading-snug text-amber-900 dark:text-amber-100"
          >
            The current run repeated similar turns on {location || "this page"}.
          </div>
          <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            You can let it continue, steer it with new guidance, skip the current
            step, or stop the run.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={dismissWarning}
              className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/30"
            >
              Keep going
            </button>
            <button
              onClick={guideAgent}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600"
            >
              <ArrowRight size={11} />
              Guide agent
            </button>
            {taskProgress ? (
              <button
                onClick={() => void skipStep()}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/30"
              >
                <SkipForward size={11} />
                Skip step
              </button>
            ) : null}
            <button
              onClick={() => void stopAgent()}
              className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20"
            >
              <Square size={10} fill="currentColor" />
              Stop
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
