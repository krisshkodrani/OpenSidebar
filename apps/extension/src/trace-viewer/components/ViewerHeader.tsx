import React from "react";
import { useStore } from "../store";
import { formatCost } from "../utils";

export default function ViewerHeader() {
  const sessions = useStore((s) => s.sessions);
  const runGroups = useStore((s) => s.runGroups);
  const currentSessionId = useStore((s) => s.currentSessionId);

  const totalCost = sessions.reduce(
    (sum, session) => sum + (session.metrics?.totalCost ?? 0),
    0,
  );

  const completedCount = sessions.filter((s) =>
    ["completed", "success"].includes(s.outcome),
  ).length;
  const completionPct =
    sessions.length > 0
      ? `${Math.round((completedCount / sessions.length) * 100)}%`
      : "0%";

  return (
    <header className="viewer-header shrink-0 px-5 py-3.5">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="viewer-brand-mark">OS</div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-trace-accent-light/80">
              Observability Workspace
            </div>
            <h1 className="text-[22px] leading-none font-semibold tracking-[-0.03em] text-trace-text">
              OpenSidebar Viewer
            </h1>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <MetricCard label="Runs" value={String(runGroups.length)} />
          <MetricCard label="Sessions" value={String(sessions.length)} />
          <MetricCard label="Completion" value={completionPct} />
          <MetricCard
            label="Selected"
            value={currentSessionId ? currentSessionId.slice(0, 8) : "None"}
          />
          <MetricCard label="Cost" value={formatCost(totalCost) || "$0"} />
        </div>
      </div>
    </header>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="viewer-metric-card">
      <div className="text-[10px] uppercase tracking-[0.22em] text-trace-muted">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-trace-text">{value}</div>
    </div>
  );
}
