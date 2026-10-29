import React from "react";
import { AlertTriangle, Check, Loader2, MousePointer2 } from "lucide-react";
import { costLabel, formatTokens } from "../task-status-format";
import { useStore } from "../store";
import { useTaskUiState, type TaskRailTone } from "../task-ui-state";

function dotClass(tone: TaskRailTone) {
  if (tone === "failed") return "bg-danger";
  if (tone === "paused") return "bg-warning";
  if (tone === "stalled") return "bg-warning";
  return "bg-accent";
}

export function TaskActivityHud() {
  const taskUi = useTaskUiState();
  const showSessionMetrics = useStore((s) => s.settings.showSessionMetrics);
  const actionPresentation = useStore((s) => s.actionPresentation);
  const { rail } = taskUi;

  if (!taskUi.showPageActivityHud) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none inline-flex max-w-[min(560px,calc(100vw-32px))] items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-fg shadow-sm backdrop-blur-md"
      data-opensidebar-activity-hud
    >
      {actionPresentation?.phase === "applied" ? (
        <Check
          size={15}
          className="shrink-0 text-success"
          aria-label="Action applied"
        />
      ) : actionPresentation?.phase === "failed" ? (
        <AlertTriangle
          size={15}
          className="shrink-0 text-danger"
          aria-label="Action failed"
        />
      ) : actionPresentation ? (
        <MousePointer2
          size={15}
          className="shrink-0 text-accent-text"
          aria-label="Agent acting on page"
        />
      ) : rail.tone === "stalled" ? (
        <AlertTriangle
          size={15}
          className="shrink-0 text-warning"
          aria-label="Agent stalled"
        />
      ) : rail.showSpinner ? (
        <Loader2
          size={15}
          className="shrink-0 animate-spin text-accent-text"
          aria-label="Agent running"
        />
      ) : (
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${dotClass(rail.tone)}`}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 truncate text-ui-body font-medium leading-5">
        {rail.primaryLabel}
      </span>
      {rail.turnProgress?.provider ? (
        <span className="hidden shrink-0 rounded-md border border-line bg-surface px-1.5 py-0.5 text-ui-caption font-medium text-fg-tertiary sm:inline">
          {rail.turnProgress.provider}
        </span>
      ) : null}
      {rail.turnProgress ? (
        <span className="shrink-0 rounded-md border border-line bg-surface px-1.5 py-0.5 text-ui-caption tabular-nums text-fg-tertiary">
          {rail.turnProgress.turn}/{rail.turnProgress.maxTurns}
        </span>
      ) : null}
      {showSessionMetrics &&
      rail.sessionMetrics &&
      rail.sessionMetrics.totalTokens > 0 ? (
        <span className="hidden shrink-0 rounded-md border border-line bg-surface px-1.5 py-0.5 text-ui-caption tabular-nums text-fg-tertiary sm:inline">
          {formatTokens(rail.sessionMetrics.totalTokens)}
          {` / ${costLabel(rail.sessionMetrics)}`}
        </span>
      ) : null}
    </div>
  );
}
