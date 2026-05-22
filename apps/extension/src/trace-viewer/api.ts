import type { TraceSession, TraceEntry } from "../types/traces";
import type { RunTraceEvent } from "../utils/run-trace";
import type {
  TraceFilters,
  DayBucket,
  ModelBucket,
  SessionLogEntry,
} from "./store/types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export const TRACE_SESSION_SEARCH_LIMIT = 1000;

export async function fetchTraceSessions(
  filters: TraceFilters,
  signal?: AbortSignal,
): Promise<TraceSession[]> {
  const params = new URLSearchParams();
  if (filters.outcome && filters.outcome !== "all")
    params.set("outcome", filters.outcome);
  if (filters.day && filters.day !== "all") params.set("day", filters.day);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.model && filters.model !== "all")
    params.set("model", filters.model);
  if (filters.skill && filters.skill !== "all")
    params.set("skill", filters.skill);
  if (filters.runId) params.set("runId", filters.runId);
  params.set("limit", String(TRACE_SESSION_SEARCH_LIMIT));
  return fetchJson(
    `/api/traces/search?${params.toString()}`,
    signal ? { signal } : undefined,
  );
}

export async function fetchTraceDays(
  signal?: AbortSignal,
): Promise<DayBucket[]> {
  return fetchJson("/api/traces/days", signal ? { signal } : undefined);
}

export async function fetchTraceModels(
  signal?: AbortSignal,
): Promise<ModelBucket[]> {
  return fetchJson("/api/traces/models", signal ? { signal } : undefined);
}

export interface TraceInsightsQuery {
  outcome?: string;
  day?: string;
  from?: string;
  to?: string;
  domain?: string;
  model?: string;
  skill?: string;
  runId?: string;
  sessionId?: string;
  tool?: string;
  toolStatus?: string;
  failure?: string;
  eventType?: string;
  q?: string;
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

export interface TraceInsightsResponse {
  summary: {
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
  };
  facets: {
    runs: string[];
    sessions: string[];
    domains: string[];
    models: string[];
    skills: string[];
    tools: string[];
    failures: string[];
    eventTypes: string[];
  };
  tools: TraceInsightsMetricRow[];
  skills: TraceInsightsMetricRow[];
  models: TraceInsightsMetricRow[];
  failures: TraceInsightsMetricRow[];
  events: TraceInsightsMetricRow[];
  runs: TraceInsightsRunRow[];
}

export interface TraceIndexStatus {
  available: boolean;
  source: "sqlite" | "jsonl";
  dbPath: string;
  indexedAt: number | null;
  hotTraceDays: number;
  sessions: number;
  hotSessions: number;
  archivedSessions: number;
  turns: number;
  tools: number;
  runEvents: number;
  screenshots: number;
  oldestSessionDay: string | null;
  newestSessionDay: string | null;
}

export interface HarnessRatchetCandidate {
  id: string;
  title: string;
  harnessLayer:
    | "tool"
    | "skill"
    | "prompt"
    | "policy"
    | "verifier"
    | "context"
    | "unknown";
  severity: "low" | "medium" | "high";
  count: number;
  failureRate?: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
  sampleSessionId?: string;
  sampleRunId?: string;
  evidenceQuery: string;
  suggestedAction: string;
}

export async function fetchTraceInsights(
  filters: TraceInsightsQuery,
  signal?: AbortSignal,
): Promise<TraceInsightsResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (!value || value === "all") continue;
    params.set(key, value);
  }
  const query = params.toString();
  return fetchJson(
    `/api/trace-insights${query ? `?${query}` : ""}`,
    signal ? { signal } : undefined,
  );
}

export async function fetchTraceIndexStatus(): Promise<TraceIndexStatus> {
  return fetchJson("/api/trace-index/status");
}

export async function fetchHarnessRatchet(): Promise<HarnessRatchetCandidate[]> {
  return fetchJson("/api/harness-ratchet");
}

export async function fetchTraceEntries(
  sessionId: string,
  signal?: AbortSignal,
): Promise<TraceEntry[]> {
  return fetchJson(
    `/api/traces/${encodeURIComponent(sessionId)}`,
    signal ? { signal } : undefined,
  );
}

export async function fetchRunTraceEvents(
  runId: string,
  signal?: AbortSignal,
): Promise<RunTraceEvent[]> {
  return fetchJson(
    `/api/run-traces/${encodeURIComponent(runId)}`,
    signal ? { signal } : undefined,
  );
}

export function screenshotUrl(sessionId: string, turn: number): string {
  return `/api/traces/${encodeURIComponent(sessionId)}/screenshots/${turn}`;
}

export async function deleteAllTraces(): Promise<{ deleted: number }> {
  return fetchJson("/api/traces", { method: "DELETE" });
}

export async function fetchSessionLogs(
  sessionId: string,
  level?: string,
  signal?: AbortSignal,
): Promise<SessionLogEntry[]> {
  const params = new URLSearchParams();
  if (level) params.set("level", level);
  const query = params.toString();
  return fetchJson(
    `/api/logs/${encodeURIComponent(sessionId)}${query ? `?${query}` : ""}`,
    signal ? { signal } : undefined,
  );
}

// ── Skill catalog API ─────────────────────────────────────

