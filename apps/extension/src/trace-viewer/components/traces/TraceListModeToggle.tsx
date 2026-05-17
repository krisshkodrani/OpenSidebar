import React from "react";
import { useStore } from "../../store";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";

export default function TraceListModeToggle() {
  const traceListMode = useStore((s) => s.traceListMode);
  const setTraceListMode = useStore((s) => s.setTraceListMode);
  const sessions = useStore((s) => s.sessions);
  const runGroups = useStore((s) => s.runGroups);

  return (
    <div className="flex items-center gap-2 px-5 py-2 border-b border-trace-border bg-trace-panel/70 shrink-0">
      <span className="text-[10px] uppercase tracking-[0.22em] text-trace-muted">
        Traces
      </span>
      <Tabs
        value={traceListMode}
        onValueChange={(value) => setTraceListMode(value as "runs" | "sessions")}
      >
        <TabsList className="h-auto gap-0 overflow-hidden rounded border border-trace-border bg-transparent p-0 text-trace-muted">
          <TabsTrigger
            value="runs"
            onClick={() => setTraceListMode("runs")}
            disabled={runGroups.length === 0}
            className="rounded-none px-3 py-1.5 text-[11px] font-semibold text-trace-muted shadow-none data-[state=active]:bg-trace-accent/15 data-[state=active]:text-trace-accent-light data-[state=active]:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
          >
          Trace Runs ({runGroups.length})
          </TabsTrigger>
          <TabsTrigger
            value="sessions"
            onClick={() => setTraceListMode("sessions")}
            className="rounded-none px-3 py-1.5 text-[11px] font-semibold text-trace-muted shadow-none data-[state=active]:bg-trace-accent/15 data-[state=active]:text-trace-accent-light data-[state=active]:shadow-none"
          >
          Sessions ({sessions.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
