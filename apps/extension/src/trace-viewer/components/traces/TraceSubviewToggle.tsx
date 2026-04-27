import React from "react";
import { useStore } from "../../store";

export default function TraceSubviewToggle() {
  const activeSubview = useStore((s) => s.activeSubview);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const entries = useStore((s) => s.currentEntries);

  const turnCount = entries.length;
  const perceptionCount = entries.filter((e) => e.perception).length;

  const views = [
    { key: "turns" as const, label: `Turns (${turnCount})` },
    { key: "perception" as const, label: `Perception (${perceptionCount})` },
    { key: "logs" as const, label: "Logs" },
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
