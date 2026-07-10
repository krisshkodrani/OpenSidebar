import React from "react";
import type { MarkerSeverity, SpineMarker, SegmentStatus } from "../../../analysis/spine";

// Shared visual vocabulary for the trajectory spine: severity/status → the
// trace-viewer's state-color tokens, plus the small marker/turn primitives the
// segment cards reuse. Kept in one place so the spine tells a consistent story.

export const SEVERITY_DOT: Record<MarkerSeverity, string> = {
  info: "bg-trace-muted",
  warn: "bg-state-warning",
  error: "bg-state-error",
  success: "bg-state-success",
};

export const SEVERITY_TEXT: Record<MarkerSeverity, string> = {
  info: "text-trace-subtle",
  warn: "text-state-warning",
  error: "text-state-error",
  success: "text-state-success",
};

export const STATUS_STYLE: Record<
  SegmentStatus,
  { label: string; dot: string; text: string }
> = {
  completed: { label: "completed", dot: "bg-state-success", text: "text-state-success" },
  failed: { label: "failed", dot: "bg-state-error", text: "text-state-error" },
  rerouted: { label: "rerouted", dot: "bg-state-warning", text: "text-state-warning" },
  skipped: { label: "skipped", dot: "bg-trace-muted", text: "text-trace-muted" },
  running: { label: "running", dot: "bg-trace-accent", text: "text-trace-accent-light" },
  unknown: { label: "unknown", dot: "bg-trace-muted", text: "text-trace-muted" },
};

/** A single inline marker (escalation, budget, advisory, reroute…). */
export function MarkerRow({ marker }: { marker: SpineMarker }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span
        className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[marker.severity]}`}
      />
      <span className={`font-medium ${SEVERITY_TEXT[marker.severity]}`}>
        {marker.label}
      </span>
      {marker.detail && (
        <span className="text-trace-dim">— {marker.detail}</span>
      )}
    </div>
  );
}

/** A clickable turn chip that deep-links into the Turns tab. */
export function TurnChip({
  turnNumber,
  onClick,
}: {
  turnNumber: number;
  onClick: (turnNumber: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(turnNumber)}
      className="rounded border border-trace-border bg-trace-bg px-1.5 py-0.5 font-mono text-[10px] text-trace-muted transition-colors hover:border-trace-accent/40 hover:text-trace-accent-light"
      title={`Turn ${turnNumber} — open in Trajectory`}
    >
      {turnNumber}
    </button>
  );
}
