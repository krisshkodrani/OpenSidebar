import React, { useState } from "react";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Brain,
  Wrench,
  Info,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { AgentStep } from "../../types";
import { clsx } from "clsx";

function StepIcon({ step }: { step: AgentStep }) {
  if (step.status === "running") {
    return <Loader2 size={14} className="animate-spin text-amber-500 shrink-0" />;
  }
  if (step.status === "error") {
    return <XCircle size={14} className="text-red-500 shrink-0" />;
  }
  return <CheckCircle size={14} className="text-green-500 shrink-0" />;
}

function TypeIcon({ type }: { type: AgentStep["type"] }) {
  switch (type) {
    case "thinking":
      return <Brain size={12} className="text-purple-400 shrink-0" />;
    case "tool":
      return <Wrench size={12} className="text-blue-400 shrink-0" />;
    case "info":
      return <Info size={12} className="text-gray-400 shrink-0" />;
  }
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
          step.detail && "hover:bg-gray-100 dark:hover:bg-gray-700/50 cursor-pointer",
          !step.detail && "cursor-default",
        )}
      >
        <StepIcon step={step} />
        <TypeIcon type={step.type} />
        <span
          className={clsx(
            "truncate flex-1",
            step.status === "running" && "text-gray-900 dark:text-gray-100",
            step.status === "done" && "text-gray-500 dark:text-gray-400",
            step.status === "error" && "text-red-600 dark:text-red-400",
          )}
        >
          {step.label}
        </span>
        {step.durationMs != null && step.durationMs >= 500 && (
          <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
            {formatDuration(step.durationMs)}
          </span>
        )}
      </button>
      {expanded && step.detail && (
        <pre className="ml-8 text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 rounded px-2 py-1 mt-0.5 mb-1 overflow-x-auto max-h-20">
          {step.detail}
        </pre>
      )}
      {step.errorMessage && (
        <div className="ml-8 text-[10px] text-red-500 mt-0.5">
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
    ? `Working... (${doneCount}/${steps.length} steps)`
    : hasError
      ? `Finished with errors (${steps.length} steps)`
      : `Completed (${steps.length} steps)`;

  return (
    <div className="max-w-[85%] mb-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 py-0.5"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {hasRunning && (
          <Loader2 size={11} className="animate-spin text-amber-500" />
        )}
        <span>{headerLabel}</span>
      </button>
      {!collapsed && (
        <div className="ml-1 border-l-2 border-gray-200 dark:border-gray-700 pl-2 mt-0.5">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}
