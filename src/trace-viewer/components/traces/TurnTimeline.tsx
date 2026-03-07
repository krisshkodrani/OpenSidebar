import React from "react";
import type { TraceEntry } from "../../../types/traces";
import { formatDuration } from "../../utils";

interface TurnTimelineProps {
  entries: TraceEntry[];
}

export default function TurnTimeline({ entries }: TurnTimelineProps) {
  if (entries.length < 2) return null;

  const durations = entries.map((e) => e.llmResponse?.durationMs ?? 0);
  const maxDuration = Math.max(...durations, 1);

  return (
    <div className="mb-4">
      <div className="text-[10px] text-trace-muted uppercase tracking-wider mb-1.5 font-semibold">
        Turn Timeline
      </div>
      <div className="flex gap-px h-6 rounded overflow-hidden bg-[rgba(68,64,60,0.3)]" title="Turn timeline — width = relative duration, color = model tier">
        {entries.map((entry, i) => {
          const dur = entry.llmResponse?.durationMs ?? 0;
          // Minimum width so every turn is visible
          const widthPct = Math.max((dur / maxDuration) * 100, 2);
          const tier = entry.llmRequest?.modelTier;
          const bgColor = tier === "planner"
            ? "bg-amber-500/60 hover:bg-amber-500/80"
            : "bg-cyan-500/50 hover:bg-cyan-500/70";

          return (
            <a
              key={i}
              href={`#turn-${entry.turnNumber ?? i + 1}`}
              className={`${bgColor} transition-colors cursor-pointer relative group`}
              style={{ width: `${widthPct}%`, minWidth: "3px" }}
              title={`Turn ${entry.turnNumber ?? i + 1} — ${formatDuration(dur)}${tier ? ` (${tier})` : ""}`}
            >
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-trace-muted opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                T{entry.turnNumber ?? i + 1}
              </span>
            </a>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[9px] text-trace-dim">
        <span>T1</span>
        <div className="flex gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-cyan-500/60" /> executor
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-amber-500/60" /> planner
          </span>
        </div>
        <span>T{entries.length}</span>
      </div>
    </div>
  );
}
