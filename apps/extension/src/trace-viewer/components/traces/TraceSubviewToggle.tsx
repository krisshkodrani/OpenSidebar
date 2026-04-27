import React from "react";
import { useStore } from "../../store";
import type { Subview } from "../../store/types";

export default function TraceSubviewToggle() {
  const activeSubview = useStore((s) => s.activeSubview);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const entries = useStore((s) => s.currentEntries);

  const turnCount = entries.length;
  const perceptionCount = entries.filter((e) => e.perception).length;

  const views: { key: Subview; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "plan", label: "Plan" },
    { key: "turns", label: `Turns (${turnCount})` },
    { key: "perception", label: `Perception (${perceptionCount})` },
    { key: "prompts", label: "Prompts" },
    { key: "skills", label: "Skills" },
    { key: "logs", label: "Logs" },
  ];

  return (
    <div className="flex gap-0.5 px-5 pt-2 bg-trace-panel border-b border-trace-border shrink-0 overflow-x-auto scrollbar-thin">
      {views.map((v) => (
        <button
          key={v.key}
          onClick={() => setActiveSubview(v.key)}
          className={`shrink-0 whitespace-nowrap px-4 py-1.5 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${
            activeSubview === v.key
              ? "text-trace-accent-light border-trace-accent"
              : "text-trace-muted border-transparent hover:text-trace-subtle"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
