import React from "react";
import Tooltip from "./Tooltip";

// One metric tile, replacing the near-identical `SummaryMetric` (Investigation
// Summary) and `MetricCard` (TraceDetailHeader) inline components. Tone only
// colors the value, so a grid of tiles stays calm until something is wrong.

export type StatTone = "neutral" | "warning" | "error" | "success";

const VALUE_TONE: Record<StatTone, string> = {
  neutral: "text-trace-text",
  warning: "text-state-warning",
  error: "text-state-error",
  success: "text-state-success",
};

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  tone?: StatTone;
  /** Optional muted line rendered under the value. */
  sub?: React.ReactNode;
  /** Optional tooltip shown on hover. */
  hint?: React.ReactNode;
  className?: string;
}

export default function StatTile({
  label,
  value,
  tone = "neutral",
  sub,
  hint,
  className = "",
}: StatTileProps) {
  const tile = (
    <div
      className={`min-w-0 rounded border border-trace-border/70 bg-trace-bg px-2.5 py-2 ${
        hint ? "cursor-help" : ""
      } ${className}`}
    >
      <div className="truncate text-[10px] uppercase tracking-wide text-trace-subtle">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold tabular-nums ${VALUE_TONE[tone]}`}>
        {value}
      </div>
      {sub != null && (
        <div className="mt-1 truncate text-[10px] text-trace-muted">{sub}</div>
      )}
    </div>
  );
  return hint ? <Tooltip content={hint}>{tile}</Tooltip> : tile;
}
