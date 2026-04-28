import React, { useMemo } from "react";
import { analyzeTraceFleet, type TraceFleetCluster } from "../../analysis";
import { useStore } from "../../store";
import { formatCost } from "../../utils";
import Badge from "../Badge";

interface FleetInsightsProps {
  onSelectSession: (sessionId: string) => void;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clusterBadge(cluster: TraceFleetCluster) {
  if (cluster.kind === "failure") return "error" as const;
  if (cluster.failureRate >= 0.75) return "max_turns" as const;
  return "type" as const;
}

function ClusterRow({
  cluster,
  onSelectSession,
}: {
  cluster: TraceFleetCluster;
  onSelectSession: (sessionId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelectSession(cluster.sampleSessionId)}
      className="min-w-0 text-left rounded border border-trace-border bg-trace-bg px-3 py-2 hover:border-trace-accent/40 hover:bg-trace-accent/[0.04] transition-colors"
      title={cluster.recommendation}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Badge variant={clusterBadge(cluster)}>{cluster.kind}</Badge>
        <span className="text-[12px] text-trace-text font-medium truncate">
          {cluster.label}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-trace-muted flex flex-wrap gap-x-3 gap-y-1">
        <span>{cluster.failedCount} failed</span>
        <span>{cluster.count} sessions</span>
        <span>{pct(cluster.failureRate)} fail rate</span>
        {cluster.totalCost > 0 && <span>{formatCost(cluster.totalCost)}</span>}
      </div>
    </button>
  );
}

export default function FleetInsights({ onSelectSession }: FleetInsightsProps) {
  const sessions = useStore((s) => s.sessions);
  const analysis = useMemo(() => analyzeTraceFleet(sessions, 3), [sessions]);

  if (sessions.length === 0 || analysis.failedSessions === 0) return null;

  const clusters = [
    ...analysis.topFailureClusters,
    ...analysis.topDomainClusters,
    ...analysis.topSkillClusters,
    ...analysis.topModelClusters,
  ]
    .filter((cluster) => cluster.failedCount > 0)
    .slice(0, 6);

  if (clusters.length === 0) return null;

  return (
    <section className="border-b border-trace-border bg-trace-panel/80 px-5 py-3 shrink-0">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-trace-muted">
            Fleet Insights
          </div>
          <div className="mt-0.5 text-[12px] text-trace-muted">
            {analysis.failedSessions}/{analysis.totalSessions} failed ·{" "}
            {pct(analysis.successRate)} success · avg{" "}
            {analysis.averageTurns.toFixed(1)} turns
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {clusters.map((cluster) => (
          <ClusterRow
            key={cluster.id}
            cluster={cluster}
            onSelectSession={onSelectSession}
          />
        ))}
      </div>
    </section>
  );
}
