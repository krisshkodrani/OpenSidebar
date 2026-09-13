import React, { useMemo } from "react";
import type { TraceSession } from "../../../../types/traces";
import { useStore } from "../../../store";
import { buildRunStory } from "../../../analysis/spine";
import TrajectorySpine from "./TrajectorySpine";
import SystemEventsDrawer from "./SystemEventsDrawer";
import AdjudicationPanel from "./AdjudicationPanel";
import { TurnChip } from "./spine-ui";
import EvidenceBoard from "./EvidenceBoard";

// The Story subview — the run's trajectory as a narrative a HUMAN reads to
// adjudicate the outcome and understand the big picture. Builds the spine from
// the run events + turns already in the store; degrades gracefully to a
// turns-only story when the session has no orchestrator run (no runId → no run
// events were fetched).

export default function StoryTab({ session }: { session: TraceSession }) {
  const runEvents = useStore((s) => s.currentRunEvents);
  const entries = useStore((s) => s.currentEntries);
  const navigateToTurn = useStore((s) => s.navigateToTurn);

  const story = useMemo(
    () => buildRunStory(runEvents, entries, session),
    [runEvents, entries, session],
  );

  const noRunEvents = !story.hasRunEvents;

  return (
    <div className="flex flex-col gap-3">
      <EvidenceBoard session={session} />

      <AdjudicationPanel session={session} story={story} />

      {noRunEvents && (
        <div className="rounded-lg border border-trace-border bg-trace-panel/60 px-3 py-2 text-[11px] text-trace-muted">
          No orchestrator run events for this session — showing the turn
          sequence only. Multi-node plan, verification, and judge rulings appear
          for orchestrated runs.
        </div>
      )}

      <TrajectorySpine story={story} onOpenTurn={navigateToTurn} />

      {story.looseTurns.length > 0 && (
        <div className="rounded-lg border border-trace-border bg-trace-panel/60 p-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-trace-muted">
            Unassigned turns
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {story.looseTurns.map((t) => (
              <TurnChip
                key={t.turnNumber}
                turnNumber={t.turnNumber}
                onClick={navigateToTurn}
              />
            ))}
          </div>
        </div>
      )}

      <SystemEventsDrawer
        systemEvents={story.systemEvents}
        unknownEvents={story.unknownEvents}
      />
    </div>
  );
}
