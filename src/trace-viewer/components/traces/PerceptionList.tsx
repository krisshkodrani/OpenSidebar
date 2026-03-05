import React from "react";
import { useStore } from "../../store";
import PerceptionCard from "./PerceptionCard";

export default function PerceptionList() {
  const entries = useStore((s) => s.currentEntries);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const perceptionEntries = entries.filter((e) => e.perception);

  if (perceptionEntries.length === 0) {
    return (
      <div className="py-10 px-4 text-center text-trace-muted text-[13px]">
        No perception data in this session.<br />
        Perception data is recorded when the vision model interprets page screenshots.
      </div>
    );
  }

  return (
    <>
      {perceptionEntries.map((entry, i) => (
        <PerceptionCard key={i} entry={entry} sessionId={currentSessionId || ""} />
      ))}
    </>
  );
}
