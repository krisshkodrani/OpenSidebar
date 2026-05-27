import type { TraceSession } from "../../types/traces";
import type {
  FleetClusterKind,
  TraceFleetAnalysis,
  TraceFleetCluster,
} from "./types";

interface MutableCluster {
  kind: FleetClusterKind;
  label: string;
  sessions: TraceSession[];
}

function isSuccess(session: TraceSession): boolean {
  const outcome = String(session.outcome);
  return outcome === "completed" || outcome === "success";
}

function failureLabel(session: TraceSession): string | null {
  if (isSuccess(session)) return null;
  if (session.failureCode && session.failureCode !== "none") {
    return session.failureCode;
  }
  if (session.failureCategory && session.failureCategory !== "none") {
    return session.failureCategory;
  }
  return session.outcome || "unknown_failure";
}

function domain(session: TraceSession): string | null {
  if (!session.startUrl) return null;
  try {
    return new URL(session.startUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeTraceModelId(model: string): string {
  return model
    .trim()
    .replace(/^accounts\/[^/]+\/routers\//, "")
    .replace(/:nitro$/, "");
}

function sessionModels(session: TraceSession): string[] {
  const stored = Array.isArray(session.models)
    ? session.models.filter((model): model is string => Boolean(model))
    : [];
  const breakdown = session.metrics?.modelBreakdown
    ? Object.keys(session.metrics.modelBreakdown)
    : [];
  return Array.from(
    new Set(
      [...stored, ...breakdown]
        .map(normalizeTraceModelId)
        .filter((model) => model.length > 0),
    ),
  );
}

function sessionSkills(session: TraceSession): string[] {
  const skills = new Set<string>();
  if (session.skillToolMetrics?.skillId) {
    skills.add(session.skillToolMetrics.skillId);
  }
  for (const step of session.planDecomposition?.steps ?? []) {
    if (step.selectedSkillId) skills.add(step.selectedSkillId);
  }
  return Array.from(skills);
}

function recommendation(kind: FleetClusterKind, label: string): string {
  switch (kind) {
    case "failure":
      return `Start with the newest ${label} trace and compare it against another session in the same cluster.`;
    case "domain":
      return `Inspect shared site behavior on ${label}; repeated failures may belong in runtime policy or a reusable skill.`;
    case "model":
      return `Compare served model metadata and failure shape before changing prompts or limits for ${label}.`;
    case "skill":
      return `Review the ${label} skill contract and its evidence expectations against the failed sessions.`;
  }
}

function addCluster(
  clusters: Map<string, MutableCluster>,
  kind: FleetClusterKind,
  label: string | null,
  session: TraceSession,
): void {
  if (!label) return;
  const key = `${kind}:${label}`;
  const cluster = clusters.get(key);
  if (cluster) {
    cluster.sessions.push(session);
    return;
  }
  clusters.set(key, { kind, label, sessions: [session] });
}

function finalizeCluster(cluster: MutableCluster): TraceFleetCluster {
  const failed = cluster.sessions.filter((session) => !isSuccess(session));
  const totalTurns = cluster.sessions.reduce(
    (sum, session) => sum + (session.turnCount || 0),
    0,
  );
  const totalCost = cluster.sessions.reduce(
    (sum, session) => sum + (session.metrics?.totalCost ?? 0),
    0,
  );
  const newest = [...cluster.sessions].sort(
    (a, b) => (b.startTime ?? 0) - (a.startTime ?? 0),
  )[0];

  return {
    id: `${cluster.kind}:${cluster.label}`,
    kind: cluster.kind,
    label: cluster.label,
    count: cluster.sessions.length,
    failedCount: failed.length,
    failureRate:
      cluster.sessions.length === 0
        ? 0
        : failed.length / cluster.sessions.length,
    totalCost,
    averageTurns:
      cluster.sessions.length === 0 ? 0 : totalTurns / cluster.sessions.length,
    sampleSessionId: newest.sessionId,
    sessionIds: cluster.sessions.map((session) => session.sessionId),
    recommendation: recommendation(cluster.kind, cluster.label),
  };
}

function sortClusters(clusters: TraceFleetCluster[]): TraceFleetCluster[] {
  return [...clusters].sort((a, b) => {
    const failed = b.failedCount - a.failedCount;
    if (failed !== 0) return failed;
    const rate = b.failureRate - a.failureRate;
    if (rate !== 0) return rate;
    const cost = b.totalCost - a.totalCost;
    if (cost !== 0) return cost;
    return b.count - a.count;
  });
}

function topClusters(
  clusters: Map<string, MutableCluster>,
  kind: FleetClusterKind,
  limit: number,
  onlyFailures = true,
): TraceFleetCluster[] {
  return sortClusters(
    Array.from(clusters.values())
      .filter((cluster) => cluster.kind === kind)
      .map(finalizeCluster)
      .filter((cluster) => !onlyFailures || cluster.failedCount > 0),
  ).slice(0, limit);
}

export function analyzeTraceFleet(
  sessions: TraceSession[],
  limit = 4,
): TraceFleetAnalysis {
  const clusters = new Map<string, MutableCluster>();
  let totalCost = 0;
  let totalTurns = 0;
  let failedSessions = 0;

  for (const session of sessions) {
    totalCost += session.metrics?.totalCost ?? 0;
    totalTurns += session.turnCount || 0;
    if (!isSuccess(session)) failedSessions += 1;

    addCluster(clusters, "failure", failureLabel(session), session);
    addCluster(clusters, "domain", domain(session), session);
    for (const model of sessionModels(session)) {
      addCluster(clusters, "model", model, session);
    }
    for (const skill of sessionSkills(session)) {
      addCluster(clusters, "skill", skill, session);
    }
  }

  return {
    totalSessions: sessions.length,
    failedSessions,
    successRate:
      sessions.length === 0
        ? 0
        : (sessions.length - failedSessions) / sessions.length,
    totalCost,
    averageTurns: sessions.length === 0 ? 0 : totalTurns / sessions.length,
    topFailureClusters: topClusters(clusters, "failure", limit, false),
    topDomainClusters: topClusters(clusters, "domain", limit),
    topModelClusters: topClusters(clusters, "model", limit),
    topSkillClusters: topClusters(clusters, "skill", limit),
  };
}
