import type { TraceSession } from "../../types/traces";
import type {
  TraceSessionComparison,
  TraceSessionComparisonResult,
  TraceSessionRelation,
} from "./types";

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
  return String(session.outcome || "unknown_failure");
}

function domain(session: TraceSession): string | null {
  if (!session.startUrl) return null;
  try {
    return new URL(session.startUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function models(session: TraceSession): string[] {
  const stored = Array.isArray(session.models)
    ? session.models.filter((model): model is string => Boolean(model))
    : [];
  const breakdown = session.metrics?.modelBreakdown
    ? Object.keys(session.metrics.modelBreakdown)
    : [];
  return Array.from(new Set([...stored, ...breakdown]));
}

function skills(session: TraceSession): string[] {
  const ids = new Set<string>();
  if (session.skillToolMetrics?.skillId)
    ids.add(session.skillToolMetrics.skillId);
  for (const step of session.planDecomposition?.steps ?? []) {
    if (step.selectedSkillId) ids.add(step.selectedSkillId);
  }
  return Array.from(ids);
}

function intersect(a: string[], b: string[]): string[] {
  const bSet = new Set(b);
  return a.filter((value) => bSet.has(value));
}

function queryTitle(query: string | undefined): string {
  if (!query) return "(no query)";
  const match = query.match(/^Objective:\s*(.+?)(?:\n|$)/);
  if (match) return match[1].trim();
  return query.split("\n")[0].trim() || "(no query)";
}

function duration(session: TraceSession): number {
  return (session.endTime || 0) - (session.startTime || 0);
}

function relationLabel(relation: TraceSessionRelation): string {
  switch (relation) {
    case "same_run":
      return "same run";
    case "same_failure":
      return "same failure";
    case "same_skill":
      return "same skill";
    case "same_domain":
      return "same domain";
    case "same_model":
      return "same model";
  }
}

function recommendation(
  relation: TraceSessionRelation,
  comparison: TraceSessionComparison,
): string {
  switch (relation) {
    case "same_run":
      return "Compare order, outcome, and verifier state across sessions in this run.";
    case "same_failure":
      return `Compare the first bad turn against another ${comparison.failureLabel} trace.`;
    case "same_skill":
      return `Compare skill behavior for ${comparison.sharedSkills.join(", ")}.`;
    case "same_domain":
      return `Check whether ${comparison.domain} requires a reusable runtime policy or skill update.`;
    case "same_model":
      return `Compare model/provider metadata for ${comparison.sharedModels.join(", ")}.`;
  }
}

function rankRelation(options: {
  sameRun: boolean;
  sameFailure: boolean;
  sameDomain: boolean;
  sharedSkills: string[];
  sharedModels: string[];
}): TraceSessionRelation | null {
  if (options.sameRun) return "same_run";
  if (options.sameFailure) return "same_failure";
  if (options.sharedSkills.length > 0) return "same_skill";
  if (options.sameDomain) return "same_domain";
  if (options.sharedModels.length > 0) return "same_model";
  return null;
}

export function compareTraceSessions(
  base: TraceSession,
  sessions: TraceSession[],
  limit = 6,
): TraceSessionComparisonResult {
  const baseRunId = typeof base.runId === "string" ? base.runId : "";
  const baseFailure = failureLabel(base);
  const baseDomain = domain(base);
  const baseModels = models(base);
  const baseSkills = skills(base);

  const comparisons = sessions
    .filter((session) => session.sessionId !== base.sessionId)
    .map((session): TraceSessionComparison | null => {
      const sessionRunId =
        typeof session.runId === "string" ? session.runId : "";
      const sessionFailure = failureLabel(session);
      const sessionDomain = domain(session);
      const sharedModels = intersect(baseModels, models(session));
      const sharedSkills = intersect(baseSkills, skills(session));
      const sameRun = Boolean(baseRunId && sessionRunId === baseRunId);
      const sameFailure = Boolean(
        baseFailure && sessionFailure === baseFailure,
      );
      const sameDomain = Boolean(baseDomain && sessionDomain === baseDomain);
      const relation = rankRelation({
        sameRun,
        sameFailure,
        sameDomain,
        sharedSkills,
        sharedModels,
      });

      if (!relation) return null;

      const score =
        (sameRun ? 100 : 0) +
        (sameFailure ? 60 : 0) +
        sharedSkills.length * 25 +
        (sameDomain ? 20 : 0) +
        sharedModels.length * 8;
      const comparison: TraceSessionComparison = {
        sessionId: session.sessionId,
        relation,
        score,
        label: relationLabel(relation),
        outcome: session.outcome,
        queryTitle: queryTitle(session.query),
        ...(sessionFailure ? { failureLabel: sessionFailure } : {}),
        ...(sessionDomain ? { domain: sessionDomain } : {}),
        sharedSkills,
        sharedModels,
        turnDelta: (session.turnCount || 0) - (base.turnCount || 0),
        costDelta:
          (session.metrics?.totalCost ?? 0) - (base.metrics?.totalCost ?? 0),
        durationDeltaMs: duration(session) - duration(base),
        recommendation: "",
      };
      return {
        ...comparison,
        recommendation: recommendation(relation, comparison),
      };
    })
    .filter(
      (comparison): comparison is TraceSessionComparison => comparison !== null,
    )
    .sort((a, b) => {
      const score = b.score - a.score;
      if (score !== 0) return score;
      return Math.abs(a.turnDelta) - Math.abs(b.turnDelta);
    })
    .slice(0, limit);

  return {
    baseSessionId: base.sessionId,
    comparisons,
  };
}
