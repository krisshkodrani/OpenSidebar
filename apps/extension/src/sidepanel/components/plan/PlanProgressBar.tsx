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
              ? "border-success bg-success"
              : row.status === "running"
                ? "border-accent bg-accent"
                : row.status === "failed"
                  ? "border-danger bg-danger"
                  : row.status === "stopped"
                    ? "border-warning bg-warning"
                    : row.status === "skipped"
                      ? "border-line-strong bg-line-strong"
                      : "border-line-strong bg-transparent"
          }`}
          role="img"
          aria-label={`Step ${row.status}`}
        />
      ))}
    </div>
  );
}
