import React from "react";
import { useStore } from "../store";
import { formatCost } from "../utils";

const TABS = [
  {
    key: "sessions" as const,
    label: "Sessions",
    description: "Browse runs, filters, and session health",
  },
  {
    key: "trace" as const,
    label: "Trace View",
    description: "Inspect turns, perception, logs, and story",
  },
];

export default function TabBar() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const sessions = useStore((s) => s.sessions);
  const currentSessionId = useStore((s) => s.currentSessionId);

  const totalCost = sessions.reduce(
    (sum, session) => sum + (session.metrics?.totalCost ?? 0),
    0,
  );

  return (
    <header className="viewer-header shrink-0 px-5 py-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="viewer-brand-mark">OS</div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-trace-accent-light/80">
                Observability Workspace
              </div>
              <h1 className="text-[26px] leading-none font-semibold tracking-[-0.03em] text-white">
                OpenSidebar Viewer
              </h1>
            </div>
          </div>
          <p className="mt-3 max-w-3xl text-sm text-[#c8c0b6]">
            A cleaner workspace for reviewing session flow, run health, and detailed traces without packing everything into one pane.
          </p>
        </div>
        <div className="ml-auto grid grid-cols-3 gap-2 text-right">
          <MetricCard label="Sessions" value={String(sessions.length)} />
          <MetricCard
            label="Selected"
            value={currentSessionId ? currentSessionId.slice(0, 8) : "None"}
          />
          <MetricCard label="Cost" value={formatCost(totalCost) || "$0"} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`viewer-top-tab ${activeTab === t.key ? "viewer-top-tab-active" : ""}`}
            title={t.description}
          >
            <span className="viewer-top-tab-label">{t.label}</span>
            <span className="viewer-top-tab-description">{t.description}</span>
          </button>
        ))}
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
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}
