import React from "react";
import Badge from "../Badge";
import { summarizeEventData } from "../../utils";

interface TraceEvent {
  type: string;
  data?: Record<string, unknown>;
}

interface TurnEventsSectionProps {
  events: TraceEvent[];
}

export default function TurnEventsSection({ events }: TurnEventsSectionProps) {
  if (events.length === 0) return null;

  return (
    <div className="mb-2.5">
      <div className="text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1.5">
        Events
      </div>
      {events.map((ev, i) => (
        <div key={i} className="flex items-center gap-2 py-1 text-xs flex-wrap">
          <Badge variant={`event-${ev.type}` as `event-${string}`}>
            {ev.type}
          </Badge>
          {ev.data && Object.keys(ev.data).length > 0 && (
            <span className="text-[11px] text-trace-muted font-mono break-all">
              {summarizeEventData(ev)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
