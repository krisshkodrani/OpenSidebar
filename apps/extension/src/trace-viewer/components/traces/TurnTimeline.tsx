import React from "react";
import type { TraceEntry } from "../../../types/traces";
import { formatDuration } from "../../utils";
import { useStore } from "../../store";

interface TurnTimelineProps {
  entries: TraceEntry[];
}

/** Build a plain-text title string: "T3 - 1.2s - click [5]" */
function buildTitle(entry: TraceEntry, turnNum: number): string {
  const dur = entry.llmResponse?.durationMs ?? 0;
  const tier = entry.llmRequest?.modelTier;
  const parts: string[] = [`T${turnNum} - ${formatDuration(dur)}`];
  if (tier) parts[0] += ` - ${tier}`;

  const calls = entry.llmResponse?.toolCalls;
  if (calls && calls.length > 0) {
    for (const tc of calls) {
      const name = tc.function.name;
      try {
        const args = JSON.parse(tc.function.arguments);
        if (args.id != null) {
          parts.push(`${name} [${args.id}]`);
          continue;
        }
        if (args.url) {
          parts.push(`${name} -> ${args.url.slice(0, 40)}`);
          continue;
        }
        if (args.direction) {
          parts.push(`${name} ${args.direction}`);
          continue;
        }
        if (args.text) {
          const t =
            args.text.length > 30 ? `${args.text.slice(0, 27)}...` : args.text;
          parts.push(`${name} "${t}"`);
          continue;
        }
        if (args.key) {
          parts.push(`${name} ${args.key}`);
          continue;
        }
        parts.push(name);
      } catch {
        parts.push(name);
      }
    }
  } else {
    const text = entry.llmResponse?.content;
    if (text) {
      const preview = text.length > 60 ? `${text.slice(0, 57)}...` : text;
      parts.push(`message: ${preview}`);
    }
  }

  return parts.join("\n");
}

export default function TurnTimeline({ entries }: TurnTimelineProps) {
  const navigateToTurn = useStore((s) => s.navigateToTurn);

  if (entries.length < 2) {
    return (
      <div className="mb-3 rounded border border-trace-border bg-trace-panel px-3 py-2 text-[12px] text-trace-muted">
        Turn timeline needs at least two turns.
      </div>
    );
  }

  const durations = entries.map((e) => e.llmResponse?.durationMs ?? 0);
  const maxDuration = Math.max(...durations, 1);
  const MIN_SEGMENT_WIDTH = 14; // Minimum clickable width per segment
  const totalMinWidth = entries.length * (MIN_SEGMENT_WIDTH + 1); // +1 for gap
  const needsScroll = totalMinWidth > 800;

  return (
    <div className="mb-3">
      <div className="text-[11px] text-trace-muted uppercase tracking-wider mb-1.5 font-semibold">
        Turn Timeline
      </div>
      <div
        className={`flex gap-px h-6 rounded overflow-x-auto bg-trace-accent/[0.12] ${needsScroll ? "overflow-x-auto" : "overflow-hidden"}`}
      >
        {entries.map((entry, i) => {
          const dur = entry.llmResponse?.durationMs ?? 0;
          const widthPct = Math.max((dur / maxDuration) * 100, 2);
          const tier = entry.llmRequest?.modelTier;
          const bgColor =
            tier === "planner"
              ? "bg-state-warning/70 hover:bg-state-warning"
              : "bg-brand-live/60 hover:bg-brand-live";

          const turnNum = entry.turnNumber ?? i + 1;

          return (
            <button
              key={i}
              type="button"
              className={`${bgColor} border-0 p-0 transition-colors cursor-pointer shrink-0`}
              style={{
                width: needsScroll ? `${MIN_SEGMENT_WIDTH}px` : `${widthPct}%`,
                minWidth: `${MIN_SEGMENT_WIDTH}px`,
              }}
              title={buildTitle(entry, turnNum)}
              aria-label={`Jump to turn ${turnNum}`}
              onClick={() => navigateToTurn(turnNum)}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[11px] text-trace-dim">
        <span>T1</span>
        <div className="flex gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-brand-live/60" /> executor
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-state-warning/70" /> planner
          </span>
        </div>
        <span>T{entries.length}</span>
      </div>
    </div>
  );
}
