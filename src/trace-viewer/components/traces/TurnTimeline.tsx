import React from "react";
import type { TraceEntry } from "../../../types/traces";
import { formatDuration } from "../../utils";

interface TurnTimelineProps {
  entries: TraceEntry[];
}

/** Build a plain-text title string: "T3 · 1.2s · click [5]" */
function buildTitle(entry: TraceEntry, turnNum: number): string {
  const dur = entry.llmResponse?.durationMs ?? 0;
  const tier = entry.llmRequest?.modelTier;
  const parts: string[] = [`T${turnNum} · ${formatDuration(dur)}`];
  if (tier) parts[0] += ` · ${tier}`;

  const calls = entry.llmResponse?.toolCalls;
  if (calls && calls.length > 0) {
    for (const tc of calls) {
      const name = tc.function.name;
      try {
        const args = JSON.parse(tc.function.arguments);
        if (args.id != null) { parts.push(`${name} [${args.id}]`); continue; }
        if (args.url) { parts.push(`${name} → ${args.url.slice(0, 40)}`); continue; }
        if (args.direction) { parts.push(`${name} ${args.direction}`); continue; }
        if (args.text) {
          const t = args.text.length > 30 ? args.text.slice(0, 27) + "…" : args.text;
          parts.push(`${name} "${t}"`);
          continue;
        }
        if (args.key) { parts.push(`${name} ${args.key}`); continue; }
        parts.push(name);
      } catch {
        parts.push(name);
      }
    }
  } else {
    const text = entry.llmResponse?.content;
    if (text) {
      const preview = text.length > 60 ? text.slice(0, 57) + "…" : text;
      parts.push(`💬 ${preview}`);
    }
  }

  return parts.join("\n");
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
      <div className="flex gap-px h-6 rounded overflow-hidden bg-[rgba(68,64,60,0.3)]">
        {entries.map((entry, i) => {
          const dur = entry.llmResponse?.durationMs ?? 0;
          const widthPct = Math.max((dur / maxDuration) * 100, 2);
          const tier = entry.llmRequest?.modelTier;
          const bgColor = tier === "planner"
            ? "bg-amber-500/60 hover:bg-amber-500/80"
            : "bg-cyan-500/50 hover:bg-cyan-500/70";

          const turnNum = entry.turnNumber ?? i + 1;

          return (
            <a
              key={i}
              href={`#turn-${turnNum}`}
              className={`${bgColor} transition-colors cursor-pointer`}
              style={{ width: `${widthPct}%`, minWidth: "3px" }}
              title={buildTitle(entry, turnNum)}
            />
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
