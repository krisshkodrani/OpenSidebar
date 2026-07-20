import {
  extractDomain,
  getSessionModels,
  matchesTraceFilters,
  normalizeTraceModelId,
  type TraceEntryLike,
  type TraceSearchFiltersLike,
  type TraceSessionLike,
} from "./log-server-helpers";
import { estimateCostBreakdownUsd } from "../apps/extension/src/background/llm/pricing";
import type {
  ProviderConfig,
  TokenUsage,
} from "../apps/extension/src/background/llm/types";

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
  requests?: number;
  successes?: number;
  failures?: number;
  failureRate?: number;
  averageDurationMs?: number;
  totalTurns?: number;
  totalCost?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  requestCost?: number;
  estimatedInputCost?: number;
  estimatedCachedInputCost?: number;
  estimatedOutputCost?: number;
  estimatedRequestCost?: number;
  outputTokenShare?: number;
  outputCostShare?: number;
  unpricedRequests?: number;
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
  llmRequests: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  nonCachedInputTokens: number;
  totalTokens: number;
  requestCost: number;
  estimatedInputCost: number;
  estimatedCachedInputCost: number;
  estimatedOutputCost: number;
  estimatedRequestCost: number;
  outputTokenShare: number;
  outputCostShare: number;
  unpricedRequests: number;
  averagePromptTokens: number;
  averageCompletionTokens: number;
  averageTotalTokens: number;
  totalLlmDurationMs: number;
  averageLlmDurationMs: number;
  partialHandoffCount: number;
  maxTurnsWithHandoffCount: number;
  maxTurnsWithoutUsefulProgressCount: number;
  /** Sessions with at least one escalation fire (RFC LP-2 events). */
  escalatedSessions: number;
  /** Total escalation fires (escalation events + stuck_signal escalate). */
  escalations: number;
  escalationRescued: number;
  escalationFailedFast: number;
  escalationBudgetExhausted: number;
  /** escalatedSessions / totalSessions. */
  escalationFireRate: number;
  /** rescued / recorded escalation outcomes. */
  escalationRescueRate: number;
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

const MAX_RUN_ROWS = 200;
const MAX_FACET_IDS = 500;
const MAX_TEXT_FIELD_LENGTH = 500;

interface MutableMetric {
  id: string;
  label: string;
  sessions: Set<string>;
  runs: Set<string>;
  calls: number;
  requests: number;
  successes: number;
  failures: number;
  durationMs: number;
  totalTurns: number;
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  requestCost: number;
  estimatedInputCost: number;
  estimatedCachedInputCost: number;
  estimatedOutputCost: number;
  estimatedRequestCost: number;
  unpricedRequests: number;
  sampleSessionId?: string;
  sampleRunId?: string;
  sampleError?: string;
}

const PROVIDER_IDS = new Set<ProviderConfig["providerId"]>([
  "openrouter",
  "openai",
  "groq",
  "fireworks",
  "moonshot",
  "deepseek",
  "xiaomi",
]);

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function truncateText(value: string, maxLength = MAX_TEXT_FIELD_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function usageNumber(
  usage: Record<string, unknown> | null | undefined,
  keys: string[],
): number {
  if (!usage) return 0;
  for (const key of keys) {
    const value = asNumber(usage[key]);
    if (value > 0) return value;
  }
  return 0;
}

function cachedTokensFromUsage(
  usage: Record<string, unknown> | null | undefined,
  promptTokens: number,
): number {
  if (!usage) return 0;
  let cachedTokens = usageNumber(usage, ["cached_tokens"]);
  const promptTokenDetails =
    usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
      ? (usage.prompt_tokens_details as Record<string, unknown>)
      : null;
  if (cachedTokens === 0) {
    cachedTokens = usageNumber(promptTokenDetails, ["cached_tokens"]);
  }
  const cacheTelemetry =
    usage.cacheTelemetry && typeof usage.cacheTelemetry === "object"
      ? (usage.cacheTelemetry as Record<string, unknown>)
      : null;
  if (cachedTokens === 0) {
    cachedTokens = usageNumber(cacheTelemetry, ["cachedPromptTokens"]);
  }
  return Math.max(0, Math.min(cachedTokens, promptTokens));
}

function asProviderId(value: unknown): ProviderConfig["providerId"] | null {
  const provider = asString(value);
  return PROVIDER_IDS.has(provider as ProviderConfig["providerId"])
    ? (provider as ProviderConfig["providerId"])
    : null;
}

function inferProviderIdFromModel(
  model: string,
): ProviderConfig["providerId"] | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("accounts/fireworks/")) return "fireworks";
  if (normalized.startsWith("kimi-")) return "moonshot";
  if (normalized.startsWith("deepseek-")) return "deepseek";
  if (normalized.startsWith("mimo-")) return "xiaomi";
  if (normalized.includes("kimi-k2p")) return "fireworks";
  return null;
}

