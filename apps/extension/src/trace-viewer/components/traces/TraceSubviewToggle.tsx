import React from "react";
import { useStore } from "../../store";
import type { Subview } from "../../store/types";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";

export default function TraceSubviewToggle() {
  const activeSubview = useStore((s) => s.activeSubview);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const entries = useStore((s) => s.currentEntries);

  const turnCount = entries.length;
  const perceptionCount = entries.filter((e) => e.perception).length;

  const views: { key: Subview; label: string }[] = [
    { key: "story", label: "Story" },
    { key: "overview", label: "Overview" },
    { key: "plan", label: "Plan" },
    { key: "turns", label: `Trajectory (${turnCount})` },
    { key: "trajectory", label: "RL Trajectory" },
    { key: "perception", label: `Perception (${perceptionCount})` },
    { key: "prompts", label: "Prompts" },
    { key: "skills", label: "Skills" },
    { key: "logs", label: "Logs" },
  ];

  return (
    <Tabs
      value={activeSubview}
      onValueChange={(value) => setActiveSubview(value as Subview)}
      className="bg-trace-panel border-b border-trace-border shrink-0 overflow-x-auto scrollbar-thin"
    >
      <TabsList className="flex h-auto justify-start gap-0.5 rounded-none bg-transparent px-5 pt-2 pb-0 text-trace-muted">
      {views.map((v) => (
        <TabsTrigger
          key={v.key}
          value={v.key}
          onClick={() => setActiveSubview(v.key)}
          className="shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent bg-transparent px-4 py-1.5 text-xs font-semibold text-trace-muted shadow-none transition-colors hover:text-trace-subtle data-[state=active]:border-trace-accent data-[state=active]:bg-transparent data-[state=active]:text-trace-accent-light data-[state=active]:shadow-none"
        >
          {v.label}
        </TabsTrigger>
      ))}
      </TabsList>
    </Tabs>
  );
}
