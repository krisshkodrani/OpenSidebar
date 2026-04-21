import type { TraceSession } from "../types/traces";
import type { RunGroup, TraceFilters } from "./store/types";
import { getSessionModels, shortModel } from "./utils";

export interface FleetAnalytics {
  successRate: number;
  averageTurns: number;
  averageDurationMs: number;
  averageCost: number;
  errorSessions: number;
  maxTurnsSessions: number;
  skillGuidedSessions: number;
  preferredToolSelectionRate: number;
  discouragedToolSelectionRate: number;
  topSkillPolicies: Array<{
    skillId: string;
    sessions: number;
    preferredRate: number;
  }>;
  skillPolicyAlerts: Array<{
    skillId: string;
    sessions: number;
    preferredRate: number;
    discouragedRate: number;
    severity: "warn" | "critical";
    reason: string;
  }>;
  topFailingDomains: Array<{ domain: string; count: number }>;
  topModels: Array<{ model: string; count: number }>;
}

export interface RegressionWindowStats {
  sessionCount: number;
  successRate: number;
  averageTurns: number;
  averageCost: number;
}

export interface RegressionSummary {
  currentLabel: string;
  previousLabel: string;
  current: RegressionWindowStats;
  previous: RegressionWindowStats;
}

export interface SkillPolicyRegressionItem {
  skillId: string;
  currentSessions: number;
  previousSessions: number;
  currentSelections: number;
  previousSelections: number;
  currentPreferredRate: number;
  previousPreferredRate: number;
  currentDiscouragedRate: number;
  previousDiscouragedRate: number;
  trend: "worse" | "better" | "flat" | "new" | "inactive" | "low-signal";
}

export interface SkillPolicyRegressionSummary {
  currentLabel: string;
  previousLabel: string;
  changes: SkillPolicyRegressionItem[];
}

export interface FleetLens {
  key: string;
  label: string;
  description: string;
  filters: Partial<TraceFilters>;
}