function estimateEntryCostBreakdown(args: {
  providerId: ProviderConfig["providerId"] | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
}) {
  if (!args.providerId || !args.model) return null;
  return estimateCostBreakdownUsd(args.providerId, args.model, {
    prompt_tokens: args.promptTokens,
    completion_tokens: args.completionTokens,
    total_tokens: args.totalTokens,
    cached_tokens: args.cachedTokens,
  } satisfies TokenUsage);
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

function getSessionEventTypes(session: TraceSessionLike): string[] {
  const eventTypes = new Set<string>();
  const events = Array.isArray(session.events) ? session.events : [];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const type = asString((event as Record<string, unknown>).type);
    if (type) eventTypes.add(type);
  }
  return Array.from(eventTypes);
}

interface EscalationStats {
  fires: number;
  rescued: number;
  failedFast: number;
  budgetExhausted: number;
}

/**
 * Count escalation fires and outcomes from turn-entry and session events,
 * mirroring the per-trace logic in trace-viewer/diagnostics.ts: a fire is an
 * `escalation` event or a `stuck_signal` with data.type === "escalate"; the
 * outcome comes from `escalation_outcome` data.outcome.
 */
function collectEscalationStats(
  entries: TraceEntryLike[],
  session: TraceSessionLike,
): EscalationStats {
  const stats: EscalationStats = {
    fires: 0,
    rescued: 0,
    failedFast: 0,
    budgetExhausted: 0,
  };
  const eventLists: unknown[][] = [
    ...entries.map((entry) => (Array.isArray(entry.events) ? entry.events : [])),
    Array.isArray(session.events) ? session.events : [],
  ];
  for (const events of eventLists) {
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const record = event as Record<string, unknown>;
      const type = asString(record.type);
      const data = (record.data ?? {}) as Record<string, unknown>;
      if (type === "escalation") {
        stats.fires += 1;
      } else if (type === "stuck_signal" && asString(data.type) === "escalate") {
        stats.fires += 1;
      } else if (type === "escalation_outcome") {
        const outcome = asString(data.outcome);
        if (outcome === "rescued") stats.rescued += 1;
        else if (outcome === "failed_fast") stats.failedFast += 1;
        else if (outcome === "budget_exhausted") stats.budgetExhausted += 1;
      }
    }
  }
  return stats;
}

function getPartialHandoff(
  session: TraceSessionLike,
): Record<string, unknown> | null {
  const handoff = session.partialHandoff;
  return handoff && typeof handoff === "object"
    ? (handoff as Record<string, unknown>)
    : null;
}

function partialHandoffHasUsefulProgress(handoff: Record<string, unknown>): boolean {
  const evidence = Array.isArray(handoff.evidence) ? handoff.evidence : [];
  const completed = Array.isArray(handoff.completed) ? handoff.completed : [];
  const currentState =
    handoff.currentState && typeof handoff.currentState === "object"
      ? (handoff.currentState as Record<string, unknown>)
      : {};
  return (
    evidence.length > 0 ||
    completed.length > 0 ||
    Boolean(asString(currentState.url) || asString(currentState.title))
  );
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
    const sessionEventMatch = getSessionEventTypes(session).includes(eventType);
    const runEventMatch = getRunEventTypes(runEvents).includes(eventType);
    if (!turnEventMatch && !sessionEventMatch && !runEventMatch) return false;
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
      requests: 0,
      successes: 0,
      failures: 0,
      durationMs: 0,
      totalTurns: 0,
      totalCost: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      requestCost: 0,
      estimatedInputCost: 0,
      estimatedCachedInputCost: 0,
      estimatedOutputCost: 0,
      estimatedRequestCost: 0,
      unpricedRequests: 0,
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
  const hadSession = sessionId ? row.sessions.has(sessionId) : false;
  if (sessionId) {
    row.sessions.add(sessionId);
    row.sampleSessionId ??= sessionId;
  }
  if (runId) {
    row.runs.add(runId);
    row.sampleRunId ??= runId;
  }
  if (!hadSession) {
    row.totalTurns += asNumber(session.turnCount);
    row.totalCost += asNumber(
      (session.metrics as { totalCost?: unknown } | null | undefined)?.totalCost,
    );
  }
}

