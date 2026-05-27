import React, { useState } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Square,
  XCircle,
} from "lucide-react";
import type { TaskCompletionMessage } from "../../../types";
import { formatTokensCompact } from "../../message-formatting";
import { PlanStepIcon } from "../PlanStepIcon";
import { MetricsSummary } from "./MetricsSummary";

type PartialHandoff = NonNullable<
  TaskCompletionMessage["payload"]["partialHandoff"]
>;

function completionLabel(status: TaskCompletionMessage["payload"]["status"]) {
  if (status === "completed") return "Done";
  if (status === "partial") return "Partially done";
  if (status === "stopped") return "Stopped";
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
  if (status === "stopped") {
    return <Square size={13} className="shrink-0 text-amber-500" />;
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
                          : result.status === "stopped"
                            ? "stopped"
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

function HandoffBullets({
  items,
  empty,
}: {
  items: { text: string; confidence?: string }[];
  empty: string;
}) {
  const visible = items.slice(0, 4);
  return (
    <ul className="mt-1 space-y-1 text-xs text-warm-700 dark:text-warm-200">
      {visible.length > 0 ? (
        visible.map((item, index) => (
          <li key={index} className="leading-snug">
            <span className="text-warm-400">- </span>
            {item.text}
            {item.confidence ? (
              <span className="ml-1 text-[10px] uppercase text-warm-400">
                {item.confidence}
              </span>
            ) : null}
          </li>
        ))
      ) : (
        <li className="text-warm-400">{empty}</li>
      )}
    </ul>
  );
}

export function PartialHandoffPanel({
  handoff,
}: {
  handoff?: PartialHandoff;
}) {
  const [copied, setCopied] = useState(false);
  if (!handoff) return null;

  const handleCopy = () => {
    void navigator.clipboard.writeText(handoff.suggestedContinuationPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="completion-meta-enter mt-3 border-t border-yellow-200/70 pt-3 dark:border-yellow-900/50">
      <div className="flex items-center gap-2">
        <AlertTriangle size={13} className="shrink-0 text-yellow-500" />
        <div className="min-w-0 text-xs font-semibold text-warm-700 dark:text-warm-200">
          Partial handoff
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto rounded-md p-1.5 text-warm-500 transition-colors hover:bg-yellow-100 hover:text-warm-800 dark:hover:bg-yellow-950/30 dark:hover:text-warm-100"
          title="Copy continuation prompt"
          aria-label="Copy continuation prompt"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <div className="mt-2 grid gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase text-warm-500 dark:text-warm-400">
            Evidence
          </div>
          <ul className="mt-1 space-y-1 text-xs text-warm-700 dark:text-warm-200">
            {handoff.evidence.length > 0 ? (
              handoff.evidence.slice(0, 4).map((item, index) => (
                <li key={index} className="leading-snug">
                  <span className="text-warm-400">- </span>
                  <span className="font-medium">{item.label}:</span>{" "}
                  {item.value}
                </li>
              ))
            ) : (
              <li className="text-warm-400">No durable evidence captured.</li>
            )}
          </ul>
        </div>
        {handoff.currentState.url || handoff.currentState.title ? (
          <div className="text-xs leading-snug text-warm-600 dark:text-warm-300">
            <span className="font-semibold">Current state:</span>{" "}
            {[
              handoff.currentState.title,
              handoff.currentState.url,
              handoff.currentState.activeSubtask,
            ]
              .filter(Boolean)
              .join(" | ")}
          </div>
        ) : null}
        <div>
          <div className="text-[11px] font-semibold uppercase text-warm-500 dark:text-warm-400">
            Remaining
          </div>
          <HandoffBullets
            items={handoff.remaining}
            empty="Resume from the current page and finish the original request."
          />
        </div>
        {handoff.uncertainty.length > 0 ? (
          <div>
            <div className="text-[11px] font-semibold uppercase text-warm-500 dark:text-warm-400">
              Uncertainty
            </div>
            <HandoffBullets items={handoff.uncertainty} empty="" />
          </div>
        ) : null}
        <details className="text-xs text-warm-600 dark:text-warm-300">
          <summary className="cursor-pointer text-warm-500 hover:text-warm-700 dark:hover:text-warm-200">
            Continuation prompt
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white/60 p-2 text-[11px] leading-relaxed dark:bg-black/20">
            {handoff.suggestedContinuationPrompt}
          </pre>
        </details>
      </div>
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
    status === "partial" || status === "stopped"
      ? "border-yellow-200 bg-yellow-50/45 dark:border-yellow-900/60 dark:bg-yellow-950/15"
      : "border-red-200 bg-red-50/45 dark:border-red-900/60 dark:bg-red-950/15";

  return (
    <div className={clsx("rounded-lg border p-3 shadow-sm", frameClass)}>
      {children}
    </div>
  );
}
