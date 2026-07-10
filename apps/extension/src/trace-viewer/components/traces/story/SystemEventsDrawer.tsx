import React, { useState } from "react";
import type { SpineMarker, UnknownEventBucket } from "../../../analysis/spine";
import { MarkerRow } from "./spine-ui";

// Low-signal infra events (worker_*, scheduler lane waits, tab coordination…)
// plus a tally of event types the spine doesn't specifically model. Collapsed
// by default — a human adjudicating the run shouldn't wade through scheduler
// bookkeeping, but it must be one click away and never silently dropped.

export default function SystemEventsDrawer({
  systemEvents,
  unknownEvents,
}: {
  systemEvents: SpineMarker[];
  unknownEvents: UnknownEventBucket[];
}) {
  const [open, setOpen] = useState(false);
  const total =
    systemEvents.length + unknownEvents.reduce((n, u) => n + u.count, 0);
  if (total === 0) return null;

  return (
    <div className="rounded-lg border border-trace-border bg-trace-panel/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-trace-muted hover:text-trace-text"
      >
        <span className="font-mono">{open ? "▾" : "▸"}</span>
        <span className="font-semibold uppercase tracking-[0.14em]">
          System events
        </span>
        <span className="text-trace-dim">({total})</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 px-3 pb-3">
          {systemEvents.map((m, i) => (
            <MarkerRow key={`${m.kind}-${i}`} marker={m} />
          ))}
          {unknownEvents.length > 0 && (
            <div className="mt-1 border-t border-trace-border pt-2 text-[10px] text-trace-dim">
              Unmodeled:{" "}
              {unknownEvents
                .map((u) => `${u.type} ×${u.count}`)
                .join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
