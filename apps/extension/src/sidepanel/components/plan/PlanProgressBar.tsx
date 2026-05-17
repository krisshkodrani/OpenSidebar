import React from "react";
import type { PlanRow } from "../../plan-board-view";

export function PlanProgressBar({ rows }: { rows: PlanRow[] }) {
  if (rows.length === 0) return null;
  const completedCount = rows.filter((row) => row.status === "completed").length;
  const hasFailed = rows.some((row) => row.status === "failed");
  const hasStopped = rows.some((row) => row.status === "stopped");

  return (
    <div
      className="flex items-center gap-1"
      role="progressbar"
      aria-label={`${completedCount} of ${rows.length} steps completed`}
    >
      <div className="flex h-2 min-w-[60px] max-w-[160px] flex-1 overflow-hidden rounded-full bg-warm-200 dark:bg-warm-700">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`h-full transition-colors duration-300 ${
              row.status === "completed"
                ? "bg-green-500"
                : row.status === "running"
                  ? "bg-primary-500 animate-pulse"
                  : row.status === "failed"
                    ? "bg-red-500"
                    : row.status === "stopped"
                      ? "bg-amber-500"
                      : row.status === "skipped"
                        ? "bg-warm-400 dark:bg-warm-500"
                        : ""
            }`}
            style={{ flex: 1 }}
            role="presentation"
          />
        ))}
      </div>
      {hasFailed || hasStopped ? (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            hasFailed ? "bg-red-500" : "bg-amber-500"
          }`}
          role="status"
          aria-label={
            hasFailed ? "One or more steps failed" : "One or more steps stopped"
          }
        />
      ) : null}
    </div>
  );
}
