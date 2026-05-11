import React, {
  useRef,
  useMemo,
  useEffect,
  useState,
  useCallback,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "../../store";
import TurnCard from "./TurnCard";

const ESTIMATED_TURN_HEIGHT = 200;

export default function TurnList() {
  const entries = useStore((s) => s.currentEntries);
  const sessionId = useStore((s) => s.currentSessionId) ?? "";
  const searchQuery = useStore((s) => s.searchQuery);
  const focusTurnNumber = useStore((s) => s.focusTurnNumber);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  const filtered = useMemo(() => {
    let result = entries;

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
  }, [entries, searchQuery]);

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_TURN_HEIGHT,
    overscan: 3,
  });

  // Scroll to focused turn when navigating from Perception tab
  useEffect(() => {
    if (focusTurnNumber == null) return;
    const idx = filtered.findIndex((e) => e.turnNumber === focusTurnNumber);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "start" });
      setFocusedIdx(idx);
    }
    // Clear focus after scrolling
    useStore.setState({ focusTurnNumber: null });
  }, [focusTurnNumber, filtered, virtualizer]);

  // j/k keyboard navigation
  const handleKeyNav = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (filtered.length === 0) return;

      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setFocusedIdx((prev) => {
          const cur = prev ?? -1;
          const next =
            e.key === "j"
              ? Math.min(cur + 1, filtered.length - 1)
              : Math.max(cur - 1, 0);
          virtualizer.scrollToIndex(next, { align: "center" });
          return next;
        });
      }
    },
    [filtered.length, virtualizer],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyNav);
    return () => window.removeEventListener("keydown", handleKeyNav);
  }, [handleKeyNav]);

  // Reset focus when entries change
  useEffect(() => {
    setFocusedIdx(null);
  }, [entries, searchQuery]);

  if (filtered.length === 0) {
    const q = searchQuery.toLowerCase().trim();
    return (
      <div className="text-center text-trace-dim text-[13px] py-8">
        {q ? `No turns match "${q}"` : "No turn data available."}
      </div>
    );
  }

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
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = filtered[virtualRow.index];
          const previousEntry = entries.find(
            (candidate) => candidate.turnNumber === entry.turnNumber - 1,
          );
          const isFocused = virtualRow.index === focusedIdx;
          const turnNum = entry.turnNumber ?? virtualRow.index + 1;
          return (
            <div
              key={virtualRow.key}
              id={`turn-${turnNum}`}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              onClick={() => setFocusedIdx(virtualRow.index)}
            >
              <div
                className={
                  isFocused ? "ring-1 ring-trace-accent/60 rounded-lg" : ""
                }
              >
                <TurnCard
                  entry={entry}
                  index={virtualRow.index}
                  sessionId={sessionId}
                  previousEntry={previousEntry}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
