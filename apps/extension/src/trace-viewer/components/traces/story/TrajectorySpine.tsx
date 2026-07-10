import React from "react";
import type { RunStory } from "../../../analysis/spine";
import NodeSegmentCard from "./NodeSegmentCard";
import { MarkerRow } from "./spine-ui";

// The vertical trajectory: a plan header, then each node segment as a station
// on a connecting spine line, then the completion markers. This is the "big
// picture" view — how the run actually unfolded, node by node.

export default function TrajectorySpine({
  story,
  onOpenTurn,
}: {
  story: RunStory;
  onOpenTurn: (turnNumber: number) => void;
}) {
  const { plan, segments, completion, preludeMarkers } = story;

  return (
    <div className="flex flex-col gap-3">
      {plan.present && (
        <div className="rounded-lg border border-trace-border bg-trace-panel p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-trace-muted">
              Plan
            </span>
            {typeof plan.nodeCount === "number" && (
              <span className="text-trace-subtle">{plan.nodeCount} node(s)</span>
            )}
            {plan.difficulty && (
              <span className="text-trace-dim">· {plan.difficulty}</span>
            )}
            {plan.structured != null && (
              <span className="text-trace-dim">
                · {plan.structured ? "structured" : "fallback"}
              </span>
            )}
            {plan.confirmationDecision && (
              <span className={plan.confirmed ? "text-state-success" : "text-state-warning"}>
                · {plan.confirmationDecision}
              </span>
            )}
          </div>
          {plan.replans.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {plan.replans.map((m, i) => (
                <MarkerRow key={`replan-${i}`} marker={m} />
              ))}
            </div>
          )}
        </div>
      )}

      {preludeMarkers.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-trace-border bg-trace-panel/60 p-3">
          {preludeMarkers.map((m, i) => (
            <MarkerRow key={`prelude-${i}`} marker={m} />
          ))}
        </div>
      )}

      {segments.length > 0 && (
        <div className="relative flex flex-col gap-3">
          {/* the connecting spine line */}
          {segments.length > 1 && (
            <span className="absolute left-[7px] top-2 bottom-2 w-px bg-trace-border" />
          )}
          {segments.map((seg) => (
            <NodeSegmentCard
              key={seg.nodeId}
              segment={seg}
              onOpenTurn={onOpenTurn}
            />
          ))}
        </div>
      )}

      {completion.markers.length > 0 && (
        <div className="rounded-lg border border-trace-border bg-trace-panel/60 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-trace-muted">
            Completion
          </div>
          <div className="flex flex-col gap-1">
            {completion.markers.map((m, i) => (
              <MarkerRow key={`completion-${i}`} marker={m} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
