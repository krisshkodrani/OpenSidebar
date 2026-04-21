import React from "react";
import { useStore } from "../../store";

export default function TraceListModeToggle() {
  const traceListMode = useStore((s) => s.traceListMode);
  const setTraceListMode = useStore((s) => s.setTraceListMode);
  const sessions = useStore((s) => s.sessions);
  const runGroups = useStore((s) => s.runGroups);

  return (
    <div className="flex items-center gap-2 px-5 py-2 border-b border-trace-border bg-trace-panel/70 shrink-0">
      <span className="text-[10px] uppercase tracking-[0.22em] text-trace-muted">
        View
      </span>
      <div className="inline-flex rounded border border-trace-border overflow-hidden">
        <ModeButton
          active={traceListMode === "runs"}
          onClick={() => setTraceListMode("runs")}
        >
          Runs ({runGroups.length})
        </ModeButton>
        <ModeButton
          active={traceListMode === "sessions"}
          onClick={() => setTraceListMode("sessions")}
        >
          Sessions ({sessions.length})
        </ModeButton>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${
        active
          ? "bg-trace-accent/15 text-trace-accent-light"
          : "bg-transparent text-trace-muted hover:text-trace-text"
      }`}
    >
      {children}
    </button>
  );
}
