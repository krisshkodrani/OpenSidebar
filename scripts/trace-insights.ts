import {
  extractDomain,
  getSessionModels,
  matchesTraceFilters,
  type TraceEntryLike,
  type TraceSearchFiltersLike,
  type TraceSessionLike,
} from "./log-server-helpers";

export interface TraceInsightsFilters extends TraceSearchFiltersLike {
  sessionId?: string;
  skill?: string;
  tool?: string;
  toolStatus?: string;
  failure?: string;
  eventType?: string;
}

export interface TraceInsightsMetricRow {
  id: string;
  label: string;
  sessions: number;
  runs: number;
  calls?: number;
  successes?: number;
  failures?: number;
  failureRate?: number;
  averageDurationMs?: number;
  totalTurns?: number;
  totalCost?: number;
  sampleSessionId?: string;
  sampleRunId?: string;
  sampleError?: string;
}

export interface TraceInsightsRunRow {
  runId: string;
  query: string;
  outcome: string;
  sessions: number;
  failedSessions: number;
  totalTurns: number;
  totalCost: number;
  durationMs: number;
  topTools: string[];
  topSkills: string[];
  sampleSessionId: string;
}

export interface TraceInsightsSummary {
  totalSessions: number;
  totalRuns: number;
  completedSessions: number;
  failedSessions: number;
  successRate: number;
  failureRate: number;
  totalTurns: number;
  averageTurns: number;
  totalCost: number;
  averageDurationMs: number;
  toolCalls: number;
  toolFailures: number;
  toolFailureRate: number;
}

export interface TraceInsightsFacets {
  runs: string[];
  sessions: string[];
  domains: string[];
  models: string[];
  skills: string[];
  tools: string[];
  failures: string[];
  eventTypes: string[];
}

export interface TraceInsightsResponse {
  summary: TraceInsightsSummary;
  facets: TraceInsightsFacets;
  tools: TraceInsightsMetricRow[];
  skills: TraceInsightsMetricRow[];
  models: TraceInsightsMetricRow[];
  failures: TraceInsightsMetricRow[];
  events: TraceInsightsMetricRow[];
  runs: TraceInsightsRunRow[];
}

interface BuildTraceInsightsInput {
  sessions: TraceSessionLike[];
  entriesBySession: Map<string, TraceEntryLike[]>;
  runEventsByRun?: Map<string, TraceEntryLike[]>;
  filters?: TraceInsightsFilters;
}

interface MutableMetric {
  id: string;
  label: string;
  sessions: Set<string>;
  runs: Set<string>;
  calls: number;
  successes: number;
  failures: number;
  durationMs: number;
  totalTurns: number;
  totalCost: number;
  sampleSessionId?: string;
  sampleRunId?: string;
  sampleError?: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isSuccessOutcome(outcome: unknown): boolean {
  return outcome === "completed" || outcome === "success";
}

function failureLabel(session: TraceSessionLike): string | null {
  const code = asString(session.failureCode);
  if (code && code !== "none") return code;
  const category = asString(session.failureCategory);
  if (category && category !== "none") return category;
  const outcome = asString(session.outcome);
  return isSuccessOutcome(outcome) ? null : outcome || "unknown_failure";
}

function sessionSkills(session: TraceSessionLike): string[] {
  const skills = new Set<string>();
  const metrics = session.skillToolMetrics as { skillId?: unknown } | undefined;
  const metricSkill = asString(metrics?.skillId);
  if (metricSkill) skills.add(metricSkill);

  const plan = session.planDecomposition as
    | { steps?: Array<{ selectedSkillId?: unknown }> }
    | undefined;
  for (const step of plan?.steps ?? []) {
    const selectedSkillId = asString(step.selectedSkillId);
    if (selectedSkillId) skills.add(selectedSkillId);
  }

  return Array.from(skills);
}

function getEntriesToolNames(entries: TraceEntryLike[]): string[] {
  const tools = new Set<string>();
  for (const entry of entries) {
    const executions = Array.isArray(entry.toolExecutions)
      ? entry.toolExecutions
      : [];
    for (const execution of executions) {
      if (!execution || typeof execution !== "object") continue;
      const name = asString((execution as Record<string, unknown>).toolName);
      if (name) tools.add(name);
    }
  }
  return Array.from(tools);
}

function getEntriesEventTypes(entries: TraceEntryLike[]): string[] {
  const eventTypes = new Set<string>();
  for (const entry of entries) {
    const events = Array.isArray(entry.events) ? entry.events : [];
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const type = asString((event as Record<string, unknown>).type);
      if (type) eventTypes.add(type);
    }
  }
  return Array.from(eventTypes);
}

