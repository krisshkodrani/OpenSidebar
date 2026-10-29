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
  elapsed: number;
  isExpanded: boolean;
  mode: PlanStripMode;
  onToggle: () => void;
  pendingPlan: PendingPlanConfirmation | null;
  rows: PlanRow[];
}) {
  const Chevron = isExpanded ? ChevronUp : ChevronDown;
  const current = rows.find((row) => row.status === "running");
  const currentLabel = current?.label ?? current?.description;

  return (
    <button
      onClick={onToggle}
      className="flex min-h-[30px] w-full cursor-pointer select-none items-center gap-1.5 px-3 py-1.5"
    >
      {mode === "planning" ? (
        <>
          <ClipboardList
            size={11}
            className="shrink-0 animate-pulse text-fg-tertiary"
          />
          <span className="animate-pulse text-ui-caption font-medium uppercase tracking-[0.08em] text-fg-tertiary">
            Plan
          </span>
          <span className="text-ui-caption text-fg-tertiary">
            Planning...
          </span>
        </>
      ) : mode === "confirmation" && pendingPlan ? (
        <>
          <ClipboardList
            size={11}
            className="shrink-0 text-accent-text"
          />
          <span className="text-ui-caption font-medium uppercase tracking-[0.08em] text-accent-text">
            Plan
          </span>
          <span
            className={`text-ui-caption text-accent-text ${
              confirmed ? "animate-pulse" : ""
            }`}
          >
            {confirmed ? "Starting..." : "Plan ready"}
          </span>
          {pendingPlan.difficulty ? (
            <span className="rounded-full bg-accent-subtle px-1 py-0.5 text-ui-caption text-accent-text">
              {pendingPlan.difficulty}
            </span>
          ) : null}
          <span className="ml-auto text-ui-caption tabular-nums text-accent-text">
            {pendingPlan.nodes.length} steps
          </span>
        </>
      ) : (
        <>
          <span className="text-ui-caption font-medium uppercase tracking-[0.08em] text-fg-tertiary">
            Plan
          </span>
          <PlanProgressBar rows={rows} />
          <span className="ml-1 max-w-[12rem] truncate text-ui-caption text-fg-secondary" title={currentLabel}>
            {currentLabel ? `Working: ${currentLabel}` : rows.every((row) => row.status === "completed") ? "Plan completed" : "Plan ready"}
          </span>
          {activeCount > 1 ? (
            <span className="rounded-full bg-accent-subtle px-1 py-0.5 text-ui-caption text-accent-text">
              {activeCount} active
            </span>
          ) : null}
          {blockedCount > 0 ? (
            <span className="rounded-full bg-warning-subtle px-1 py-0.5 text-ui-caption text-warning">
              {blockedCount} blocked
            </span>
          ) : null}
          <span className="ml-auto text-ui-caption tabular-nums text-fg-tertiary">
            {formatPlanElapsed(elapsed)}
          </span>
        </>
      )}
      <Chevron
        size={12}
        className="ml-1 shrink-0 text-fg-tertiary"
      />
    </button>
  );
}
