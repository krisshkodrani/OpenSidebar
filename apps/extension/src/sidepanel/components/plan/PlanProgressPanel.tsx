import React from "react";
import { SkipForward } from "lucide-react";
import type { PlanRow } from "../../plan-board-view";
import type { TaskRecoveryState } from "../../../types";
import { compactTaskDisplayLabel } from "../../progress-labels";
import { PlanStepIcon } from "../PlanStepIcon";
import { PlanRecoveryBanner } from "./PlanRecoveryBanner";

function workerStatusLabel(row: PlanRow): string | null {
  switch (row.workerStatus) {
    case "blocked":
      return "Blocked";
    case "queued":
      return "Queued";
    case "retrying":
      return "Retrying";
    case "running":
      return row.parallelism === "independent" ? "Active" : "Running";
    case "verifying":
      return "Verifying";
    case "cancelled":
      return "Cancelled";
    default:
      return null;
  }
}

function workerStatusClass(row: PlanRow): string {
  if (row.workerStatus === "blocked") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300";
  }
  if (row.workerStatus === "running") {
    return "border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300";
  }
  return "border-warm-200 bg-warm-50 text-warm-600 dark:border-warm-700 dark:bg-warm-900/20 dark:text-warm-300";
}

export function PlanProgressPanel({
  canSkip,
  onResumeRecoveredTask,
  onSkipCurrentStep,
  recovery,
  rows,
  runningRef,
}: {
  canSkip: boolean;
  onResumeRecoveredTask: () => void;
  onSkipCurrentStep: () => void;
  recovery: TaskRecoveryState | null;
  rows: PlanRow[];
  runningRef: (node: HTMLDivElement | null) => void;
}) {
  // Rows without a planner label fall back to the clamped description; the
  // clamp is expandable per row so the precise instruction stays reachable.
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(
    () => new Set(),
  );
  const toggleExpanded = (id: string) =>
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {recovery ? (
        <PlanRecoveryBanner recovery={recovery} onResume={onResumeRecoveredTask} />
      ) : null}

      <div className="ml-1">
        {rows.map((row, index) => {
          const compactDescription = compactTaskDisplayLabel(row.description);
          const displayDescription = row.label ?? compactDescription;
          // A label always differs from the instruction, so keep the full
          // text one hover away; expansion is only offered on the fallback
          // path, where the clamp is what hides information.
          const expandable = !row.label && compactDescription.length > 90;
          const isExpanded = expandedRows.has(row.id);
          return (
            <div
              key={row.id}
              ref={row.status === "running" ? runningRef : undefined}
              className="flex items-start gap-2"
            >
              <div className="flex flex-col items-center">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <PlanStepIcon status={row.status} size={14} />
                </div>
                {index < rows.length - 1 ? (
                  <div
                    className={`min-h-[10px] w-0.5 flex-1 ${
                      row.status === "completed"
                        ? "bg-teal-400/60 dark:bg-teal-600/50"
                        : "bg-warm-200/70 dark:bg-warm-700/50"
                    }`}
                  />
                ) : null}
              </div>
              <div
                className={`min-w-0 flex-1 pb-2 ${
                  row.status === "running"
                    ? "-ml-0.5 border-l-[3px] border-primary-400 pl-2 dark:border-primary-600"
                    : ""
                }`}
              >
                <span
                  title={
                    displayDescription === row.description
                      ? undefined
                      : row.description
                  }
                  className={`text-xs leading-relaxed ${
                    row.status === "running"
                      ? "font-medium text-warm-800 dark:text-warm-100"
                      : row.status === "pending"
                        ? "text-warm-500 dark:text-warm-400"
                        : "text-warm-600 dark:text-warm-300"
                  }`}
                >
                  {expandable && !isExpanded ? (
                    <span className="line-clamp-2">{compactDescription}</span>
                  ) : isExpanded ? (
                    compactDescription
                  ) : (
                    displayDescription
                  )}
                  {expandable ? (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(row.id)}
                      className="ml-1 align-middle text-[10px] font-medium text-primary-600 hover:underline dark:text-primary-400"
                    >
                      {isExpanded ? "less" : "more"}
                    </button>
                  ) : null}
                  {row.selectedSkillId ? (
                    <span className="ml-1.5 inline-flex rounded bg-primary-100 px-1 py-0.5 align-middle text-[9px] font-normal text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                      {row.selectedSkillId}
                    </span>
                  ) : null}
                  {workerStatusLabel(row) ? (
                    <span
                      className={`ml-1.5 inline-flex rounded border px-1 py-0.5 align-middle text-[9px] font-normal ${workerStatusClass(
                        row,
                      )}`}
                    >
                      {workerStatusLabel(row)}
                    </span>
                  ) : null}
                </span>
                {row.workerStatusDetail &&
                (row.workerStatus === "running" ||
                  row.workerStatus === "blocked" ||
                  row.workerStatus === "queued" ||
                  row.workerStatus === "retrying") ? (
                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-warm-500 dark:text-warm-400">
                    {row.workerStatusDetail}
                  </div>
                ) : null}
                {row.evidenceSnippet &&
                row.status !== "pending" &&
                row.status !== "running" ? (
                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-warm-500 dark:text-warm-400">
                    {row.evidenceSnippet}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {canSkip ? (
        <div className="mt-1 flex justify-end">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onSkipCurrentStep();
            }}
            className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30"
          >
            <SkipForward size={10} />
            Skip step
          </button>
        </div>
      ) : null}
    </>
  );
}
