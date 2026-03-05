import React from "react";
import { useStore } from "../../store";
import TurnCard from "./TurnCard";

export default function TurnList() {
  const entries = useStore((s) => s.currentEntries);
  const searchQuery = useStore((s) => s.searchQuery);
  const tierFilter = useStore((s) => s.filters.tier);

  const q = searchQuery.toLowerCase().trim();
  let filtered = entries;

  // Filter by model tier (executor/planner)
  if (tierFilter && tierFilter !== "all") {
    filtered = filtered.filter((e) => e.llmRequest?.modelTier === tierFilter);
  }

  if (q) {
    filtered = entries.filter((e) => {
      const content = e.llmResponse?.content || "";
      if (content.toLowerCase().includes(q)) return true;

      const toolExecutions = e.toolExecutions || [];
      for (const te of toolExecutions) {
        if (te.toolName?.toLowerCase().includes(q)) return true;
        if (te.result?.toLowerCase().includes(q)) return true;
      }

      const toolCalls = e.llmResponse?.toolCalls || [];
      for (const tc of toolCalls) {
        if (tc.function?.name?.toLowerCase().includes(q)) return true;
      }

      const events = e.events || [];
      for (const ev of events) {
        if (ev.type?.toLowerCase().includes(q)) return true;
      }

      if (e.snapshot?.url?.toLowerCase().includes(q)) return true;
      if (e.snapshot?.title?.toLowerCase().includes(q)) return true;

      return false;
    });
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center text-trace-dim text-[13px] py-8">
        {q ? `No turns match "${q}"` : "No turn data available."}
      </div>
    );
  }

  return (
    <>
      {filtered.map((entry, i) => (
        <TurnCard key={i} entry={entry} index={i} />
      ))}
    </>
  );
}
