import React from "react";
import type { TraceEvent } from "../../../types/traces";
import Badge from "../Badge";
import { summarizeEventData } from "../../utils";

export default function TurnEventsSection({ events }: { events: TraceEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mb-2.5">
      <div className="text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1.5">Events</div>
      {events.map((ev, i) => (
        <div key={i} className="flex items-center gap-2 py-1 text-xs flex-wrap">
          <Badge variant={`event-${ev.type}` as `event-${string}`}>{ev.type}</Badge>
          {ev.data && typeof ev.data === "object" && Object.keys(ev.data).length > 0 && (
            <span className="text-[11px] text-trace-muted font-mono break-all">
              {summarizeEventData({ data: ev.data as Record<string, unknown> })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
