import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Pause, Play, Square } from "lucide-react";
import { AgentStatus, type SessionMetrics } from "../../types";
import { logger } from "../../utils";
import { usefulProgressLabel } from "../progress-labels";
import { uiRuntime } from "../runtime";
import { useStore } from "../store";
import { useTaskUiState, type TaskRailTone } from "../task-ui-state";

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

function fallbackPrimaryLabel(status: AgentStatus, detail: string): string {
  const detailLabel = usefulProgressLabel(detail);
  if (status === AgentStatus.WAITING_FOR_PAGE_LOAD) {
    return "Waiting for page to finish loading";
  }
  if (status === AgentStatus.THINKING) {
    return detailLabel || "Planning next step";
  }
  if (status === AgentStatus.ACTING) {
    return detailLabel || "Taking action on the page";
  }
  if (status === AgentStatus.PAUSED) {
    return "Paused";
  }
  if (status === AgentStatus.ERROR) {
    return detailLabel || "Run failed";
  }
  return detailLabel || "Ready";
}

interface PrimaryTaskLabelInput {
  latestStepLabel: string | null;
  isStalled: boolean;
  stagnantTurns?: number;
  hasPendingApproval: boolean;
  hasPendingEscalation: boolean;
  hasPendingClarification: boolean;
  isAgentRunning: boolean;
  taskCompletion:
    | {
        status: "completed" | "partial" | "failed" | "stopped";
      }
    | null
    | undefined;
  durableRunStatus:
    | {
        query: string;
        canResume: boolean;
      }
    | null
    | undefined;
  agentStatus: AgentStatus;
  statusDetail: string;
}

export function resolvePrimaryTaskLabel({
  latestStepLabel,
  isStalled,
  stagnantTurns,
  hasPendingApproval,
  hasPendingEscalation,
  hasPendingClarification,
  isAgentRunning,
  taskCompletion,
  durableRunStatus,
  agentStatus,
  statusDetail,
}: PrimaryTaskLabelInput): string {
  if (isStalled) {
    return `The agent may be stuck after ${stagnantTurns ?? 0} turns`;
  }
  if (hasPendingApproval) {
    return "Approval required before continuing";
  }
  if (hasPendingEscalation) {
    return "The agent needs your decision";
  }
  if (hasPendingClarification) {
    return "The agent needs more information";
  }
  if (!isAgentRunning && taskCompletion) {
    if (taskCompletion.status === "completed") return "Task completed";
    if (taskCompletion.status === "partial") return "Task partially completed";
    if (taskCompletion.status === "stopped") return "Task stopped";
    return "Task failed";
  }
  if (!isAgentRunning && durableRunStatus?.canResume) {
    return "Recoverable durable run";
  }
  const latestUsefulLabel = usefulProgressLabel(latestStepLabel);
  if (latestUsefulLabel) return latestUsefulLabel;
  return fallbackPrimaryLabel(agentStatus, statusDetail);
}

function statusDotClass(tone: TaskRailTone) {
  if (tone === "completed") return "bg-green-500";
  if (tone === "failed") return "bg-red-500";
  if (tone === "paused") return "bg-yellow-500";
  if (tone === "stopped") return "bg-amber-500";
  return "bg-primary-500";
}

function statusDotLabel(tone: TaskRailTone) {
  if (tone === "completed") return "Task completed";
  if (tone === "failed") return "Task failed";
  if (tone === "paused") return "Agent paused";
  if (tone === "stopped") return "Task stopped";
  return "Agent idle";
}