function getRunEventTypes(events: TraceEntryLike[]): string[] {
  const eventTypes = new Set<string>();
  for (const event of events) {
    const type = asString(event.type);
    if (type) eventTypes.add(type);
  }
  return Array.from(eventTypes);
}

function matchesExtendedFilters(
  session: TraceSessionLike,
  entries: TraceEntryLike[],
  runEvents: TraceEntryLike[],
  filters: TraceInsightsFilters,
): boolean {
  if (!matchesTraceFilters(session, filters, entries)) return false;

  const sessionId = asString(session.sessionId);
  const sessionFilter = asString(filters.sessionId).trim();
  if (sessionFilter && !sessionId.startsWith(sessionFilter)) return false;

  const skill = asString(filters.skill).trim();
  if (skill && skill !== "all" && !sessionSkills(session).includes(skill)) {
    return false;
  }

  const failure = asString(filters.failure).trim();
  if (failure && failure !== "all" && failureLabel(session) !== failure) {
    return false;
  }

  const tool = asString(filters.tool).trim();
  const toolStatus = asString(filters.toolStatus).trim();
  if (tool || (toolStatus && toolStatus !== "all")) {
    const executions = entries.flatMap((entry) =>
      Array.isArray(entry.toolExecutions) ? entry.toolExecutions : [],
    );
    const matched = executions.some((execution) => {
      if (!execution || typeof execution !== "object") return false;
      const record = execution as Record<string, unknown>;
      const name = asString(record.toolName);
      const success = record.success === true;
      if (tool && name !== tool) return false;
      if (toolStatus === "success" && !success) return false;
      if (toolStatus === "failure" && success) return false;
      return true;
    });
    if (!matched) return false;
  }

  const eventType = asString(filters.eventType).trim();
  if (eventType && eventType !== "all") {
    const turnEventMatch = getEntriesEventTypes(entries).includes(eventType);
    const runEventMatch = getRunEventTypes(runEvents).includes(eventType);
    if (!turnEventMatch && !runEventMatch) return false;
  }

  return true;
}

function metric(
  map: Map<string, MutableMetric>,
  id: string,
  label = id,
): MutableMetric {
  let value = map.get(id);
  if (!value) {
    value = {
      id,
      label,
      sessions: new Set(),
      runs: new Set(),
      calls: 0,
      successes: 0,
      failures: 0,
      durationMs: 0,
      totalTurns: 0,
      totalCost: 0,
    };
    map.set(id, value);
  }
  return value;
}

function recordSessionMetric(
  row: MutableMetric,
  session: TraceSessionLike,
): void {
  const sessionId = asString(session.sessionId);
  const runId = asString(session.runId);
  if (sessionId) {
    row.sessions.add(sessionId);
    row.sampleSessionId ??= sessionId;
  }
  if (runId) {
    row.runs.add(runId);
    row.sampleRunId ??= runId;
  }
  row.totalTurns += asNumber(session.turnCount);
  row.totalCost += asNumber(
    (session.metrics as { totalCost?: unknown } | null | undefined)?.totalCost,
  );
}

function finalizeMetricRows(map: Map<string, MutableMetric>): TraceInsightsMetricRow[] {
  return Array.from(map.values())
    .map((row) => ({
      id: row.id,
      label: row.label,
      sessions: row.sessions.size,
      runs: row.runs.size,
      calls: row.calls || undefined,
      successes: row.successes || undefined,
      failures: row.failures || undefined,
      failureRate: row.calls > 0 ? row.failures / row.calls : undefined,
      averageDurationMs:
        row.calls > 0 && row.durationMs > 0 ? row.durationMs / row.calls : undefined,
      totalTurns: row.totalTurns || undefined,
      totalCost: row.totalCost || undefined,
      sampleSessionId: row.sampleSessionId,
      sampleRunId: row.sampleRunId,
      sampleError: row.sampleError,
    }))
    .sort((a, b) => {
      const failureDelta = (b.failures ?? 0) - (a.failures ?? 0);
      if (failureDelta !== 0) return failureDelta;
      const callDelta = (b.calls ?? 0) - (a.calls ?? 0);
      if (callDelta !== 0) return callDelta;
      return b.sessions - a.sessions;
    });
}

