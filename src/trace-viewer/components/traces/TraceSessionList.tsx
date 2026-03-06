import React, { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "../../store";
import TraceSessionItem from "./TraceSessionItem";
import LoadingSpinner from "../LoadingSpinner";

const ESTIMATED_ROW_HEIGHT = 72;

export default function TraceSessionList() {
  const sessions = useStore((s) => s.sessions);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const tracesLoading = useStore((s) => s.tracesLoading);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
  });

  const selectSession = (sessionId: string) => {
    if (currentSessionId === sessionId) return;
    setCurrentSessionId(sessionId);
    setCurrentEntries([]);
    setSearchQuery("");
    setActiveSubview("turns");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const container = parentRef.current;
    if (!container) return;
    const items = container.querySelectorAll<HTMLElement>("[role=option]");
    const focused = document.activeElement as HTMLElement;
    const idx = Array.from(items).indexOf(focused);
    if (e.key === "ArrowDown" && idx < items.length - 1) items[idx + 1]?.focus();
    else if (e.key === "ArrowUp" && idx > 0) items[idx - 1]?.focus();
    else if (e.key === "ArrowDown" && idx === -1) items[0]?.focus();
  };

  if (tracesLoading) return <LoadingSpinner message="Loading sessions..." />;

  if (sessions.length === 0) {
    return (
      <div className="py-10 px-4 text-center text-trace-muted text-[13px]">
        No trace sessions found.
      </div>
    );
  }

  return (
    <div ref={parentRef} role="listbox" onKeyDown={handleKeyDown} className="flex-1 overflow-y-auto scrollbar-thin">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const s = sessions[virtualRow.index];
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
              <TraceSessionItem
                session={s}
                isActive={s.sessionId === currentSessionId}
                onClick={() => selectSession(s.sessionId)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
