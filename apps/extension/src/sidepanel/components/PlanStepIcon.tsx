import React from "react";
import { Check, SkipForward, Square, X } from "lucide-react";
import type { PlanRowStatus } from "../plan-board-view";

/**
 * A step node in the run/plan timeline. State is encoded in the node's form so
 * it reads at a glance: teal-filled check = done, a primary ring with a pulsing
 * centre = active, a hollow ring = pending. `size` is the icon glyph size; the
 * node itself is drawn a few px larger around it.
 */
export function PlanStepIcon({
  status,
  size = 12,
}: {
  status: PlanRowStatus;
  size?: number;
}) {
  const box = { width: size + 4, height: size + 4 };
  const base = "flex shrink-0 items-center justify-center rounded-full";
  const glyph = Math.round(size * 0.72);

  if (status === "completed") {
    return (
      <span style={box} className={`${base} bg-teal-500 text-white`}>
        <Check size={glyph} strokeWidth={3} />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span
        style={box}
        className={`${base} border-2 border-primary-500 bg-white shadow-[0_0_0_4px_rgba(59,130,246,0.15)] dark:bg-warm-900`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-primary-500 animate-pulse" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span style={box} className={`${base} bg-red-500 text-white`}>
        <X size={glyph} strokeWidth={3} />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span
        style={box}
        className={`${base} border-2 border-warm-300 text-warm-400 dark:border-warm-600`}
      >
        <SkipForward size={Math.round(size * 0.6)} />
      </span>
    );
  }
  if (status === "stopped") {
    return (
      <span style={box} className={`${base} bg-amber-500 text-white`}>
        <Square size={Math.round(size * 0.5)} fill="currentColor" />
      </span>
    );
  }
  return (
    <span
      style={box}
      className={`${base} border-2 border-warm-300 dark:border-warm-600`}
    />
  );
}
