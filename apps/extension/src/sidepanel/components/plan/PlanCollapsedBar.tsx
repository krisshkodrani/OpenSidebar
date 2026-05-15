import React from "react";
import { ChevronDown, ChevronUp, ClipboardList } from "lucide-react";
import type { PendingPlanConfirmation } from "../../../types";
import type { PlanRow } from "../../plan-board-view";
import { formatPlanElapsed, type PlanStripMode } from "../../plan-strip-view-model";
import { PlanProgressBar } from "./PlanProgressBar";

export function PlanCollapsedBar({
  activeCount,
  blockedCount,
  confirmed,
  currentIndex,
  elapsed,
  isExpanded,
  mode,
  onToggle,
  pendingPlan,
  rows,
}: {
  activeCount: number;
  blockedCount: number;
  confirmed: boolean;
  currentIndex: number;
  elapsed: number;
  isExpanded: boolean;
  mode: PlanStripMode;
  onToggle: () => void;
  pendingPlan: PendingPlanConfirmation | null;
  rows: PlanRow[];
}) {
  const Chevron = isExpanded ? ChevronUp : ChevronDown;

  return (
    <button
      onClick={onToggle}
      className="flex min-h-[30px] w-full cursor-pointer select-none items-center gap-1.5 px-3 py-1.5"
    >
      {mode === "planning" ? (
        <>
          <ClipboardList
            size={11}
            className="shrink-0 animate-pulse text-warm-400 dark:text-warm-500"
          />
          <span className="animate-pulse text-[10px] font-medium uppercase tracking-[0.08em] text-warm-500 dark:text-warm-400">
            Plan
          </span>
          <span className="text-[11px] text-warm-500 dark:text-warm-400">
            Planning...
          </span>
        </>
      ) : mode === "confirmation" && pendingPlan ? (
        <>
          <ClipboardList
            size={11}
            className="shrink-0 text-primary-600 dark:text-primary-400"
          />
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-primary-600 dark:text-primary-400">
            Plan
          </span>
          <span
            className={`text-[11px] text-primary-800 dark:text-primary-200 ${
              confirmed ? "animate-pulse" : ""
            }`}
          >
            {confirmed ? "Starting..." : "Plan ready"}
          </span>
          {pendingPlan.difficulty ? (
            <span className="rounded-full bg-primary-100 px-1 py-0.5 text-[9px] text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
              {pendingPlan.difficulty}
            </span>
          ) : null}
          <span className="ml-auto text-[10px] tabular-nums text-primary-600 dark:text-primary-400">
            {pendingPlan.nodes.length} steps
          </span>
        </>
      ) : (
        <>
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-warm-500 dark:text-warm-400">
            Plan
          </span>
          <PlanProgressBar rows={rows} />
          <span className="ml-1 text-[11px] tabular-nums text-warm-700 dark:text-warm-200">
            {`Step ${currentIndex + 1}/${rows.length}`}
          </span>
          {activeCount > 1 ? (
            <span className="rounded-full bg-primary-100 px-1 py-0.5 text-[9px] text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
              {activeCount} active
            </span>
          ) : null}
          {blockedCount > 0 ? (
            <span className="rounded-full bg-amber-100 px-1 py-0.5 text-[9px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {blockedCount} blocked
            </span>
          ) : null}
          <span className="ml-auto text-[10px] tabular-nums text-warm-500 dark:text-warm-400">
            {formatPlanElapsed(elapsed)}
          </span>
        </>
      )}
      <Chevron
        size={12}
        className="ml-1 shrink-0 text-warm-500 dark:text-warm-400"
      />
    </button>
  );
}
