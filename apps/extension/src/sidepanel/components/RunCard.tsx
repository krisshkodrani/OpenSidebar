import React from "react";
import type { TaskRailTone } from "../task-ui-state";

/** Shared task surface: progress and controls, followed by expandable steps. */
export function RunCard({
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
      className="mx-3 mt-2 overflow-hidden rounded-xl border border-warm-200/80 bg-white dark:border-warm-700 dark:bg-warm-900"
    >
      <div className="divide-y divide-warm-200/60 dark:divide-warm-700/40">
        {children}
      </div>
    </section>
  );
}
