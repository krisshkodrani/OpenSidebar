import React, { useMemo } from "react";
import { useStore } from "../../store";
import { formatCost } from "../../utils";

interface FleetOverviewProps {
  onFiltersChanged: () => void;
}

export default function FleetOverview({
  onFiltersChanged,
}: FleetOverviewProps) {
  const sessions = useStore((s) => s.sessions);
  const runGroups = useStore((s) => s.runGroups);
  const filters = useStore((s) => s.filters);
  const resetFilters = useStore((s) => s.resetFilters);

  const stats = useMemo(() => {
    const completed = sessions.filter((session) =>
      ["completed", "success"].includes(session.outcome),
    ).length;
    const totalTurns = sessions.reduce(
      (sum, session) => sum + (session.turnCount || 0),
      0,
    );
    const totalCost = sessions.reduce(
      (sum, session) => sum + (session.metrics?.totalCost ?? 0),
      0,
    );
    const successRate =
      sessions.length === 0
        ? 0
        : Math.round((completed / sessions.length) * 100);
    const averageTurns =
      sessions.length === 0 ? "0.0" : (totalTurns / sessions.length).toFixed(1);

    return { successRate, averageTurns, totalCost };
  }, [sessions]);

  const hasActiveFilters =
    filters.outcome !== "all" ||
    filters.day !== "all" ||
    filters.domain !== "" ||
    filters.mode !== "all" ||
    filters.model !== "all" ||
    filters.tier !== "all" ||
    filters.runId !== "";

  const clearFilters = () => {
    resetFilters();
    onFiltersChanged();
  };

  return (
    <section className="flex items-center gap-3 px-5 py-2 border-b border-trace-border bg-trace-panel/70 shrink-0 min-w-0">
      <span className="text-[10px] uppercase tracking-[0.22em] text-trace-muted shrink-0">
        Summary
      </span>
      <div className="min-w-0 flex-1 flex items-center gap-x-4 gap-y-1 text-[11px] text-trace-muted flex-wrap">
        <InlineStat label="Sessions" value={String(sessions.length)} />
        <InlineStat label="Trace runs" value={String(runGroups.length)} />
        <InlineStat label="Success" value={`${stats.successRate}%`} />
        <InlineStat label="Avg turns" value={stats.averageTurns} />
        <InlineStat label="Cost" value={formatCost(stats.totalCost) || "$0"} />
      </div>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="shrink-0 text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-1 transition-colors"
        >
          Clear filters
        </button>
      )}
    </section>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label}:{" "}
      <span className="font-semibold text-trace-subtle font-mono">{value}</span>
    </span>
  );
}
