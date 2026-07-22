import React from "react";
import type { TaskRailTone } from "../task-ui-state";

/**
 * RunCard — the single surface that holds a run's status and its plan/step
 * timeline. It replaces the previous layout where the plan bar and the status
 * rail were two detached surfaces stacked on top of each other. The rail
 * (status + telemetry + controls) and the plan strip (step timeline) are passed
 * in as children and separated by a hairline; a slim shimmer bar rides the top
 * edge while the agent is running.
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
      className="mx-3 mt-2 overflow-hidden rounded-xl border border-warm-200/80 bg-white/75 shadow-glass dark:border-warm-700/60 dark:bg-warm-900/55"
    >
      {running ? (
        <div
          className="h-[3px] w-full bg-warm-100 dark:bg-warm-800"
          role="presentation"
        >
          <span
            className="block h-full animate-shimmer"
            style={{
              width: "55%",
              background: "linear-gradient(90deg, #14b8a6, #2563eb)",
              backgroundSize: "200% 100%",
            }}
          />
        </div>
      ) : null}
      <div className="divide-y divide-warm-200/60 dark:divide-warm-700/40">
        {children}
      </div>
    </section>
  );
}
