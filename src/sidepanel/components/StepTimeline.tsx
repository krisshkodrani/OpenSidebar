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
  Camera,
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
      return <Info size={12} className="text-warm-400 shrink-0" />;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ScreenshotLightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <img
        src={src}
        alt="Screenshot"
        className="max-w-[90%] max-h-[90%] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function StepRow({ step, index }: { step: AgentStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const [showFullScreenshot, setShowFullScreenshot] = useState(false);

  return (
    <div
      className="message-enter"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <button
        onClick={() => step.detail && setExpanded(!expanded)}
        className={clsx(
          "flex items-center gap-1.5 w-full text-left py-0.5 px-1 rounded text-xs",
          step.detail && "hover:bg-warm-100 dark:hover:bg-warm-700/50 cursor-pointer",
          !step.detail && "cursor-default",
        )}
      >
        <StepIcon step={step} />
        <TypeIcon type={step.type} />
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
        {step.screenshotUrl && (
          <Camera size={12} className="text-blue-400 shrink-0" />
        )}
        {step.durationMs != null && step.durationMs >= 500 && (
          <span className="text-[10px] text-warm-400 tabular-nums shrink-0">
            {formatDuration(step.durationMs)}
          </span>
        )}
      </button>
      {step.screenshotUrl && (
        <div className="ml-8 mt-0.5 mb-1">
          <img
            src={step.screenshotUrl}
            alt="Page screenshot"
            className="max-h-[120px] rounded border border-warm-200 dark:border-warm-700 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => setShowFullScreenshot(true)}
          />
        </div>
      )}
      {showFullScreenshot && step.screenshotUrl && (
        <ScreenshotLightbox
          src={step.screenshotUrl}
          onClose={() => setShowFullScreenshot(false)}
        />
      )}
      {expanded && step.detail && (
        <pre className="ml-8 text-[10px] text-warm-400 dark:text-warm-500 bg-warm-100 dark:bg-warm-800 rounded px-2 py-1 mt-0.5 mb-1 overflow-x-auto max-h-20">
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
        className="flex items-center gap-1 text-xs text-warm-500 dark:text-warm-400 hover:text-warm-700 dark:hover:text-warm-300 py-0.5"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {hasRunning && (
          <Loader2 size={11} className="animate-spin text-amber-500" />
        )}
        <span>{headerLabel}</span>
      </button>
      {!collapsed && (
        <div className="ml-1 border-l-2 border-warm-200 dark:border-warm-700 pl-2 mt-0.5">
          {steps.map((step, i) => (
            <StepRow key={step.id} step={step} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
