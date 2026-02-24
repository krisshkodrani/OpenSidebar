import React, { useState } from "react";
import {
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Brain,
  MousePointerClick,
  Camera,
} from "lucide-react";
import { AgentStep } from "../../types";
import { clsx } from "clsx";

function StepIcon({ step }: { step: AgentStep }) {
  if (step.status === "running") {
    // Pulsing dot — more subtle and modern than a spinner
    return (
      <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
        <span className="absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-40 animate-ping" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary-500" />
      </span>
    );
  }
  if (step.status === "error") {
    return <XCircle size={12} className="text-red-500 shrink-0" />;
  }
  // Contextual done icons
  if (step.type === "thinking") {
    return <Brain size={12} className="text-warm-400 dark:text-warm-500 shrink-0" />;
  }
  if (step.type === "tool") {
    return <MousePointerClick size={12} className="text-warm-400 dark:text-warm-500 shrink-0" />;
  }
  return <CheckCircle size={12} className="text-warm-400 dark:text-warm-500 shrink-0" />;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StepRow({ step }: { step: AgentStep }) {
  const [expanded, setExpanded] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const isRunning = step.status === "running";

  return (
    <div className={clsx(
      "transition-all duration-200",
      isRunning && "step-enter",
    )}>
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
            "truncate flex-1 transition-colors duration-200",
            isRunning && "text-warm-700 dark:text-warm-200 font-medium",
            step.status === "done" && "text-warm-400 dark:text-warm-500",
            step.status === "error" && "text-red-600 dark:text-red-400",
          )}
        >
          {step.label}
        </span>
        {step.screenshotUrl && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowScreenshot(!showScreenshot);
            }}
            className="text-warm-300 dark:text-warm-600 hover:text-primary-500 dark:hover:text-primary-400 shrink-0 p-0.5"
            title={showScreenshot ? "Hide screenshot" : "Show screenshot"}
          >
            <Camera size={10} />
          </button>
        )}
        {step.durationMs != null && step.durationMs >= 500 && (
          <span className="text-[10px] text-warm-300 dark:text-warm-600 tabular-nums shrink-0">
            {formatDuration(step.durationMs)}
          </span>
        )}
      </button>
      {showScreenshot && step.screenshotUrl && (
        <div className="ml-6 mt-0.5 mb-1">
          <img
            src={step.screenshotUrl}
            alt="Page screenshot"
            className="max-h-[200px] rounded border border-warm-200 dark:border-warm-700 cursor-pointer"
            onClick={() => window.open(step.screenshotUrl, "_blank")}
          />
        </div>
      )}
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

  const stepWord = steps.length === 1 ? "step" : "steps";
  const headerLabel = hasRunning
    ? `${doneCount > 0 ? `${doneCount} of ${steps.length}` : `${steps.length}`} ${stepWord}`
    : hasError
      ? `${steps.length} ${stepWord} (with errors)`
      : `${steps.length} ${stepWord}`;

  return (
    <div className="max-w-[85%] mb-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 text-[11px] text-warm-400 dark:text-warm-500 hover:text-warm-600 dark:hover:text-warm-300 py-0.5 transition-colors"
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        {hasRunning && (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-40 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" />
          </span>
        )}
        {!hasRunning && !hasError && (
          <CheckCircle size={11} className="text-green-500/60 shrink-0" />
        )}
        {!hasRunning && hasError && (
          <XCircle size={11} className="text-red-500/60 shrink-0" />
        )}
        <span>{headerLabel}</span>
      </button>
      {!collapsed && (
        <div className="ml-2.5 border-l border-warm-200/60 dark:border-warm-700/40 pl-2 mt-0.5 space-y-px">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
