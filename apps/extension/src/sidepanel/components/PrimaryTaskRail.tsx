import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  Pause,
  Play,
  Square,
  Unplug,
} from "lucide-react";
import { AgentStatus } from "../../types";
import { logger } from "../../utils";
import { usefulProgressLabel } from "../progress-labels";
import { uiRuntime } from "../runtime";
import { useStore } from "../store";
import { costLabel, formatTokens } from "../task-status-format";
import { useTaskUiState, type TaskRailTone } from "../task-ui-state";

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
    return "Progress has stalled";
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
    return "Interrupted task available to resume";
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

export function PrimaryTaskRail({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const taskUi = useTaskUiState();
  const showSessionMetrics = useStore((s) => s.settings.showSessionMetrics);
  const goal = useStore(
    (s) =>
      s.pendingPlanConfirmation?.query ||
      s.durableRunStatus?.query ||
      [...s.messages].reverse().find((m) => m.role === "user" && !m.isFeedback)
        ?.content,
  );
  const lastAction = useStore((s) => s.lastCompletedAction);
  const lastUpdate = useStore((s) => s.lastTaskUpdateAt);
  const [now, setNow] = useState(Date.now());
  const [controlError, setControlError] = useState<string | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  useEffect(() => {
    if (!taskUi.showPrimaryRail || taskUi.hasTerminalCompletion) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [taskUi.showPrimaryRail, taskUi.hasTerminalCompletion]);
  useEffect(() => {
    setControlError(null);
    setStopRequested(false);
  }, [goal, taskUi.hasTerminalCompletion]);
  const [pauseRequested, setPauseRequested] = useState(false);

  useEffect(() => {
    if (taskUi.phase === "paused" || !taskUi.rail.canPause) {
      setPauseRequested(false);
    }
  }, [taskUi.phase, taskUi.rail.canPause]);

  const handlePause = useCallback(async () => {
    setControlError(null);
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
      setControlError("Could not pause. Please try again.");
      logger.error("ui", "Failed to pause agent", { error });
    }
  }, []);

  const handleResume = useCallback(async () => {
    setControlError(null);
    try {
      await uiRuntime.sendMessage({
        type: "RESUME_AGENT",
        requestId: crypto.randomUUID(),
        source: uiRuntime.source,
        payload: { workspaceId: useStore.getState().activeWorkspaceId },
      });
    } catch (error) {
      setControlError("Could not resume. Please try again.");
      logger.error("ui", "Failed to resume agent", { error });
    }
  }, []);

  const handleStop = useCallback(async () => {
    setControlError(null);
    setStopRequested(true);
    try {
      await uiRuntime.sendMessage({
        type: "STOP_AGENT",
        requestId: crypto.randomUUID(),
        source: uiRuntime.source,
        payload: { workspaceId: useStore.getState().activeWorkspaceId },
      });
    } catch (error) {
      setStopRequested(false);
      setControlError("Stop could not be confirmed. Please try again.");
      logger.error("ui", "Failed to stop agent", { error });
    }
  }, []);

  if (!taskUi.showPrimaryRail) {
    return null;
  }

  const { rail } = taskUi;
  const secondaryLabel =
    rail.secondaryLabel?.trim().toLocaleLowerCase() ===
    rail.primaryLabel.trim().toLocaleLowerCase()
      ? null
      : rail.secondaryLabel;

  const age =
    lastUpdate == null
      ? null
      : Math.max(0, Math.floor((now - lastUpdate) / 1000));
  const showAge = !taskUi.hasTerminalCompletion && age != null && age >= 10;
  const isReconnecting = taskUi.phase === "reconnecting";
  const buttonClass =
    "inline-flex min-h-9 items-center gap-1.5 rounded-md border border-warm-300 px-3 py-1.5 text-xs font-medium text-warm-700 hover:bg-warm-100 disabled:opacity-60 dark:border-warm-600 dark:text-warm-200 dark:hover:bg-warm-800";

  return (
    <section
      className={
        embedded
          ? "px-4 py-3"
          : "mx-3 mt-2 rounded-lg border border-warm-200 bg-white p-4 dark:border-warm-700 dark:bg-warm-900"
      }
    >
      {goal ? (
        <h2
          className="mb-3 line-clamp-2 break-words text-sm font-semibold leading-5 text-warm-900 dark:text-warm-100"
          title={goal}
        >
          {goal}
        </h2>
      ) : null}
      <div aria-live="polite" aria-atomic="true">
        <div className="flex items-start gap-2">
          {isReconnecting ? (
            <Unplug size={16} className="mt-0.5 shrink-0 text-amber-600" />
          ) : rail.tone === "stalled" || rail.tone === "paused" ? (
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-amber-600"
            />
          ) : taskUi.phase === "waiting" ? (
            <Clock3 size={16} className="mt-0.5 shrink-0 text-warm-500" />
          ) : rail.tone === "completed" ? (
            <CheckCircle2
              size={16}
              className="mt-0.5 shrink-0 text-green-600"
            />
          ) : rail.showSpinner ? (
            <Loader2
              size={16}
              aria-label="Agent working"
              className="mt-0.5 shrink-0 animate-spin text-teal-600 motion-reduce:animate-none"
            />
          ) : (
            <span
              aria-label={statusDotLabel(rail.tone)}
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDotClass(rail.tone)}`}
            />
          )}
          <span className="break-words text-sm font-medium leading-5 text-warm-900 dark:text-warm-100">
            {rail.primaryLabel}
          </span>
        </div>
        {secondaryLabel ? (
          <p className="mt-1.5 line-clamp-3 break-words text-xs leading-relaxed text-warm-600 dark:text-warm-300">
            {secondaryLabel}
          </p>
        ) : null}
      </div>
      {lastAction && !taskUi.hasTerminalCompletion ? (
        <p className="mt-3 border-t border-warm-200 pt-2 text-xs leading-relaxed text-warm-600 dark:border-warm-700 dark:text-warm-300">
          <span className="font-medium">Last completed action: </span>
          {lastAction.label}
        </p>
      ) : null}
      {showAge ? (
        <p className="mt-1 text-xs tabular-nums text-warm-500 dark:text-warm-400">
          Last task update {age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`}{" "}
          ago
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {rail.canPause ? (
          <button
            onClick={() => void handlePause()}
            disabled={pauseRequested || stopRequested}
            className={buttonClass}
            aria-label="Pause agent"
          >
            <Pause size={14} />
            {pauseRequested ? "Pausing…" : "Pause"}
          </button>
        ) : null}
        {rail.showResume ? (
          <button
            onClick={() => void handleResume()}
            className={buttonClass}
            aria-label="Resume agent"
          >
            <Play size={14} />
            Resume
          </button>
        ) : null}
        {rail.showStop ? (
          <button
            onClick={() => void handleStop()}
            disabled={stopRequested || rail.stopRequested}
            className={buttonClass}
            aria-label="Stop agent and take control"
          >
            <Square size={12} />
            {stopRequested || rail.stopRequested ? "Stopping…" : "Stop"}
          </button>
        ) : null}
        {rail.turnProgress || (showSessionMetrics && rail.sessionMetrics) ? (
          <details className="ml-auto text-xs text-warm-500 open:w-full dark:text-warm-400">
            <summary className="cursor-pointer">Run details</summary>
            <div className="mt-2 space-y-1">
              {rail.turnProgress ? (
                <p>
                  Execution budget: {rail.turnProgress.turn} of{" "}
                  {rail.turnProgress.maxTurns} turns used
                  {rail.turnProgress.provider
                    ? ` · ${rail.turnProgress.provider}`
                    : ""}
                </p>
              ) : null}
              {showSessionMetrics && rail.sessionMetrics ? (
                <p>
                  {formatTokens(rail.sessionMetrics.totalTokens)} tokens ·{" "}
                  {costLabel(rail.sessionMetrics)}
                </p>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
      {controlError ? (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {controlError}
        </p>
      ) : null}
    </section>
  );
}