export const FLEET_LENSES: FleetLens[] = [
  {
    key: "failures",
    label: "Failures",
    description: "Error outcomes only",
    filters: { outcome: "error" },
  },
  {
    key: "max-turns",
    label: "Max Turns",
    description: "Sessions that hit the turn ceiling",
    filters: { outcome: "max_turns" },
  },
  {
    key: "planner",
    label: "Planner",
    description: "Planner-tier sessions",
    filters: { tier: "planner" },
  },
  {
    key: "manual",
    label: "Manual",
    description: "Manual traces only",
    filters: { mode: "manual" },
  },
  {
    key: "recording",
    label: "Recording",
    description: "Recordings only",
    filters: { mode: "recording" },
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const SKILL_ALERT_MIN_SESSIONS = 2;
const SKILL_ALERT_WARN_PREFERRED_RATE = 0.6;
const SKILL_ALERT_WARN_DISCOURAGED_RATE = 0.2;
const SKILL_ALERT_CRITICAL_PREFERRED_RATE = 0.4;
const SKILL_ALERT_CRITICAL_DISCOURAGED_RATE = 0.35;
const SKILL_REGRESSION_DELTA = 0.05;
const SKILL_REGRESSION_MIN_SESSIONS = 2;
const SKILL_REGRESSION_MIN_SELECTIONS = 5;

function extractDomain(startUrl: string | undefined): string | null {
  if (!startUrl) return null;
  try {
    return new URL(startUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function computeFleetAnalytics(
  sessions: TraceSession[],
  _runGroups: RunGroup[],
): FleetAnalytics {
  const total = sessions.length || 1;
  const successCount = sessions.filter((session) =>
    ["completed", "success"].includes(session.outcome),
  ).length;
  const errorSessions = sessions.filter((session) => session.outcome === "error").length;
  const maxTurnsSessions = sessions.filter(
    (session) => session.outcome === "max_turns",
  ).length;

  let totalTurns = 0;
  let totalDurationMs = 0;
  let totalCost = 0;
  let skillGuidedSessions = 0;
  let totalPreferredSelections = 0;
  let totalDiscouragedSelections = 0;
  let totalSkillSelections = 0;

  const failingDomainCounts = new Map<string, number>();
  const modelCounts = new Map<string, number>();
  const skillPolicyCounts = new Map<
    string,
    {
      sessions: number;
      preferredSelections: number;
      discouragedSelections: number;
      totalSelections: number;
    }
  >();

  for (const session of sessions) {
    totalTurns += session.turnCount || 0;
    totalDurationMs += Math.max(0, (session.endTime || 0) - (session.startTime || 0));
    totalCost += session.metrics?.totalCost ?? 0;
    const skillMetrics = session.skillToolMetrics;
    if (skillMetrics) {
      skillGuidedSessions += 1;
      totalPreferredSelections += skillMetrics.preferredSelections || 0;
      totalDiscouragedSelections += skillMetrics.discouragedSelections || 0;
      totalSkillSelections += skillMetrics.totalSelections || 0;
      const current = skillPolicyCounts.get(skillMetrics.skillId) ?? {
        sessions: 0,
        preferredSelections: 0,
        discouragedSelections: 0,
        totalSelections: 0,
      };
      current.sessions += 1;
      current.preferredSelections += skillMetrics.preferredSelections || 0;
      current.discouragedSelections += skillMetrics.discouragedSelections || 0;
      current.totalSelections += skillMetrics.totalSelections || 0;
      skillPolicyCounts.set(skillMetrics.skillId, current);
    }

    if (session.outcome === "error" || session.outcome === "max_turns") {
      const domain = extractDomain(session.startUrl);
      if (domain) {
        failingDomainCounts.set(domain, (failingDomainCounts.get(domain) || 0) + 1);
      }
    }

    const models = getSessionModels(session);
    for (const model of models) {
      if (model === "manual" || model === "recording") continue;
      const short = shortModel(model);
      modelCounts.set(short, (modelCounts.get(short) || 0) + 1);
    }
  }

  return {
    successRate: successCount / total,
    averageTurns: totalTurns / total,
    averageDurationMs: totalDurationMs / total,
    averageCost: totalCost / total,
    errorSessions,
    maxTurnsSessions,
    skillGuidedSessions,
    preferredToolSelectionRate:
      totalSkillSelections > 0 ? totalPreferredSelections / totalSkillSelections : 0,
    discouragedToolSelectionRate:
      totalSkillSelections > 0
        ? totalDiscouragedSelections / totalSkillSelections
        : 0,
    topSkillPolicies: Array.from(skillPolicyCounts.entries())
      .map(([skillId, counts]) => ({
        skillId,
        sessions: counts.sessions,
        preferredRate:
          counts.totalSelections > 0
            ? counts.preferredSelections / counts.totalSelections
            : 0,
      }))
      .sort((a, b) => {
        if (b.sessions !== a.sessions) return b.sessions - a.sessions;
        return b.preferredRate - a.preferredRate;
      })
      .slice(0, 4),
    skillPolicyAlerts: Array.from(skillPolicyCounts.entries())
      .map(([skillId, counts]) => {
        const preferredRate =
          counts.totalSelections > 0
            ? counts.preferredSelections / counts.totalSelections
            : 0;
        const discouragedRate =
          counts.totalSelections > 0
            ? counts.discouragedSelections / counts.totalSelections
            : 0;
        if (counts.sessions < SKILL_ALERT_MIN_SESSIONS) return null;
        if (
          discouragedRate >= SKILL_ALERT_CRITICAL_DISCOURAGED_RATE ||
          preferredRate <= SKILL_ALERT_CRITICAL_PREFERRED_RATE
        ) {
          return {
            skillId,
            sessions: counts.sessions,
            preferredRate,
            discouragedRate,
            severity: "critical" as const,
            reason:
              discouragedRate >= SKILL_ALERT_CRITICAL_DISCOURAGED_RATE
                ? "High discouraged-tool selection rate"
                : "Low preferred-tool selection rate",
          };
        }
        if (
          discouragedRate >= SKILL_ALERT_WARN_DISCOURAGED_RATE ||
          preferredRate <= SKILL_ALERT_WARN_PREFERRED_RATE
        ) {
          return {
            skillId,
            sessions: counts.sessions,
            preferredRate,
            discouragedRate,
            severity: "warn" as const,
            reason:
              discouragedRate >= SKILL_ALERT_WARN_DISCOURAGED_RATE
                ? "Discouraged tools still selected often"
                : "Preferred tools are not being selected often enough",
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.severity !== b.severity) {
          return a.severity === "critical" ? -1 : 1;
        }
        if (b.sessions !== a.sessions) return b.sessions - a.sessions;
        return b.discouragedRate - a.discouragedRate;
      })
      .slice(0, 4),
    topFailingDomains: Array.from(failingDomainCounts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4),
    topModels: Array.from(modelCounts.entries())
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4),
  };
}

function computeWindowStats(sessions: TraceSession[]): RegressionWindowStats {
  if (sessions.length === 0) {
    return {
      sessionCount: 0,
      successRate: 0,
      averageTurns: 0,
      averageCost: 0,
    };
  }
  const successCount = sessions.filter((session) =>
    ["completed", "success"].includes(session.outcome),
  ).length;
  const totalTurns = sessions.reduce((sum, session) => sum + (session.turnCount || 0), 0);
  const totalCost = sessions.reduce(
    (sum, session) => sum + (session.metrics?.totalCost ?? 0),
    0,
  );
  return {
    sessionCount: sessions.length,
    successRate: successCount / sessions.length,
    averageTurns: totalTurns / sessions.length,
    averageCost: totalCost / sessions.length,
  };
}

function getRegressionWindows(sessions: TraceSession[]): {
  currentLabel: string;
  previousLabel: string;
  currentSessions: TraceSession[];
  previousSessions: TraceSession[];
} | null {
  if (sessions.length === 0) return null;
  const times = sessions
    .map((session) => session.startTime || 0)
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  if (times.length === 0) return null;

  const latest = times[times.length - 1];
  const currentStart = latest - 7 * DAY_MS;
  const previousStart = currentStart - 7 * DAY_MS;

  const currentSessions = sessions.filter(
    (session) => (session.startTime || 0) > currentStart,
  );
  const previousSessions = sessions.filter((session) => {
    const start = session.startTime || 0;
    return start > previousStart && start <= currentStart;
  });

  return {
    currentLabel: "Last 7d",
    previousLabel: "Prev 7d",
    currentSessions,
    previousSessions,
  };
}

function computeSkillPolicyWindowStats(
  sessions: TraceSession[],
): Map<
  string,
  {
    sessions: number;
    preferredSelections: number;
    discouragedSelections: number;
    totalSelections: number;
  }
> {
  const stats = new Map<
    string,
    {
      sessions: number;
      preferredSelections: number;
      discouragedSelections: number;
      totalSelections: number;
    }
  >();
  for (const session of sessions) {
    const skillMetrics = session.skillToolMetrics;
    if (!skillMetrics) continue;
    const current = stats.get(skillMetrics.skillId) ?? {
      sessions: 0,
      preferredSelections: 0,
      discouragedSelections: 0,
      totalSelections: 0,
    };
    current.sessions += 1;
    current.preferredSelections += skillMetrics.preferredSelections || 0;
    current.discouragedSelections += skillMetrics.discouragedSelections || 0;
    current.totalSelections += skillMetrics.totalSelections || 0;
    stats.set(skillMetrics.skillId, current);
  }
  return stats;
}

export function computeRegressionSummary(
  sessions: TraceSession[],
): RegressionSummary | null {
  const windows = getRegressionWindows(sessions);
  if (!windows) return null;

  return {
    currentLabel: windows.currentLabel,
    previousLabel: windows.previousLabel,
    current: computeWindowStats(windows.currentSessions),
    previous: computeWindowStats(windows.previousSessions),
  };
}

export function computeSkillPolicyRegressionSummary(
  sessions: TraceSession[],
): SkillPolicyRegressionSummary | null {
  const windows = getRegressionWindows(sessions);
  if (!windows) return null;

  const currentStats = computeSkillPolicyWindowStats(windows.currentSessions);
  const previousStats = computeSkillPolicyWindowStats(windows.previousSessions);
  const skillIds = new Set([
    ...currentStats.keys(),
    ...previousStats.keys(),
  ]);

  const changes = Array.from(skillIds)
    .map((skillId) => {
      const current = currentStats.get(skillId) ?? {
        sessions: 0,
        preferredSelections: 0,
        discouragedSelections: 0,
        totalSelections: 0,
      };
      const previous = previousStats.get(skillId) ?? {
        sessions: 0,
        preferredSelections: 0,
        discouragedSelections: 0,
        totalSelections: 0,
      };
      if (current.sessions === 0 && previous.sessions === 0) return null;

      const currentPreferredRate =
        current.totalSelections > 0
          ? current.preferredSelections / current.totalSelections
          : 0;
      const previousPreferredRate =
        previous.totalSelections > 0
          ? previous.preferredSelections / previous.totalSelections
          : 0;
      const currentDiscouragedRate =
        current.totalSelections > 0
          ? current.discouragedSelections / current.totalSelections
          : 0;
      const previousDiscouragedRate =
        previous.totalSelections > 0
          ? previous.discouragedSelections / previous.totalSelections
          : 0;

      const currentHasPresence =
        current.sessions > 0 || current.totalSelections > 0;
      const previousHasPresence =
        previous.sessions > 0 || previous.totalSelections > 0;
      const currentHasSignal =
        current.sessions >= SKILL_REGRESSION_MIN_SESSIONS ||
        current.totalSelections >= SKILL_REGRESSION_MIN_SELECTIONS;
      const previousHasSignal =
        previous.sessions >= SKILL_REGRESSION_MIN_SESSIONS ||
        previous.totalSelections >= SKILL_REGRESSION_MIN_SELECTIONS;

      let trend: SkillPolicyRegressionItem["trend"] = "flat";
      if (currentHasPresence && !previousHasPresence) {
        trend = "new";
      } else if (!currentHasPresence && previousHasPresence) {
        trend = "inactive";
      } else if (!currentHasSignal || !previousHasSignal) {
        trend = "low-signal";
      } else if (
        currentDiscouragedRate - previousDiscouragedRate >= SKILL_REGRESSION_DELTA ||
        previousPreferredRate - currentPreferredRate >= SKILL_REGRESSION_DELTA
      ) {
        trend = "worse";
      } else if (
        previousDiscouragedRate - currentDiscouragedRate >= SKILL_REGRESSION_DELTA ||
        currentPreferredRate - previousPreferredRate >= SKILL_REGRESSION_DELTA
      ) {
        trend = "better";
      }

      return {
        skillId,
        currentSessions: current.sessions,
        previousSessions: previous.sessions,
        currentSelections: current.totalSelections,
        previousSelections: previous.totalSelections,
        currentPreferredRate,
        previousPreferredRate,
        currentDiscouragedRate,
        previousDiscouragedRate,
        trend,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.trend !== b.trend) {
        if (a.trend === "worse") return -1;
        if (b.trend === "worse") return 1;
        if (a.trend === "low-signal") return -1;
        if (b.trend === "low-signal") return 1;
        if (a.trend === "new") return -1;
        if (b.trend === "new") return 1;
        if (a.trend === "inactive") return -1;
        if (b.trend === "inactive") return 1;
        if (a.trend === "better") return -1;
        if (b.trend === "better") return 1;
      }
      const aDelta = Math.max(
        a.currentDiscouragedRate - a.previousDiscouragedRate,
        a.previousPreferredRate - a.currentPreferredRate,
      );
      const bDelta = Math.max(
        b.currentDiscouragedRate - b.previousDiscouragedRate,
        b.previousPreferredRate - b.currentPreferredRate,
      );
      return bDelta - aDelta;
    })
    .slice(0, 6);

  return {
    currentLabel: windows.currentLabel,
    previousLabel: windows.previousLabel,
    changes,
  };
}

export function isLensActive(
  filters: TraceFilters,
  lens: FleetLens,
): boolean {
  return Object.entries(lens.filters).every(
    ([key, value]) => filters[key as keyof TraceFilters] === value,
  );
}
