import React, { useCallback, useMemo } from "react";
import { Loader2, Pause, Play, Square, AlertTriangle } from "lucide-react";
import { AgentStatus, MessageSource, SessionMetrics } from "../../types";
import { useStore } from "../store";
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

function fallbackPrimaryLabel(status: AgentStatus, detail: string): string {
  if (status === AgentStatus.WAITING_FOR_PAGE_LOAD) {
    return "Waiting for page to finish loading";
  }
  if (status === AgentStatus.THINKING) {
    return detail || "Planning next steps";
  }
  if (status === AgentStatus.ACTING) {
    return detail || "Taking action on the page";
  }
  if (status === AgentStatus.PAUSED) {
    return "Paused";
  }
  if (status === AgentStatus.ERROR) {
    return detail || "Run failed";
  }
  return detail || "Ready";
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
        status: "completed" | "partial" | "failed";
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
    return "Task failed";
  }
  if (!isAgentRunning && durableRunStatus?.canResume) {
    return "Recoverable durable run";
  }
  if (latestStepLabel) return latestStepLabel;
  return fallbackPrimaryLabel(agentStatus, statusDetail);
}

export function PrimaryTaskRail() {
  const agentStatus = useStore((s) => s.agentStatus);
  const statusDetail = useStore((s) => s.statusDetail);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const turnProgress = useStore((s) => s.turnProgress);
  const sessionMetrics = useStore((s) => s.sessionMetrics);
  const showSessionMetrics = useStore((s) => s.settings.showSessionMetrics);
  const stagnationState = useStore((s) => s.stagnationState);
  const taskProgress = useStore((s) => s.taskProgress);
  const taskCompletion = useStore((s) => s.taskCompletion);
  const latestStepLabel = useStore((s) => s.latestStepLabel);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const pendingEscalation = useStore((s) => s.pendingEscalation);
  const pendingClarification = useStore((s) => s.pendingClarification);
  const durableRunStatus = useStore((s) => s.durableRunStatus);

  const isStalled = Boolean(stagnationState);
  const isPaused = agentStatus === AgentStatus.PAUSED;
  const canPause =
    agentStatus === AgentStatus.THINKING ||
    agentStatus === AgentStatus.ACTING ||
    agentStatus === AgentStatus.WAITING_FOR_PAGE_LOAD;

  const primaryLabel = useMemo(() => {
    return resolvePrimaryTaskLabel({
      latestStepLabel,
      isStalled,
      stagnantTurns: stagnationState?.stagnantTurns,
      hasPendingApproval: Boolean(pendingApproval),
      hasPendingEscalation: Boolean(pendingEscalation),
      hasPendingClarification: Boolean(pendingClarification),
      isAgentRunning,
      taskCompletion,
      durableRunStatus,
      agentStatus,
      statusDetail,
    });
  }, [
    latestStepLabel,
    isStalled,
    stagnationState,
    pendingApproval,
    pendingEscalation,
    pendingClarification,
    isAgentRunning,
    taskCompletion,
    durableRunStatus,
    agentStatus,
    statusDetail,
  ]);

  const secondaryLabel = useMemo(() => {
    if (isStalled) return "Intervention recommended";
    if (pendingApproval) return "Review the proposed action below";
    if (pendingEscalation) return "Choose how the agent should proceed";
    if (pendingClarification) return "Answer the question below to continue";
    if (taskProgress) {
      return `Step ${taskProgress.currentIndex + 1} of ${taskProgress.subtasks.length}`;
    }
    if (!isAgentRunning && taskCompletion) {
      return `${taskCompletion.totalTurnsUsed} turns used`;
    }
    if (!isAgentRunning && durableRunStatus?.canResume) {
      return durableRunStatus.query;
    }
    if (agentStatus === AgentStatus.PAUSED) return "Run is paused";
    if (agentStatus === AgentStatus.WAITING_FOR_PAGE_LOAD) {
      return "Waiting for the page to settle before continuing";
    }
    return statusDetail;
  }, [
    isStalled,
    pendingApproval,
    pendingEscalation,
    pendingClarification,
    taskProgress,
    isAgentRunning,
    taskCompletion,
    durableRunStatus,
    agentStatus,
    statusDetail,
  ]);

  const handlePause = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "PAUSE_AGENT",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: { workspaceId: useStore.getState().activeWorkspaceId },
      });
    } catch (error) {
      logger.error("ui", "Failed to pause agent", { error });
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
    } catch (error) {
      logger.error("ui", "Failed to resume agent", { error });
    }
  }, []);

  const handleStop = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "STOP_AGENT",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: { workspaceId: useStore.getState().activeWorkspaceId },
      });
    } catch (error) {
      logger.error("ui", "Failed to stop agent", { error });
    }
  }, []);

  if (
    !isAgentRunning &&
    agentStatus === AgentStatus.IDLE &&
    !taskCompletion &&
    !durableRunStatus
  ) {
    return null;
  }

  return (
    <section
      aria-live="polite"
      aria-atomic="true"
      className="mx-4 mt-2 rounded-xl border border-warm-200/80 bg-warm-50/90 px-3 py-2.5 shadow-sm dark:border-warm-700/60 dark:bg-warm-900/65"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {isStalled ? (
            <AlertTriangle
              size={15}
              className="text-amber-500"
              aria-label="Agent stalled"
            />
          ) : isAgentRunning && !isPaused ? (
            <Loader2
              size={15}
              className="animate-spin text-primary-500"
              aria-label="Agent running"
            />
          ) : (
            <span
              className={`mt-0.5 inline-flex h-2.5 w-2.5 rounded-full ${
                taskCompletion?.status === "completed"
                  ? "bg-green-500"
                  : taskCompletion?.status === "failed" ||
                      agentStatus === AgentStatus.ERROR
                    ? "bg-red-500"
                    : isPaused
                      ? "bg-yellow-500"
                      : "bg-primary-500"
              }`}
              role="status"
              aria-label={
                taskCompletion?.status === "completed"
                  ? "Task completed"
                  : taskCompletion?.status === "failed" ||
                      agentStatus === AgentStatus.ERROR
                    ? "Task failed"
                    : isPaused
                      ? "Agent paused"
                      : "Agent idle"
              }
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-warm-500 dark:text-warm-400">
            {isAgentRunning ? "Now doing" : "Latest run"}
          </div>
          <div className="mt-0.5 text-sm font-medium leading-snug text-warm-800 dark:text-warm-100">
            {primaryLabel}
          </div>
          {secondaryLabel ? (
            <div className="mt-0.5 text-xs leading-relaxed text-warm-500 dark:text-warm-400">
              {secondaryLabel}
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {durableRunStatus?.stopRequestedAt ? (
              <span className="rounded-full border border-red-300/70 bg-red-50/80 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                Stop requested
              </span>
            ) : null}
            {turnProgress?.provider ? (
              <span className="rounded-full border border-warm-200/90 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-warm-500 dark:border-warm-700 dark:bg-warm-900/50 dark:text-warm-400">
                {turnProgress.provider}
              </span>
            ) : null}
            {turnProgress ? (
              <span className="rounded-full border border-warm-200/90 bg-white/70 px-2 py-0.5 text-[10px] tabular-nums text-warm-500 dark:border-warm-700 dark:bg-warm-900/50 dark:text-warm-400">
                {turnProgress.turn}/{turnProgress.maxTurns} turns
              </span>
            ) : null}
            {showSessionMetrics &&
            sessionMetrics &&
            sessionMetrics.totalTokens > 0 ? (
              <span className="rounded-full border border-warm-200/90 bg-white/70 px-2 py-0.5 text-[10px] tabular-nums text-warm-500 dark:border-warm-700 dark:bg-warm-900/50 dark:text-warm-400">
                {formatTokens(sessionMetrics.totalTokens)}
                {sessionMetrics.totalCost > 0
                  ? ` · ${costLabel(sessionMetrics)}`
                  : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {canPause ? (
            <button
              onClick={() => void handlePause()}
              className="inline-flex items-center gap-1 rounded-lg border border-warm-200 bg-white/80 px-2.5 py-1.5 text-xs font-medium text-warm-600 transition-colors hover:bg-warm-100 dark:border-warm-700 dark:bg-warm-900/60 dark:text-warm-300 dark:hover:bg-warm-800"
              aria-label="Pause agent"
            >
              <Pause size={12} />
              Pause
            </button>
          ) : null}
          {isPaused ? (
            <button
              onClick={() => void handleResume()}
              className="inline-flex items-center gap-1 rounded-lg border border-warm-200 bg-white/80 px-2.5 py-1.5 text-xs font-medium text-warm-600 transition-colors hover:bg-warm-100 dark:border-warm-700 dark:bg-warm-900/60 dark:text-warm-300 dark:hover:bg-warm-800"
              aria-label="Resume agent"
            >
              <Play size={12} />
              Resume
            </button>
          ) : null}
          {isAgentRunning ? (
            <button
              onClick={() => void handleStop()}
              className="inline-flex items-center gap-1 rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
              aria-label="Stop agent"
            >
              <Square size={11} fill="currentColor" />
              Stop
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
