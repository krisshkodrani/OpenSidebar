import React, { useState } from "react";
import { useStore } from "../../store";
import type { Subview } from "../../store/types";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";

// The four diagnostic panes grouped behind the single "Debug" top tab. They
// stay first-class Subview values (deep links like #view=perception and the
// 4-7 keyboard shortcuts keep working); only their tab presentation is grouped.
const DEBUG_PANES: readonly Subview[] = [
  "perception",
  "prompts",
  "logs",
  "skills",
];

export default function TraceSubviewToggle() {
  const activeSubview = useStore((s) => s.activeSubview);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const entries = useStore((s) => s.currentEntries);

  const turnCount = entries.length;
  const perceptionCount = entries.filter((e) => e.perception).length;

  // Remember the last-used debug pane so re-entering Debug lands where the
  // user left off (defaults to perception).
  const [lastDebugPane, setLastDebugPane] = useState<Subview>("perception");
  const isDebugActive = DEBUG_PANES.includes(activeSubview);

  const topTabs: { key: string; label: string }[] = [
    { key: "story", label: "Story" },
    { key: "plan", label: "Plan" },
    { key: "turns", label: `Turns (${turnCount})` },
    { key: "debug", label: "Debug" },
  ];

  const debugPanes: { key: Subview; label: string }[] = [
    { key: "perception", label: `Perception (${perceptionCount})` },
    { key: "prompts", label: "Prompts" },
    { key: "logs", label: "Logs" },
    { key: "skills", label: "Skills" },
  ];

  const activeTopTab = isDebugActive ? "debug" : activeSubview;

  const selectTopTab = (key: string) => {
    if (key === "debug") {
      setActiveSubview(lastDebugPane);
    } else {
      setActiveSubview(key as Subview);
    }
  };

  const selectDebugPane = (key: Subview) => {
    setLastDebugPane(key);
    setActiveSubview(key);
  };

  return (
    <div className="bg-trace-panel border-b border-trace-border shrink-0">
      <Tabs
        value={activeTopTab}
        onValueChange={selectTopTab}
        className="overflow-x-auto scrollbar-thin"
      >
        <TabsList className="flex h-auto justify-start gap-0.5 rounded-none bg-transparent px-5 pt-2 pb-0 text-trace-muted">
          {topTabs.map((v) => (
            <TabsTrigger
              key={v.key}
              value={v.key}
              onClick={() => selectTopTab(v.key)}
              className="shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-4 py-1.5 text-xs font-semibold text-trace-muted shadow-none transition-colors hover:text-trace-subtle data-[state=active]:border-trace-accent data-[state=active]:bg-transparent data-[state=active]:text-trace-accent-light data-[state=active]:shadow-none"
            >
              {v.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {isDebugActive && (
        <div className="flex items-center gap-1 px-5 py-1.5 border-t border-trace-border/50">
          {debugPanes.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => selectDebugPane(p.key)}
              className={`shrink-0 whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                activeSubview === p.key
                  ? "bg-trace-accent/15 text-trace-accent-light"
                  : "text-trace-muted hover:text-trace-text"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
