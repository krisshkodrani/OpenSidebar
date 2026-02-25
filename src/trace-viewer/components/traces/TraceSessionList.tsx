import React from "react";
import { useStore } from "../../store";
import TraceSessionItem from "./TraceSessionItem";
import LoadingSpinner from "../LoadingSpinner";

export default function TraceSessionList() {
  const sessions = useStore((s) => s.sessions);
  const currentSessionId = useStore((s) => s.currentSessionId);
  const setCurrentSessionId = useStore((s) => s.setCurrentSessionId);
  const setCurrentEntries = useStore((s) => s.setCurrentEntries);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setActiveSubview = useStore((s) => s.setActiveSubview);
  const tracesLoading = useStore((s) => s.tracesLoading);

  const selectSession = (sessionId: string) => {
    if (currentSessionId === sessionId) return;
    setCurrentSessionId(sessionId);
    setCurrentEntries([]);
    setSearchQuery("");
    setActiveSubview("turns");
  };

  if (tracesLoading) {
    return <LoadingSpinner message="Loading sessions..." />;
  }

  if (sessions.length === 0) {
    return (
      <div className="py-10 px-4 text-center text-trace-muted text-[13px]">
        No trace sessions found.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {sessions.map((s) => (
        <TraceSessionItem
          key={s.sessionId as string}
          session={s}
          isActive={(s.sessionId as string) === currentSessionId}
          onClick={() => selectSession(s.sessionId as string)}
        />
      ))}
    </div>
  );
}
