import React, { useCallback } from "react";
import { AlertCircle, Loader2, Pause, Play } from "lucide-react";
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
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
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
  const suffix =
    mode === "estimated" ? " est." : mode === "mixed" ? " mixed" : "";
  return `${formatCost(metrics.totalCost)}${suffix}`;
}

function statusTone(status: AgentStatus): {
  container: string;
  text: string;
  label: string;
} {
  switch (status) {
    case AgentStatus.THINKING:
      return {
        container:
          "bg-blue-50/90 dark:bg-blue-900/20 border-blue-200 dark:border-blue-900/50",
        text: "text-blue-700 dark:text-blue-300",
        label: "Thinking",
      };
    case AgentStatus.ACTING:
      return {
        container:
          "bg-emerald-50/90 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900/50",
        text: "text-emerald-700 dark:text-emerald-300",
        label: "Acting",
      };
    case AgentStatus.WAITING_FOR_PAGE_LOAD:
      return {
        container:
          "bg-amber-50/90 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900/50",
        text: "text-amber-800 dark:text-amber-300",
        label: "Waiting",
      };
    case AgentStatus.PAUSED:
      return {
        container:
          "bg-yellow-50/90 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-900/50",
        text: "text-yellow-800 dark:text-yellow-300",
        label: "Paused",
      };
    case AgentStatus.ERROR:
      return {
        container:
          "bg-red-50/90 dark:bg-red-900/20 border-red-200 dark:border-red-900/50",
        text: "text-red-700 dark:text-red-300",
        label: "Error",
      };
    default:
      return {
        container:
          "bg-warm-100/80 dark:bg-warm-900/40 border-warm-200/80 dark:border-warm-800/80",
        text: "text-warm-600 dark:text-warm-300",
        label: "Ready",
      };
  }
}

export function RunStatusHeader() {
  const status = useStore((s) => s.agentStatus);
  const detail = useStore((s) => s.statusDetail);
  const turnProgress = useStore((s) => s.turnProgress);
  const sessionMetrics = useStore((s) => s.sessionMetrics);
  const showSessionMetrics = useStore((s) => s.settings.showSessionMetrics);

  const tone = statusTone(status);
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

  return (
    <div
      role="status"
      className={`px-4 py-2 border-b transition-colors ${tone.container}`}
    >
      <div className="flex items-center gap-2 text-xs min-w-0">
        {status === AgentStatus.ERROR ? (
          <AlertCircle size={13} className={tone.text} />
        ) : status === AgentStatus.PAUSED ? (
          <Pause size={13} className={tone.text} />
        ) : status === AgentStatus.IDLE ? (
          <div className="h-2 w-2 rounded-full bg-warm-400 dark:bg-warm-500 shrink-0" />
        ) : (
          <Loader2 size={13} className={`animate-spin shrink-0 ${tone.text}`} />
        )}

        <span className={`font-semibold uppercase tracking-wide ${tone.text}`}>
          {tone.label}
        </span>
        <span className={`truncate min-w-0 ${tone.text}`}>
          {status === AgentStatus.PAUSED ? "Paused by user" : detail}
        </span>

        {turnProgress?.provider && (
          <span className="shrink-0 rounded border border-warm-200 dark:border-warm-700 px-1.5 py-0.5 text-[10px] text-warm-600 dark:text-warm-300 bg-warm-50/70 dark:bg-warm-900/40">
            {turnProgress.provider}
          </span>
        )}
        {turnProgress && (
          <span className="shrink-0 tabular-nums text-warm-500 dark:text-warm-400">
            {turnProgress.turn}/{turnProgress.maxTurns}
          </span>
        )}

        {showSessionMetrics && sessionMetrics && (
          <>
            <span className="text-warm-300 dark:text-warm-600 shrink-0">|</span>
            <span className="shrink-0 tabular-nums text-warm-600 dark:text-warm-300">
              {formatTokens(sessionMetrics.totalTokens)} tok
            </span>
            {sessionMetrics.totalCost > 0 && (
              <span className="shrink-0 tabular-nums text-warm-600 dark:text-warm-300">
                {costLabel(sessionMetrics)}
              </span>
            )}
            <span className="shrink-0 tabular-nums text-warm-500 dark:text-warm-400">
              {formatTime(sessionMetrics.totalLlmTimeMs)}
            </span>
          </>
        )}

        {canPause && (
          <button
            onClick={handlePause}
            className="ml-auto p-1 rounded hover:bg-warm-100 dark:hover:bg-warm-800 text-warm-600 dark:text-warm-300"
            aria-label="Pause agent"
          >
            <Pause size={12} />
          </button>
        )}
        {isPaused && (
          <button
            onClick={handleResume}
            className="ml-auto p-1 rounded hover:bg-warm-100 dark:hover:bg-warm-800 text-warm-600 dark:text-warm-300"
            aria-label="Resume agent"
          >
            <Play size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
