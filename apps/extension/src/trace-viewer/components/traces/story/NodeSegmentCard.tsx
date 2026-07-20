import React from "react";
import type { NodeSegment } from "../../../analysis/spine";
import { formatDuration } from "../../../utils";
import JudgeCallCard from "./JudgeCallCard";
import { MarkerRow, STATUS_STYLE, TurnChip } from "./spine-ui";

// One node in the run's trajectory: its objective, status, verification, any
// judge rulings, inline markers (escalation/budget/advisory), and the turns
// that ran inside it (each a deep-link into the Trajectory tab). Rendered as a
// station on the vertical spine drawn by TrajectorySpine.

export default function NodeSegmentCard({
  segment,
  onOpenTurn,
}: {
  segment: NodeSegment;
  onOpenTurn: (turnNumber: number) => void;
}) {
  const status = STATUS_STYLE[segment.status];

  return (
    <div className="relative pl-6">
      {/* spine node */}
      <span
        className={`absolute left-[3px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-trace-panel ${status.dot}`}
      />

      <div className="rounded-lg border border-trace-border bg-trace-panel p-3">
        <div className="flex flex-wrap items-center gap-2">
          {!segment.synthetic && (
            <span className="font-mono text-[10px] text-trace-dim">
              #{segment.index + 1}
            </span>
          )}
          <span className="text-sm font-semibold text-trace-text">
            {segment.title}
          </span>
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${status.text}`}>
            {status.label}
          </span>
          {segment.reroutedTo && (
            <span className="text-[10px] text-state-warning">
              → {segment.reroutedTo}
            </span>
          )}
          {typeof segment.durationMs === "number" && (
            <span className="ml-auto text-[10px] text-trace-dim">
              {formatDuration(segment.durationMs)}
            </span>
          )}
        </div>

        {segment.summary && (
          <div className="mt-1 text-[11px] text-trace-subtle">{segment.summary}</div>
        )}

        {segment.verification && (
          <div className="mt-1 text-[10px] text-trace-dim">
            verifier: {segment.verification.decision ?? "—"}
            {typeof segment.verification.confidence === "number"
              ? ` (${segment.verification.confidence.toFixed(2)})`
              : ""}
            {segment.verification.failureType
              ? ` · ${segment.verification.failureType}`
              : ""}
          </div>
        )}

        {segment.failureReason && (
          <div className="mt-1 rounded border border-state-error/25 bg-state-error/5 px-2 py-1 text-[11px] text-state-error">
            {segment.failureReason}
          </div>
        )}

        {segment.judgeCalls.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {segment.judgeCalls.map((call, i) => (
              <JudgeCallCard key={i} call={call} />
            ))}
          </div>
        )}

        {segment.markers.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {segment.markers.map((m, i) => (
              <MarkerRow key={`${m.kind}-${i}`} marker={m} />
            ))}
          </div>
        )}

        {segment.turns.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-trace-muted">turns</span>
            {segment.turns.map((t) => (
              <TurnChip key={t.turnNumber} turnNumber={t.turnNumber} onClick={onOpenTurn} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
