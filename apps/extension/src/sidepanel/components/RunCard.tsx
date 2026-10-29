import React from "react";
import type { TaskRailTone } from "../task-ui-state";

/**
 * RunCard — the single surface that holds a run's status and its plan/step
 * timeline. It replaces the previous layout where the plan bar and the status
 * rail were two detached surfaces stacked on top of each other. The rail
 * (status + telemetry + controls) and the plan strip (step timeline) are passed
 * in as children and separated by a hairline; a small live marker appears
 * while the agent is running.
 *
 * Presentational only — all run state/behaviour still lives in the children
 * (`PrimaryTaskRail`, `PlanStrip`) and their shared `useTaskUiState` machine.
 */
export function RunCard({
  running,
  tone,
  children,
}: {
  running: boolean;
  tone: TaskRailTone;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label="Agent run"
      data-run-tone={tone}
      className="mx-3 mt-2 overflow-hidden rounded-xl border border-line bg-surface shadow-sm"
    >
      {running ? (
        <div className="h-[3px] w-full bg-surface-subtle" role="presentation">
          <span className="block h-full w-12 rounded-r-full bg-accent" />
        </div>
      ) : null}
      <div className="divide-y divide-line">
        {children}
      </div>
    </section>
  );
}