export function PrimaryTaskRail() {
  const taskUi = useTaskUiState();
  const showSessionMetrics = useStore((s) => s.settings.showSessionMetrics);
  const [pauseRequested, setPauseRequested] = useState(false);

  useEffect(() => {
    if (taskUi.phase === "paused" || !taskUi.rail.canPause) {
      setPauseRequested(false);
    }
  }, [taskUi.phase, taskUi.rail.canPause]);

  const handlePause = useCallback(async () => {
    setPauseRequested(true);
    try {
      await uiRuntime.sendMessage({
        type: "PAUSE_AGENT",
        requestId: crypto.randomUUID(),
        source: uiRuntime.source,
        payload: { workspaceId: useStore.getState().activeWorkspaceId },
      });
    } catch (error) {
      setPauseRequested(false);
      logger.error("ui", "Failed to pause agent", { error });
    }
  }, []);

  const handleResume = useCallback(async () => {
    try {
      await uiRuntime.sendMessage({
        type: "RESUME_AGENT",
        requestId: crypto.randomUUID(),
        source: uiRuntime.source,
        payload: { workspaceId: useStore.getState().activeWorkspaceId },
      });
    } catch (error) {
      logger.error("ui", "Failed to resume agent", { error });
    }
  }, []);

  const handleStop = useCallback(async () => {
    try {
      await uiRuntime.sendMessage({
        type: "STOP_AGENT",
        requestId: crypto.randomUUID(),
        source: uiRuntime.source,
        payload: { workspaceId: useStore.getState().activeWorkspaceId },
      });
    } catch (error) {
      logger.error("ui", "Failed to stop agent", { error });
    }
  }, []);

  if (!taskUi.showPrimaryRail) {
    return null;
  }

  const { rail } = taskUi;

  return (
    <section
      aria-live="polite"
      aria-atomic="true"
      className="mx-4 mt-2 max-h-[30vh] overflow-hidden rounded-xl border border-warm-200/80 bg-warm-50/90 px-3 py-2.5 shadow-sm dark:border-warm-700/60 dark:bg-warm-900/65"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {rail.tone === "stalled" ? (
            <AlertTriangle
              size={15}
              className="text-amber-500"
              aria-label="Agent stalled"
            />
          ) : rail.showSpinner ? (
            <Loader2
              size={15}
              className="animate-spin text-primary-500"
              aria-label="Agent running"
            />
          ) : (
            <span
              className={`mt-0.5 inline-flex h-2.5 w-2.5 rounded-full ${statusDotClass(
                rail.tone,
              )}`}
              role="status"
              aria-label={statusDotLabel(rail.tone)}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-warm-500 dark:text-warm-400">
            {rail.eyebrow}
          </div>
          <div className="mt-0.5 max-h-[16vh] overflow-y-auto pr-1 text-sm font-medium leading-snug text-warm-800 dark:text-warm-100">
            {rail.primaryLabel}
          </div>
          {rail.secondaryLabel ? (
            <div className="mt-0.5 text-xs leading-relaxed text-warm-500 dark:text-warm-400">
              {rail.secondaryLabel}
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {rail.stopRequested ? (
              <span className="rounded-full border border-red-300/70 bg-red-50/80 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                Stop requested
              </span>
            ) : null}
            {pauseRequested ? (
              <span className="rounded-full border border-yellow-300/70 bg-yellow-50/80 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:border-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-300">
                Pause requested
              </span>
            ) : null}
            {rail.turnProgress?.provider ? (
              <span className="rounded-full border border-warm-200/90 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-warm-500 dark:border-warm-700 dark:bg-warm-900/50 dark:text-warm-400">
                {rail.turnProgress.provider}
              </span>
            ) : null}
            {rail.turnProgress ? (
              <span className="rounded-full border border-warm-200/90 bg-white/70 px-2 py-0.5 text-[10px] tabular-nums text-warm-500 dark:border-warm-700 dark:bg-warm-900/50 dark:text-warm-400">
                {rail.turnProgress.turn}/{rail.turnProgress.maxTurns} turns
              </span>
            ) : null}
            {showSessionMetrics &&
            rail.sessionMetrics &&
            rail.sessionMetrics.totalTokens > 0 ? (
              <span className="rounded-full border border-warm-200/90 bg-white/70 px-2 py-0.5 text-[10px] tabular-nums text-warm-500 dark:border-warm-700 dark:bg-warm-900/50 dark:text-warm-400">
                {formatTokens(rail.sessionMetrics.totalTokens)}
                {rail.sessionMetrics.totalCost > 0
                  ? ` / ${costLabel(rail.sessionMetrics)}`
                  : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {rail.canPause ? (
            <button
              onClick={() => void handlePause()}
              disabled={pauseRequested}
              className="inline-flex items-center gap-1 rounded-lg border border-warm-200 bg-white/80 px-2.5 py-1.5 text-xs font-medium text-warm-600 transition-colors hover:bg-warm-100 disabled:cursor-wait disabled:opacity-70 dark:border-warm-700 dark:bg-warm-900/60 dark:text-warm-300 dark:hover:bg-warm-800"
              aria-label="Pause agent"
            >
              <Pause size={12} />
              {pauseRequested ? "Pause requested" : "Pause"}
            </button>
          ) : null}
          {rail.showResume ? (
            <button
              onClick={() => void handleResume()}
              className="inline-flex items-center gap-1 rounded-lg border border-warm-200 bg-white/80 px-2.5 py-1.5 text-xs font-medium text-warm-600 transition-colors hover:bg-warm-100 dark:border-warm-700 dark:bg-warm-900/60 dark:text-warm-300 dark:hover:bg-warm-800"
              aria-label="Resume agent"
            >
              <Play size={12} />
              Resume
            </button>
          ) : null}
          {rail.showStop ? (
            <button
              onClick={() => void handleStop()}
              className="inline-flex items-center gap-1 rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
              aria-label="Stop agent and take control"
            >
              <Square size={11} fill="currentColor" />
              Take control
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