function finalizeMetricRows(map: Map<string, MutableMetric>): TraceInsightsMetricRow[] {
  return Array.from(map.values())
    .map((row) => ({
      id: row.id,
      label: row.label,
      sessions: row.sessions.size,
      runs: row.runs.size,
      calls: row.calls || undefined,
      requests: row.requests || undefined,
      successes: row.successes || undefined,
      failures: row.failures || undefined,
      failureRate: row.calls > 0 ? row.failures / row.calls : undefined,
      averageDurationMs:
        row.calls > 0 && row.durationMs > 0 ? row.durationMs / row.calls : undefined,
      totalTurns: row.totalTurns || undefined,
      totalCost: row.totalCost || undefined,
      promptTokens: row.promptTokens || undefined,
      completionTokens: row.completionTokens || undefined,
      cachedTokens: row.cachedTokens || undefined,
      totalTokens: row.totalTokens || undefined,
      requestCost: row.requestCost || undefined,
      estimatedInputCost: row.estimatedInputCost || undefined,
      estimatedCachedInputCost: row.estimatedCachedInputCost || undefined,
      estimatedOutputCost: row.estimatedOutputCost || undefined,
      estimatedRequestCost: row.estimatedRequestCost || undefined,
      outputTokenShare:
        row.totalTokens > 0 ? row.completionTokens / row.totalTokens : undefined,
      outputCostShare:
        row.estimatedRequestCost > 0
          ? row.estimatedOutputCost / row.estimatedRequestCost
          : undefined,
      unpricedRequests: row.unpricedRequests || undefined,
      sampleSessionId: row.sampleSessionId,
      sampleRunId: row.sampleRunId,
      sampleError: row.sampleError
        ? truncateText(row.sampleError)
        : row.sampleError,
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
  let llmRequests = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let totalTokens = 0;
  let requestCost = 0;
  let estimatedInputCost = 0;
  let estimatedCachedInputCost = 0;
  let estimatedOutputCost = 0;
  let estimatedRequestCost = 0;
  let unpricedRequests = 0;
  let totalLlmDurationMs = 0;
  let llmDurationCount = 0;
  let partialHandoffCount = 0;
  let maxTurnsWithHandoffCount = 0;
  let maxTurnsWithoutUsefulProgressCount = 0;
  let escalatedSessions = 0;
  let escalations = 0;
  let escalationRescued = 0;
  let escalationFailedFast = 0;
  let escalationBudgetExhausted = 0;
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
    const partialHandoff = getPartialHandoff(session);
    if (partialHandoff) {
      partialHandoffCount += 1;
      if (session.outcome === "max_turns") {
        maxTurnsWithHandoffCount += 1;
      }
    } else if (session.outcome === "max_turns") {
      maxTurnsWithoutUsefulProgressCount += 1;
    }
    if (
      session.outcome === "max_turns" &&
      partialHandoff &&
      !partialHandoffHasUsefulProgress(partialHandoff)
    ) {
      maxTurnsWithoutUsefulProgressCount += 1;
    }
    const escalationStats = collectEscalationStats(entries, session);
    if (escalationStats.fires > 0) escalatedSessions += 1;
    escalations += escalationStats.fires;
    escalationRescued += escalationStats.rescued;
    escalationFailedFast += escalationStats.failedFast;
    escalationBudgetExhausted += escalationStats.budgetExhausted;

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
    for (const type of [
      ...getEntriesEventTypes(entries),
      ...getSessionEventTypes(session),
      ...getRunEventTypes(runEvents),
    ]) {
      facetSets.eventTypes.add(type);
    }

    for (const entry of entries) {
      if (entry.llmRequest || entry.llmResponse) {
        llmRequests += 1;
      }
      const request =
        entry.llmRequest && typeof entry.llmRequest === "object"
          ? (entry.llmRequest as Record<string, unknown>)
          : null;
      const response =
        entry.llmResponse && typeof entry.llmResponse === "object"
          ? (entry.llmResponse as Record<string, unknown>)
          : null;
      const usage =
        response?.usage && typeof response.usage === "object"
          ? (response.usage as Record<string, unknown>)
          : null;
      const entryPromptTokens = usageNumber(usage, [
        "prompt_tokens",
        "input_tokens",
      ]);
      const entryCompletionTokens = usageNumber(usage, [
        "completion_tokens",
        "output_tokens",
      ]);
      const entryCachedTokens = cachedTokensFromUsage(usage, entryPromptTokens);
      const entryTotalTokens =
        usageNumber(usage, ["total_tokens"]) ||
        entryPromptTokens + entryCompletionTokens;
      const entryRequestCost = usageNumber(usage, ["cost"]);
      promptTokens += entryPromptTokens;
      completionTokens += entryCompletionTokens;
      cachedTokens += entryCachedTokens;
      totalTokens += entryTotalTokens;
      requestCost += entryRequestCost;
      const durationMs = asNumber(response?.durationMs);
      if (durationMs > 0) {
        totalLlmDurationMs += durationMs;
        llmDurationCount += 1;
      }
      const rawRequestModel = asString(response?.actualModel) || asString(request?.model);
      const requestModel = normalizeTraceModelId(rawRequestModel);
      const providerId =
        asProviderId(response?.actualProviderId) ??
        asProviderId(request?.provider) ??
        inferProviderIdFromModel(rawRequestModel);
      const costBreakdown = estimateEntryCostBreakdown({
        providerId,
        model: rawRequestModel,
        promptTokens: entryPromptTokens,
        completionTokens: entryCompletionTokens,
        totalTokens: entryTotalTokens,
        cachedTokens: entryCachedTokens,
      });
      if (costBreakdown) {
        estimatedInputCost += costBreakdown.inputCostUsd;
        estimatedCachedInputCost += costBreakdown.cachedInputCostUsd;
        estimatedOutputCost += costBreakdown.outputCostUsd;
        estimatedRequestCost += costBreakdown.totalCostUsd;
      } else if (entryPromptTokens > 0 || entryCompletionTokens > 0) {
        unpricedRequests += 1;
      }
      if (requestModel) {
        const row = metric(models, requestModel);
        recordSessionMetric(row, session);
        row.requests += 1;
        row.durationMs += durationMs;
        row.promptTokens += entryPromptTokens;
        row.completionTokens += entryCompletionTokens;
        row.cachedTokens += entryCachedTokens;
        row.totalTokens += entryTotalTokens;
        row.requestCost += entryRequestCost;
        if (costBreakdown) {
          row.estimatedInputCost += costBreakdown.inputCostUsd;
          row.estimatedCachedInputCost += costBreakdown.cachedInputCostUsd;
          row.estimatedOutputCost += costBreakdown.outputCostUsd;
          row.estimatedRequestCost += costBreakdown.totalCostUsd;
        } else if (entryPromptTokens > 0 || entryCompletionTokens > 0) {
          row.unpricedRequests += 1;
        }
      }

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

    const sessionEvents = Array.isArray(session.events) ? session.events : [];
    for (const event of sessionEvents) {
      if (!event || typeof event !== "object") continue;
      const type = asString((event as Record<string, unknown>).type);
      if (!type) continue;
      const row = metric(events, type);
      recordSessionMetric(row, session);
      row.calls += 1;
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
    const values = Array.from(facetSets[key]).sort();
    facets[key] =
      key === "runs" || key === "sessions"
        ? values.slice(0, MAX_FACET_IDS)
        : values;
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
        query: truncateText(run.query),
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
  const totalRuns = runRows.length;
  return {
    summary: {
      totalSessions,
      totalRuns,
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
      llmRequests,
      promptTokens,
      completionTokens,
      cachedTokens,
      nonCachedInputTokens: Math.max(promptTokens - cachedTokens, 0),
      totalTokens,
      requestCost,
      estimatedInputCost,
      estimatedCachedInputCost,
      estimatedOutputCost,
      estimatedRequestCost,
      outputTokenShare:
        totalTokens === 0 ? 0 : completionTokens / totalTokens,
      outputCostShare:
        estimatedRequestCost === 0 ? 0 : estimatedOutputCost / estimatedRequestCost,
      unpricedRequests,
      averagePromptTokens: llmRequests === 0 ? 0 : promptTokens / llmRequests,
      averageCompletionTokens:
        llmRequests === 0 ? 0 : completionTokens / llmRequests,
      averageTotalTokens: llmRequests === 0 ? 0 : totalTokens / llmRequests,
      totalLlmDurationMs,
      averageLlmDurationMs:
        llmDurationCount === 0 ? 0 : totalLlmDurationMs / llmDurationCount,
      partialHandoffCount,
      maxTurnsWithHandoffCount,
      maxTurnsWithoutUsefulProgressCount,
      escalatedSessions,
      escalations,
      escalationRescued,
      escalationFailedFast,
      escalationBudgetExhausted,
      escalationFireRate:
        totalSessions === 0 ? 0 : escalatedSessions / totalSessions,
      escalationRescueRate:
        escalationRescued + escalationFailedFast + escalationBudgetExhausted === 0
          ? 0
          : escalationRescued /
            (escalationRescued + escalationFailedFast + escalationBudgetExhausted),
    },
    facets,
    tools: finalizeMetricRows(tools),
    skills: finalizeMetricRows(skills),
    models: finalizeMetricRows(models),
    failures: finalizeMetricRows(failures),
    events: finalizeMetricRows(events),
    runs: runRows.slice(0, MAX_RUN_ROWS),
  };
}