export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  tags: string[];
  triggers: string[];
  maturity: "draft" | "candidate" | "active";
  preferredTools?: string[];
  discouragedTools?: string[];
  capabilityNeeds?: string[];
  contextScope?: "turn" | "workspace";
  verifierMode: "deterministic" | "hybrid" | "llm";
  notes?: string[];
}

export interface SkillContract extends SkillDescriptor {
  procedureMarkdown: string;
  requiredEvidence?: string[];
  commonFailures?: Array<{
    signal: string;
    recovery: string;
  }>;
  executionContract?: {
    sequencing?: string[];
    toolDiscipline?: string[];
    completionChecks?: string[];
    failureRecovery?: string[];
  };
}

export async function fetchSkillCatalog(): Promise<SkillDescriptor[]> {
  return fetchJson("/api/skills");
}

export async function fetchSkillContract(
  skillId: string,
): Promise<SkillContract> {
  return fetchJson(`/api/skills/${encodeURIComponent(skillId)}`);
}

// ── Local backend API ─────────────────────────────────────

const BACKEND_URL = "/api/backend";

export interface BackendHealth {
  status: string;
  uptime: number;
  pendingTasks: number;
}

export interface BackendDurableRunSummary {
  id: string;
  clientRunId: string | null;
  workspaceId: string;
  query: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  currentNodeId?: string | null;
  nodeCounts: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    skipped: number;
  } | null;
  pendingInteraction: {
    kind: "approval" | "clarification";
    requestedAt: number;
    timeoutAt: number | null;
    active: boolean;
  } | null;
  progressSummary?: {
    completedPhases: string[];
    outstandingQuestions: string[];
    reviewedItemCount?: number;
    extractedFactCount?: number;
  };
  lastKnownResumeSafe: boolean | null;
  lastResumeSafetyCheckedAt: number | null;
  lastKnownResumeReason: string | null;
  lastResumeSource: "local" | "backend" | null;
  resumeRequestedAt: number | null;
  stopRequestedAt: number | null;
}

export interface BackendDurableRunDetail {
  run: {
    id: string;
    clientRunId: string | null;
    workspaceId: string;
    query: string;
    status: string;
    createdAt: number;
    updatedAt: number;
    finishedAt: number | null;
    rootTabId: number | null;
    rootTabUrl: string | null;
    turnNumber: number | null;
    terminationReason: string | null;
    checkpointSummary: Record<string, unknown> | null;
    sessionMetrics: Record<string, unknown> | null;
    budget: Record<string, unknown> | null;
    resumeStateVersion: number;
    nodeCounts: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
      skipped: number;
    } | null;
    resumeRequestedAt: number | null;
    resumeRequestedReason: string | null;
    stopRequestedAt: number | null;
    stopRequestedReason: string | null;
    lastKnownResumeSafe: boolean | null;
    lastResumeSafetyCheckedAt: number | null;
    lastKnownResumeReason: string | null;
    lastResumeSource: "local" | "backend" | null;
  };
  nodes: Array<{
    nodeId: string;
    description: string;
    successCriteria: string;
    status: string;
    retries: number;
    result: string | null;
    error: string | null;
  }>;
  progress: Array<{
    key: string;
    kind: string;
    payload: unknown;
    updatedAt: number;
  }>;
  pendingInteraction: {
    kind: "approval" | "clarification";
    status: string;
    requestedAt: number;
    timeoutAt: number | null;
  } | null;
  recentSideEffects: Array<{
    id: string;
    nodeId: string | null;
    toolName: string;
    result: string;
    timestamp: number;
  }>;
}

async function backendFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BACKEND_URL}${path}`, init);
  if (!r.ok) throw new Error(`Backend HTTP ${r.status}`);
  return r.json();
}

export async function fetchBackendHealth(): Promise<BackendHealth> {
  return backendFetch("/health");
}

export async function fetchDurableRuns(options?: {
  includeCompleted?: boolean;
  includeProgressSummary?: boolean;
  controlRequested?: boolean;
}): Promise<BackendDurableRunSummary[]> {
  const params = new URLSearchParams();
  if (options?.includeCompleted) params.set("include_completed", "true");
  if (options?.includeProgressSummary) {
    params.set("include_progress_summary", "true");
  }
  if (options?.controlRequested) params.set("control_requested", "true");
  const data = await backendFetch<{ runs: BackendDurableRunSummary[] }>(
    `/task-runs${params.size ? `?${params.toString()}` : ""}`,
  );
  return data.runs;
}

export async function fetchDurableRunDetail(
  id: string,
): Promise<BackendDurableRunDetail> {
  return backendFetch(`/task-runs/${encodeURIComponent(id)}`);
}

export async function requestDurableRunResume(id: string): Promise<void> {
  await backendFetch(`/task-runs/${encodeURIComponent(id)}/resume`, {
    method: "POST",
    body: JSON.stringify({ reason: "Trace viewer resume request" }),
    headers: { "Content-Type": "application/json" },
  });
}

export async function requestDurableRunStop(id: string): Promise<void> {
  await backendFetch(`/task-runs/${encodeURIComponent(id)}/stop`, {
    method: "POST",
    body: JSON.stringify({ reason: "Trace viewer stop request" }),
    headers: { "Content-Type": "application/json" },
  });
}
