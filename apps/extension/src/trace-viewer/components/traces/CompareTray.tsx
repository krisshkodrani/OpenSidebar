import React from "react";
import { useStore } from "../../store";
import { extractQueryTitle, truncate } from "../../utils";

export default function CompareTray() {
  const compareSessionIds = useStore((s) => s.compareSessionIds);
  const sessions = useStore((s) => s.sessions);
  const clearCompareSessions = useStore((s) => s.clearCompareSessions);
  const setCompareViewActive = useStore((s) => s.setCompareViewActive);

  if (compareSessionIds.length === 0) return null;

  const selected = compareSessionIds
    .map((id) => sessions.find((session) => session.sessionId === id))
    .filter(Boolean);

  return (
    <div className="px-5 py-3 border-b border-trace-border bg-[rgba(124,58,237,0.06)] shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.22em] text-trace-accent-light/80">
          Compare Queue
        </span>
        <span className="text-[11px] text-trace-muted">
          {compareSessionIds.length}/2 selected
        </span>
        <button
          onClick={clearCompareSessions}
          className="ml-auto text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
        >
          Clear
        </button>
        <button
          onClick={() => setCompareViewActive(true)}
          disabled={compareSessionIds.length !== 2}
          className="text-[11px] rounded px-2 py-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-trace-accent/30 text-trace-accent-light hover:bg-trace-accent/10"
        >
          Compare Sessions
        </button>
      </div>
      <div className="flex gap-2 mt-2 flex-wrap">
        {selected.map((session) => (
          <div
            key={session!.sessionId}
            className="px-2 py-1 rounded border border-trace-border bg-trace-panel text-[11px] text-trace-subtle"
          >
            <span className="font-mono text-trace-muted mr-2">
              {session!.sessionId.slice(0, 8)}
            </span>
            {truncate(extractQueryTitle(session!.query).title, 48)}
          </div>
        ))}
      </div>
    </div>
  );
}
