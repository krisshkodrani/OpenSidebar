import React, { useCallback } from "react";
import { Loader2, Pause, Play, ClipboardList } from "lucide-react";
import { useStore } from "../store";
import { AgentStatus, MessageSource, SessionMetrics } from "../../types";
import { logger } from "../../utils";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

function costLabel(metrics: SessionMetrics): string {
  const mode =
    metrics.costMode ??
    (metrics.totalCost > 0
      ? (metrics.totalCostEstimated ?? 0) > 0 &&
        (metrics.totalCostActual ?? 0) > 0
        ? "mixed"
        : (metrics.totalCostEstimated ?? 0) > 0
          ? "estimated"
          : "actual"
      : "none");
  const suffix = mode === "estimated" ? " est." : mode === "mixed" ? " ~" : "";
  return `${formatCost(metrics.totalCost)}${suffix}`;
}

function statusConfig(status: AgentStatus, isStalled: boolean) {
  if (isStalled) {
    return {
      color: "text-amber-600 dark:text-amber-400",
      dotColor: "bg-amber-500",
      label: "Stalled",
    };
  }
  switch (status) {
    case AgentStatus.THINKING:
      return {
        color: "text-blue-600 dark:text-blue-400",
        dotColor: "bg-blue-500",
        label: "Thinking",
      };
    case AgentStatus.ACTING:
      return {
        color: "text-emerald-600 dark:text-emerald-400",
        dotColor: "bg-emerald-500",
        label: "Acting",
      };
    case AgentStatus.WAITING_FOR_PAGE_LOAD:
      return {
        color: "text-amber-600 dark:text-amber-400",
        dotColor: "bg-amber-500",
        label: "Waiting",
      };
    case AgentStatus.PAUSED:
      return {
        color: "text-yellow-600 dark:text-yellow-400",
        dotColor: "bg-yellow-500",
        label: "Paused",
      };
    case AgentStatus.ERROR:
      return {
        color: "text-red-600 dark:text-red-400",
        dotColor: "bg-red-500",
        label: "Error",
      };
    default:
      return {
        color: "text-warm-500 dark:text-warm-400",
        dotColor: "bg-warm-400",
        label: "Ready",
      };
  }
}

export function StatusLine() {
  const status = useStore((s) => s.agentStatus);
  const detail = useStore((s) => s.statusDetail);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const turnProgress = useStore((s) => s.turnProgress);
  const sessionMetrics = useStore((s) => s.sessionMetrics);
  const showSessionMetrics = useStore((s) => s.settings.showSessionMetrics);
  const stagnationState = useStore((s) => s.stagnationState);
  const taskProgress = useStore((s) => s.taskProgress);
  const taskCompletion = useStore((s) => s.taskCompletion);
  const togglePlanBoard = useStore((s) => s.togglePlanBoard);

  const isStalled = !!stagnationState;
  const cfg = statusConfig(status, isStalled);
  const isPaused = status === AgentStatus.PAUSED;
  const canPause =
    status === AgentStatus.THINKING ||
    status === AgentStatus.ACTING ||
    status === AgentStatus.WAITING_FOR_PAGE_LOAD;

  const handlePause = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "PAUSE_AGENT",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: { workspaceId: useStore.getState().activeWorkspaceId },
      });
    } catch (e) {
      logger.error("ui", "Failed to pause agent", { error: e });
    }
  }, []);

  const handleResume = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "RESUME_AGENT",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: { workspaceId: useStore.getState().activeWorkspaceId },
      });
    } catch (e) {
      logger.error("ui", "Failed to resume agent", { error: e });
    }
  }, []);

  // Only show when agent is active or has just finished
  if (!isAgentRunning && status === AgentStatus.IDLE && !taskCompletion)
    return null;

  const statusLabel = isStalled
    ? `Stalled (${stagnationState!.stagnantTurns} turns)`
    : isPaused
      ? "Paused"
      : detail;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] leading-none select-none">
      {/* Spinner or dot */}
      {status !== AgentStatus.IDLE &&
      status !== AgentStatus.ERROR &&
      status !== AgentStatus.PAUSED &&
      !isStalled ? (
        <Loader2 size={10} className={`animate-spin shrink-0 ${cfg.color}`} />
      ) : (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dotColor}`} />
      )}

      {/* Status label */}
      <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>

      {/* Detail text */}
      <span className="truncate text-warm-500 dark:text-warm-400 min-w-0">
        {statusLabel}
      </span>

      {/* Provider badge */}
      {turnProgress?.provider && (
        <span className="shrink-0 rounded border border-warm-200 dark:border-warm-700 px-1 py-px text-[9px] text-warm-500 dark:text-warm-400 bg-warm-50/70 dark:bg-warm-900/40">
          {turnProgress.provider}
        </span>
      )}

      {/* Metrics */}
      {showSessionMetrics &&
        sessionMetrics &&
        sessionMetrics.totalTokens > 0 && (
          <span className="shrink-0 tabular-nums text-warm-400 dark:text-warm-500">
            {formatTokens(sessionMetrics.totalTokens)}
            {sessionMetrics.totalCost > 0
              ? ` ${costLabel(sessionMetrics)}`
              : ""}
          </span>
        )}

      {/* Turn counter */}
      {turnProgress && (
        <span className="shrink-0 tabular-nums text-warm-500 dark:text-warm-400">
          {turnProgress.turn}/{turnProgress.maxTurns}
        </span>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Pause/Resume */}
      {canPause && (
        <button
          onClick={handlePause}
          className="p-0.5 rounded hover:bg-warm-200 dark:hover:bg-warm-700 text-warm-500 dark:text-warm-400"
          aria-label="Pause agent"
        >
          <Pause size={10} />
        </button>
      )}
      {isPaused && (
        <button
          onClick={handleResume}
          className="p-0.5 rounded hover:bg-warm-200 dark:hover:bg-warm-700 text-warm-500 dark:text-warm-400"
          aria-label="Resume agent"
        >
          <Play size={10} />
        </button>
      )}

      {/* Plan pill */}
      {taskCompletion ? (
        <button
          onClick={togglePlanBoard}
          className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-px text-[9px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
          aria-label="Toggle plan"
        >
          <ClipboardList size={8} />
          Done {taskCompletion.subtaskResults.length}/
          {taskCompletion.subtaskResults.length}
        </button>
      ) : taskProgress ? (
        <button
          onClick={togglePlanBoard}
          className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/20 px-1.5 py-px text-[9px] font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-colors"
          aria-label="Toggle plan"
        >
          <ClipboardList size={8} />
          Plan {taskProgress.currentIndex + 1}/{taskProgress.subtasks.length}
        </button>
      ) : null}
    </div>
  );
}
