import React from "react";
import { SkipForward } from "lucide-react";
import type { PlanRow } from "../../plan-board-view";
import type { TaskRecoveryState } from "../../../types";
import { PlanStepIcon } from "../PlanStepIcon";
import { PlanRecoveryBanner } from "./PlanRecoveryBanner";

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
  return (
    <>
      {recovery ? (
        <PlanRecoveryBanner recovery={recovery} onResume={onResumeRecoveredTask} />
      ) : null}

      <div className="ml-1">
        {rows.map((row, index) => (
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
                  className={`min-h-[8px] w-px flex-1 ${
                    row.status === "completed"
                      ? "bg-green-300/60 dark:bg-green-700/40"
                      : "bg-warm-200/60 dark:bg-warm-700/40"
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
                className={`text-xs leading-relaxed ${
                  row.status === "running"
                    ? "font-medium text-warm-800 dark:text-warm-100"
                    : row.status === "pending"
                      ? "text-warm-500 dark:text-warm-400"
                      : "text-warm-600 dark:text-warm-300"
                }`}
              >
                {row.description}
                {row.selectedSkillId ? (
                  <span className="ml-1.5 inline-flex rounded bg-primary-100 px-1 py-0.5 align-middle text-[9px] font-normal text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                    {row.selectedSkillId}
                  </span>
                ) : null}
              </span>
              {row.evidenceSnippet &&
              row.status !== "pending" &&
              row.status !== "running" ? (
                <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-warm-500 dark:text-warm-400">
                  {row.evidenceSnippet}
                </div>
              ) : null}
            </div>
          </div>
        ))}
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
