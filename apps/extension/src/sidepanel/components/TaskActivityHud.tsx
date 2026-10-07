import React from "react";
import { AlertTriangle, Check, Loader2, MousePointer2 } from "lucide-react";
import { useStore } from "../store";
import { useTaskUiState, type TaskRailTone } from "../task-ui-state";

function dotClass(tone: TaskRailTone) {
  if (tone === "failed") return "bg-red-500";
  if (tone === "paused") return "bg-yellow-500";
  if (tone === "stalled") return "bg-amber-500";
  return "bg-primary-500";
}

export function TaskActivityHud() {
  const taskUi = useTaskUiState();
  const actionPresentation = useStore((s) => s.actionPresentation);
  const { rail } = taskUi;

  if (!taskUi.showPageActivityHud) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none inline-flex max-w-[min(560px,calc(100vw-32px))] items-center gap-2 rounded-lg border border-slate-200/80 bg-white/88 px-3 py-2 text-slate-800 shadow-lg shadow-slate-950/15 backdrop-blur-md dark:border-slate-700/75 dark:bg-slate-950/82 dark:text-slate-100"
      data-opensidebar-activity-hud
    >
      {actionPresentation?.phase === "applied" ? (
        <Check
          size={15}
          className="shrink-0 text-emerald-500"
          aria-label="Action applied"
        />
      ) : actionPresentation?.phase === "failed" ? (
        <AlertTriangle
          size={15}
          className="shrink-0 text-red-500"
          aria-label="Action failed"
        />
      ) : actionPresentation ? (
        <MousePointer2
          size={15}
          className="shrink-0 text-primary-500"
          aria-label="Agent acting on page"
        />
      ) : rail.tone === "stalled" ? (
        <AlertTriangle
          size={15}
          className="shrink-0 text-amber-500"
          aria-label="Agent stalled"
        />
      ) : rail.showSpinner ? (
        <Loader2
          size={15}
          className="shrink-0 animate-spin motion-reduce:animate-none text-teal-600"
          aria-label="Agent running"
        />
      ) : (
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${dotClass(rail.tone)}`}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 truncate text-sm font-medium leading-5">
        {rail.primaryLabel}
      </span>
    </div>
  );
}
