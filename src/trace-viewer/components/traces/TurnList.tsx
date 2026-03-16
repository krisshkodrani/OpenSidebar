import React, { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "../../store";
import TurnCard from "./TurnCard";

const ESTIMATED_TURN_HEIGHT = 200;

export default function TurnList() {
  const entries = useStore((s) => s.currentEntries);
  const sessionId = useStore((s) => s.currentSessionId) ?? "";
  const searchQuery = useStore((s) => s.searchQuery);
  const tierFilter = useStore((s) => s.filters.tier);

  const filtered = useMemo(() => {
    let result = entries;

    if (tierFilter && tierFilter !== "all") {
      result = result.filter((e) => e.llmRequest?.modelTier === tierFilter);
    }

    const q = searchQuery.toLowerCase().trim();
    if (q) {
      result = result.filter((e) => {
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

    return result;
  }, [entries, searchQuery, tierFilter]);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_TURN_HEIGHT,
    overscan: 3,
  });

  if (filtered.length === 0) {
    const q = searchQuery.toLowerCase().trim();
    return (
      <div className="text-center text-trace-dim text-[13px] py-8">
        {q ? `No turns match "${q}"` : "No turn data available."}
      </div>
    );
  }

  return (
    <div ref={parentRef} style={{ height: "100%", overflow: "auto" }} className="scrollbar-thin">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = filtered[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TurnCard entry={entry} index={virtualRow.index} sessionId={sessionId} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
