import React, { useState } from "react";
import {
  Loader2,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { AgentStep } from "../../types";
import { clsx } from "clsx";

function StepIcon({ step }: { step: AgentStep }) {
  if (step.status === "running") {
    return (
      <Loader2 size={12} className="animate-spin text-amber-500 shrink-0" />
    );
  }
  if (step.status === "error") {
    return <XCircle size={12} className="text-red-500 shrink-0" />;
  }
  return <CheckCircle size={12} className="text-green-500 shrink-0" />;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StepRow({ step }: { step: AgentStep }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => step.detail && setExpanded(!expanded)}
        className={clsx(
          "flex items-center gap-1.5 w-full text-left py-0.5 px-1 rounded text-xs",
          step.detail &&
            "hover:bg-warm-100 dark:hover:bg-warm-700/50 cursor-pointer",
          !step.detail && "cursor-default",
        )}
      >
        <StepIcon step={step} />
        <span
          className={clsx(
            "truncate flex-1",
            step.status === "running" && "text-warm-800 dark:text-warm-100",
            step.status === "done" && "text-warm-500 dark:text-warm-400",
            step.status === "error" && "text-red-600 dark:text-red-400",
          )}
        >
          {step.label}
        </span>
        {step.durationMs != null && step.durationMs >= 500 && (
          <span className="text-[10px] text-warm-400 tabular-nums shrink-0">
            {formatDuration(step.durationMs)}
          </span>
        )}
      </button>
      {expanded && step.detail && (
        <pre className="ml-6 text-[10px] text-warm-400 dark:text-warm-500 bg-warm-100 dark:bg-warm-800 rounded px-2 py-1 mt-0.5 mb-1 overflow-x-auto max-h-20">
          {step.detail}
        </pre>
      )}
      {step.errorMessage && (
        <div className="ml-6 text-[10px] text-red-500 mt-0.5">
          {step.errorMessage}
        </div>
      )}
    </div>
  );
}

export function StepTimeline({
  steps,
  defaultCollapsed,
}: {
  steps: AgentStep[];
  defaultCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (steps.length === 0) return null;

  const doneCount = steps.filter((s) => s.status === "done").length;
  const hasRunning = steps.some((s) => s.status === "running");
  const hasError = steps.some((s) => s.status === "error");

  const headerLabel = hasRunning
    ? `Working... (${doneCount}/${steps.length})`
    : hasError
      ? `Done with errors (${steps.length})`
      : `Done (${steps.length})`;

  return (
    <div className="max-w-[85%] mb-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 text-xs text-warm-500 dark:text-warm-400 hover:text-warm-700 dark:hover:text-warm-300 py-0.5"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {hasRunning && (
          <Loader2 size={11} className="animate-spin text-amber-500" />
        )}
        <span>{headerLabel}</span>
      </button>
      {!collapsed && (
        <div className="ml-1 border-l border-warm-200 dark:border-warm-700 pl-2 mt-0.5">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
