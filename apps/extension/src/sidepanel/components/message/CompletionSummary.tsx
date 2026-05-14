import React, { useState } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  XCircle,
} from "lucide-react";
import type { TaskCompletionMessage } from "../../../types";
import { formatTokensCompact } from "../../message-formatting";
import { PlanStepIcon } from "../PlanStepIcon";
import { MetricsSummary } from "./MetricsSummary";

function completionLabel(status: TaskCompletionMessage["payload"]["status"]) {
  if (status === "completed") return "Done";
  if (status === "partial") return "Partially done";
  return "Failed";
}

function CompletionIcon({
  status,
}: {
  status: TaskCompletionMessage["payload"]["status"];
}) {
  if (status === "completed") {
    return <CheckCircle2 size={13} className="shrink-0 text-green-500" />;
  }
  if (status === "partial") {
    return <AlertTriangle size={13} className="shrink-0 text-yellow-500" />;
  }
  return <XCircle size={13} className="shrink-0 text-red-500" />;
}

export function CompletionStatusHeader({
  canCopy,
  data,
  onCopy,
}: {
  canCopy: boolean;
  data: TaskCompletionMessage["payload"];
  onCopy: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!canCopy) return;
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="completion-meta-enter mt-3 flex items-center gap-2 border-t border-warm-200/70 pt-2 text-xs dark:border-warm-800">
      <div className="flex min-w-0 items-center gap-1.5 font-semibold text-warm-600 dark:text-warm-300">
        <CompletionIcon status={data.status} />
        <span>{completionLabel(data.status)}</span>
      </div>
      {canCopy ? (
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto rounded-md p-1.5 text-warm-400 transition-colors hover:bg-warm-100 hover:text-warm-700 dark:hover:bg-warm-800 dark:hover:text-warm-100"
          title="Copy answer"
          aria-label="Copy answer"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      ) : null}
    </div>
  );
}

export function CompletionDetails({
  data,
}: {
  data: TaskCompletionMessage["payload"];
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailParts = [
    data.subtaskResults?.length
      ? `${data.subtaskResults.length} ${
          data.subtaskResults.length === 1 ? "step" : "steps"
        }`
      : null,
    data.metrics
      ? `${formatTokensCompact(data.metrics.totalTokens)} tokens`
      : null,
  ].filter(Boolean);
  const hasDetails = Boolean(
    (data.subtaskResults && data.subtaskResults.length > 0) || data.metrics,
  );

  if (!hasDetails) return null;

  return (
    <div className="completion-meta-enter mt-1">
      <button
        type="button"
        onClick={() => setDetailsOpen((value) => !value)}
        className="flex items-center gap-1 text-xs text-warm-400 transition-colors hover:text-warm-600 dark:text-warm-500 dark:hover:text-warm-300"
      >
        {detailsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>
          Details{detailParts.length > 0 ? ` (${detailParts.join(", ")})` : ""}
        </span>
      </button>
      {detailsOpen ? (
        <div className="mt-2 space-y-2">
          {data.subtaskResults && data.subtaskResults.length > 0 ? (
            <div className="ml-1 space-y-0.5 border-l border-warm-200/60 pl-2 dark:border-warm-700/40">
              {data.subtaskResults.map((result, index) => (
                <div key={index} className="flex items-center gap-1.5 text-xs">
                  <PlanStepIcon
                    status={
                      result.status === "completed"
                        ? "completed"
                        : result.status === "failed"
                          ? "failed"
                          : result.status === "skipped"
                            ? "skipped"
                            : "pending"
                    }
                    size={10}
                  />
                  <span className="truncate text-warm-500 dark:text-warm-400">
                    {result.description}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {data.metrics ? <MetricsSummary metrics={data.metrics} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function CompletionFrame({
  children,
  status,
}: {
  children: React.ReactNode;
  status: TaskCompletionMessage["payload"]["status"];
}) {
  if (status === "completed") return <>{children}</>;

  const frameClass =
    status === "partial"
      ? "border-yellow-200 bg-yellow-50/45 dark:border-yellow-900/60 dark:bg-yellow-950/15"
      : "border-red-200 bg-red-50/45 dark:border-red-900/60 dark:bg-red-950/15";

  return (
    <div className={clsx("rounded-lg border p-3 shadow-sm", frameClass)}>
      {children}
    </div>
  );
}
