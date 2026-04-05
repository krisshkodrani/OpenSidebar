import React, { useEffect, useRef } from "react";
import { useStore } from "../../store";
import PerceptionCard from "./PerceptionCard";

export default function PerceptionList() {
  const entries = useStore((s) => s.currentEntries);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const focusTurnNumber = useStore((s) => s.focusTurnNumber);
  const perceptionEntries = entries.filter((e) => e.perception);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Scroll to focused perception card when navigating from Turns tab
  useEffect(() => {
    if (focusTurnNumber == null) return;
    const el = cardRefs.current.get(focusTurnNumber);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    useStore.getState().focusTurnNumber = null;
  }, [focusTurnNumber]);

  if (perceptionEntries.length === 0) {
    return (
      <div className="py-10 px-4 text-center text-trace-muted text-[13px]">
        No perception data in this session.
        <br />
        Perception data is recorded when the vision model interprets page
        screenshots.
      </div>
    );
  }

  return (
    <>
      {perceptionEntries.map((entry, i) => (
        <div
          key={i}
          ref={(el) => {
            if (el) cardRefs.current.set(entry.turnNumber ?? 0, el);
          }}
        >
          <PerceptionCard
            entry={entry}
            sessionId={currentSessionId || ""}
          />
        </div>
      ))}
    </>
  );
}
