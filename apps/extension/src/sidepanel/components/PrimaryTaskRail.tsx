import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Pause, Play, Square } from "lucide-react";
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
  if (tone === "completed") return "bg-success";
  if (tone === "failed") return "bg-danger";
  if (tone === "paused") return "bg-warning";
  if (tone === "stopped") return "bg-warning";
  return "bg-accent";
}

function statusDotLabel(tone: TaskRailTone) {
  if (tone === "completed") return "Task completed";
  if (tone === "failed") return "Task failed";
  if (tone === "paused") return "Agent paused";
  if (tone === "stopped") return "Task stopped";
  return "Agent idle";
}

export function PrimaryTaskRail({ embedded = false }: { embedded?: boolean } = {}) {
  const taskUi = useTaskUiState();
  const showSessionMetrics = useStore((s) => s.settings.showSessionMetrics);
  const hasTaskProgress = useStore((s) => Boolean(s.taskProgress));
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
  const secondaryLabel =
    rail.secondaryLabel?.trim().toLocaleLowerCase() ===
    rail.primaryLabel.trim().toLocaleLowerCase()
      ? null
      : rail.secondaryLabel;

  return (
    <section
      aria-live="polite"
      aria-atomic="true"
      className={
        embedded
          ? "overflow-hidden bg-transparent px-3 py-2"
          : "mx-3 mt-2 overflow-hidden rounded-lg border border-line bg-surface px-2.5 py-1.5 shadow-sm"
      }
    >
      <div className="flex min-h-8 items-center gap-2">
        <div className="shrink-0">
          {rail.tone === "stalled" ? (
            <AlertTriangle
              size={14}
              className="text-warning"
              aria-label="Agent stalled"
            />
          ) : rail.showSpinner ? (
            <span
              className="relative inline-flex h-2.5 w-2.5 items-center justify-center"
              role="status"
              aria-label="Agent running"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
          ) : (
            <span
              className={`inline-flex h-2 w-2 rounded-full ${statusDotClass(
                rail.tone,
              )}`}
              role="status"
              aria-label={statusDotLabel(rail.tone)}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-ui-caption font-semibold uppercase text-fg-tertiary">
              {rail.eyebrow === "Now doing" ? "Doing" : "Latest"}
            </span>
            <span className="min-w-0 truncate text-ui-control font-medium leading-5 text-fg">
              {rail.primaryLabel}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
            {rail.stopRequested ? (
              <span className="rounded-md border border-danger/30 bg-danger-subtle px-1.5 py-0.5 text-ui-caption font-medium text-danger">
                Stop requested
              </span>
            ) : null}
            {pauseRequested ? (
              <span className="rounded-md border border-warning/30 bg-warning-subtle px-1.5 py-0.5 text-ui-caption font-medium text-warning">
                Pause requested
              </span>
            ) : null}
            {secondaryLabel && !(embedded && hasTaskProgress) ? (
              <span className="max-w-full truncate text-ui-caption text-fg-tertiary">
                {secondaryLabel}
              </span>
            ) : null}
            {rail.turnProgress?.provider ? (
              <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-ui-caption font-medium text-fg-tertiary">
                {rail.turnProgress.provider}
              </span>
            ) : null}
            {rail.turnProgress ? (
              <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-ui-caption tabular-nums text-fg-tertiary">
                {rail.turnProgress.turn}/{rail.turnProgress.maxTurns}
              </span>
            ) : null}
            {showSessionMetrics &&
            rail.sessionMetrics &&
            rail.sessionMetrics.totalTokens > 0 ? (
              <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-ui-caption tabular-nums text-fg-tertiary">
                {formatTokens(rail.sessionMetrics.totalTokens)}
                {` / ${costLabel(rail.sessionMetrics)}`}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {rail.canPause ? (
            <button
              onClick={() => void handlePause()}
              disabled={pauseRequested}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-fg-secondary transition-colors hover:bg-surface-subtle disabled:cursor-wait disabled:opacity-70"
              aria-label="Pause agent"
              title="Pause agent"
            >
              <Pause size={13} />
            </button>
          ) : null}
          {rail.showResume ? (
            <button
              onClick={() => void handleResume()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-fg-secondary transition-colors hover:bg-surface-subtle"
              aria-label="Resume agent"
              title="Resume agent"
            >
              <Play size={13} />
            </button>
          ) : null}
          {rail.showStop ? (
            <button
              onClick={() => void handleStop()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-danger text-canvas transition-colors hover:bg-danger/90"
              aria-label="Stop agent and take control"
              title="Take control"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
