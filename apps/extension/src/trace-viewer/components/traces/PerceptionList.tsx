import React, { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "../../store";
import PerceptionCard from "./PerceptionCard";

const ESTIMATED_PERCEPTION_HEIGHT = 600;

export default function PerceptionList() {
  const entries = useStore((s) => s.currentEntries);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const focusTurnNumber = useStore((s) => s.focusTurnNumber);
  const perceptionEntries = entries.filter((e) => e.perception);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: perceptionEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_PERCEPTION_HEIGHT,
    overscan: 2,
  });

  // Scroll to focused perception card when navigating from Turns tab
  useEffect(() => {
    if (focusTurnNumber == null) return;
    const idx = perceptionEntries.findIndex(
      (e) => e.turnNumber === focusTurnNumber,
    );
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "start" });
    }
    useStore.getState().focusTurnNumber = null;
  }, [focusTurnNumber, perceptionEntries, virtualizer]);

  if (perceptionEntries.length === 0) {
    return (
      <div className="py-10 px-4 text-center text-trace-muted text-[13px]">
        No perception data in this session.
        <br />
        Perception observations are recorded when page evidence is interpreted
        from screenshots, DOM distillation, or fallback state.
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      style={{ height: "100%", overflow: "auto" }}
      className="scrollbar-thin"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem) => {
          const entry = perceptionEntries[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <PerceptionCard
                entry={entry}
                sessionId={currentSessionId || ""}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
