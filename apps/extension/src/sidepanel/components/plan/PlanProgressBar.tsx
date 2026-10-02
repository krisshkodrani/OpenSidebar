import React from "react";
import type { PlanRow } from "../../plan-board-view";

export function PlanProgressBar({ rows }: { rows: PlanRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div
      className="flex items-center gap-1.5"
      role="group"
      aria-label="Plan step states"
    >
      {rows.map((row) => (
        <span
          key={row.id}
          className={`h-2 w-2 shrink-0 rounded-full border ${
            row.status === "completed"
              ? "border-green-600 bg-green-500"
              : row.status === "running"
                ? "border-primary-600 bg-brand-highlight"
                : row.status === "failed"
                  ? "border-red-600 bg-red-500"
                  : row.status === "stopped"
                    ? "border-amber-600 bg-amber-500"
                    : row.status === "skipped"
                      ? "border-warm-400 bg-warm-400"
                      : "border-warm-300 bg-transparent dark:border-warm-600"
          }`}
          role="img"
          aria-label={`Step ${row.status}`}
        />
      ))}
    </div>
  );
}
