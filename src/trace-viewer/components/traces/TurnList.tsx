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
    filtered = filtered.filter((e) => {
      const llmReq = e.llmRequest as Record<string, unknown> | undefined;
      return llmReq?.modelTier === tierFilter;
    });
  }

  if (q) {
    filtered = entries.filter((e) => {
      const llmResponse = e.llmResponse as Record<string, unknown> | undefined;
      const content = (llmResponse?.content as string) || "";
      if (content.toLowerCase().includes(q)) return true;

      const toolExecutions =
        (e.toolExecutions as Array<Record<string, unknown>>) || [];
      for (const te of toolExecutions) {
        if ((te.toolName as string)?.toLowerCase().includes(q)) return true;
        if ((te.result as string)?.toLowerCase().includes(q)) return true;
      }

      const toolCalls =
        (llmResponse?.toolCalls as Array<Record<string, unknown>>) || [];
      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown> | undefined;
        if ((fn?.name as string)?.toLowerCase().includes(q)) return true;
      }

      const events = (e.events as Array<Record<string, unknown>>) || [];
      for (const ev of events) {
        if ((ev.type as string)?.toLowerCase().includes(q)) return true;
      }

      const snapshot = e.snapshot as Record<string, unknown> | undefined;
      if ((snapshot?.url as string)?.toLowerCase().includes(q)) return true;
      if ((snapshot?.title as string)?.toLowerCase().includes(q)) return true;

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
