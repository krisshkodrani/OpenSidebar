import React, { useCallback, useId, useMemo } from "react";
import { AlertTriangle, ArrowRight, SkipForward, Square } from "lucide-react";
import { useStore } from "../store";
import { logger } from "../../utils";
import { uiRuntime } from "../runtime";

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
      await uiRuntime.sendMessage({
        type: "SKIP_SUBTASK",
        requestId: crypto.randomUUID(),
        source: uiRuntime.source,
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
      await uiRuntime.sendMessage({
        type: "STOP_AGENT",
        requestId: crypto.randomUUID(),
        source: uiRuntime.source,
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
      className="mx-4 mt-2 rounded-xl border border-warning/30 bg-warning-subtle px-3 py-3 shadow-sm"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          size={15}
          className="mt-0.5 shrink-0 text-warning"
        />
        <div className="min-w-0 flex-1">
          <div
            id={titleId}
            className="text-ui-control font-semibold uppercase tracking-[0.08em] text-warning"
          >
            Agent may be stuck
          </div>
          <div
            id={descriptionId}
            className="mt-1 text-ui-body font-medium leading-snug text-warning"
          >
            The current run repeated similar turns on {location || "this page"}.
          </div>
          <p className="mt-1 text-ui-control leading-relaxed text-warning">
            You can let it continue, steer it with new guidance, skip the current
            step, or stop the run.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={dismissWarning}
              className="rounded-lg border border-warning/30 px-2.5 py-1.5 text-ui-control font-medium text-warning transition-colors hover:bg-warning-subtle"
            >
              Keep going
            </button>
            <button
              onClick={guideAgent}
              className="inline-flex items-center gap-1 rounded-lg bg-warning px-2.5 py-1.5 text-ui-control font-medium text-canvas transition-colors hover:bg-warning/90"
            >
              <ArrowRight size={11} />
              Guide agent
            </button>
            {taskProgress ? (
              <button
                onClick={() => void skipStep()}
                className="inline-flex items-center gap-1 rounded-lg border border-warning/30 px-2.5 py-1.5 text-ui-control font-medium text-warning transition-colors hover:bg-warning-subtle"
              >
                <SkipForward size={11} />
                Skip step
              </button>
            ) : null}
            <button
              onClick={() => void stopAgent()}
              className="inline-flex items-center gap-1 rounded-lg border border-danger/30 px-2.5 py-1.5 text-ui-control font-medium text-danger transition-colors hover:bg-danger-subtle"
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