function topKeys(counts: Map<string, number>, limit = 3): string[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

export function buildTraceInsights({
  sessions,
  entriesBySession,
  runEventsByRun = new Map(),
  filters = {},
}: BuildTraceInsightsInput): TraceInsightsResponse {
  const selected = sessions.filter((session) => {
    const sessionId = asString(session.sessionId);
    const runId = asString(session.runId);
    return matchesExtendedFilters(
      session,
      entriesBySession.get(sessionId) ?? [],
      runId ? (runEventsByRun.get(runId) ?? []) : [],
      filters,
    );
  });

  const tools = new Map<string, MutableMetric>();
  const skills = new Map<string, MutableMetric>();
  const models = new Map<string, MutableMetric>();
  const failures = new Map<string, MutableMetric>();
  const events = new Map<string, MutableMetric>();
  const runs = new Map<
    string,
    {
      runId: string;
      query: string;
      outcome: string;
      sessions: TraceSessionLike[];
      toolCounts: Map<string, number>;
      skillCounts: Map<string, number>;
    }
  >();
  const facets: TraceInsightsFacets = {
    runs: [],
    sessions: [],
    domains: [],
    models: [],
    skills: [],
    tools: [],
    failures: [],
    eventTypes: [],
  };
  const facetSets = {
    runs: new Set<string>(),
    sessions: new Set<string>(),
    domains: new Set<string>(),
    models: new Set<string>(),
    skills: new Set<string>(),
    tools: new Set<string>(),
    failures: new Set<string>(),
    eventTypes: new Set<string>(),
  };

  let completedSessions = 0;
  let totalTurns = 0;
  let totalCost = 0;
  let totalDurationMs = 0;
  let toolCalls = 0;
  let toolFailures = 0;
  const processedRunEvents = new Set<string>();

  for (const session of selected) {
    const sessionId = asString(session.sessionId);
    const runId = asString(session.runId);
    const entries = entriesBySession.get(sessionId) ?? [];
    const runEvents = runId ? (runEventsByRun.get(runId) ?? []) : [];

    if (sessionId) facetSets.sessions.add(sessionId);
    if (runId) facetSets.runs.add(runId);
    const domain = extractDomain(session.startUrl);
    if (domain) facetSets.domains.add(domain);

    if (isSuccessOutcome(session.outcome)) completedSessions += 1;
    totalTurns += asNumber(session.turnCount);
    totalCost += asNumber(
      (session.metrics as { totalCost?: unknown } | null | undefined)?.totalCost,
    );
    totalDurationMs += Math.max(
      0,
      asNumber(session.endTime) - asNumber(session.startTime),
    );

    if (runId) {
      let run = runs.get(runId);
      if (!run) {
        run = {
          runId,
          query: asString(session.query),
          outcome: "completed",
          sessions: [],
          toolCounts: new Map(),
          skillCounts: new Map(),
        };
        runs.set(runId, run);
      }
      run.sessions.push(session);
      if (!isSuccessOutcome(session.outcome)) run.outcome = asString(session.outcome);
    }

    const failure = failureLabel(session);
    if (failure) {
      facetSets.failures.add(failure);
      const row = metric(failures, failure);
      recordSessionMetric(row, session);
      row.calls += 1;
      row.failures += 1;
    }

    for (const model of getSessionModels(session)) {
      facetSets.models.add(model);
      const row = metric(models, model);
      recordSessionMetric(row, session);
      row.calls += 1;
      if (isSuccessOutcome(session.outcome)) row.successes += 1;
      else row.failures += 1;
    }

    for (const skill of sessionSkills(session)) {
      facetSets.skills.add(skill);
      const row = metric(skills, skill);
      recordSessionMetric(row, session);
      row.calls += 1;
      if (isSuccessOutcome(session.outcome)) row.successes += 1;
      else row.failures += 1;
      if (runId) {
        const run = runs.get(runId);
        run?.skillCounts.set(skill, (run.skillCounts.get(skill) ?? 0) + 1);
      }
    }

    for (const tool of getEntriesToolNames(entries)) {
      facetSets.tools.add(tool);
    }
    for (const type of [...getEntriesEventTypes(entries), ...getRunEventTypes(runEvents)]) {
      facetSets.eventTypes.add(type);
    }

    for (const entry of entries) {
      const executions = Array.isArray(entry.toolExecutions)
        ? entry.toolExecutions
        : [];
      for (const execution of executions) {
        if (!execution || typeof execution !== "object") continue;
        const record = execution as Record<string, unknown>;
        const toolName = asString(record.toolName);
        if (!toolName) continue;
        const row = metric(tools, toolName);
        recordSessionMetric(row, session);
        row.calls += 1;
        row.durationMs += asNumber(record.durationMs);
        const success = record.success === true;
        if (success) row.successes += 1;
        else {
          row.failures += 1;
          row.sampleError ??= asString(record.error) || asString(record.result);
          toolFailures += 1;
        }
        toolCalls += 1;
        if (runId) {
          const run = runs.get(runId);
          run?.toolCounts.set(toolName, (run.toolCounts.get(toolName) ?? 0) + 1);
        }
      }

      const turnEvents = Array.isArray(entry.events) ? entry.events : [];
      for (const event of turnEvents) {
        if (!event || typeof event !== "object") continue;
        const type = asString((event as Record<string, unknown>).type);
        if (!type) continue;
        const row = metric(events, type);
        recordSessionMetric(row, session);
        row.calls += 1;
      }
    }

    if (runId && !processedRunEvents.has(runId)) {
      processedRunEvents.add(runId);
      for (const runEvent of runEvents) {
        const type = asString(runEvent.type);
        if (!type) continue;
        const row = metric(events, type);
        recordSessionMetric(row, session);
        row.calls += 1;
      }
    }
  }

  for (const key of Object.keys(facets) as Array<keyof TraceInsightsFacets>) {
    facets[key] = Array.from(facetSets[key]).sort();
  }

  const runRows = Array.from(runs.values())
    .map((run): TraceInsightsRunRow => {
      const sortedSessions = [...run.sessions].sort(
        (a, b) => asNumber(a.startTime) - asNumber(b.startTime),
      );
      const earliest = Math.min(...sortedSessions.map((s) => asNumber(s.startTime)));
      const latest = Math.max(...sortedSessions.map((s) => asNumber(s.endTime)));
      return {
        runId: run.runId,
        query: run.query,
        outcome: run.outcome,
        sessions: sortedSessions.length,
        failedSessions: sortedSessions.filter((s) => !isSuccessOutcome(s.outcome)).length,
        totalTurns: sortedSessions.reduce(
          (sum, session) => sum + asNumber(session.turnCount),
          0,
        ),
        totalCost: sortedSessions.reduce(
          (sum, session) =>
            sum +
            asNumber(
              (session.metrics as { totalCost?: unknown } | null | undefined)
                ?.totalCost,
            ),
          0,
        ),
        durationMs: Math.max(0, latest - earliest),
        topTools: topKeys(run.toolCounts),
        topSkills: topKeys(run.skillCounts),
        sampleSessionId: asString(sortedSessions[0]?.sessionId),
      };
    })
    .sort((a, b) => b.durationMs - a.durationMs);

  const totalSessions = selected.length;
  const failedSessions = totalSessions - completedSessions;
  return {
    summary: {
      totalSessions,
      totalRuns: runRows.length,
      completedSessions,
      failedSessions,
      successRate: totalSessions === 0 ? 0 : completedSessions / totalSessions,
      failureRate: totalSessions === 0 ? 0 : failedSessions / totalSessions,
      totalTurns,
      averageTurns: totalSessions === 0 ? 0 : totalTurns / totalSessions,
      totalCost,
      averageDurationMs: totalSessions === 0 ? 0 : totalDurationMs / totalSessions,
      toolCalls,
      toolFailures,
      toolFailureRate: toolCalls === 0 ? 0 : toolFailures / toolCalls,
    },
    facets,
    tools: finalizeMetricRows(tools),
    skills: finalizeMetricRows(skills),
    models: finalizeMetricRows(models),
    failures: finalizeMetricRows(failures),
    events: finalizeMetricRows(events),
    runs: runRows,
  };
}
