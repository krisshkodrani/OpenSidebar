import type { TraceSession, TraceEntry } from "../types/traces";
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

export async function fetchTraceSessions(
  filters: TraceFilters,
): Promise<TraceSession[]> {
  const params = new URLSearchParams();
  if (filters.outcome && filters.outcome !== "all")
    params.set("outcome", filters.outcome);
  if (filters.day && filters.day !== "all") params.set("day", filters.day);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.mode && filters.mode !== "all") params.set("mode", filters.mode);
  if (filters.model && filters.model !== "all")
    params.set("model", filters.model);
  if (filters.tier && filters.tier !== "all") params.set("tier", filters.tier);
  if (filters.runId) params.set("runId", filters.runId);
  params.set("limit", "1000");
  return fetchJson(`/api/traces/search?${params.toString()}`);
}

export async function fetchTraceDays(): Promise<DayBucket[]> {
  return fetchJson("/api/traces/days");
}

export async function fetchTraceModels(): Promise<ModelBucket[]> {
  return fetchJson("/api/traces/models");
}

export async function fetchTraceEntries(
  sessionId: string,
): Promise<TraceEntry[]> {
  return fetchJson(`/api/traces/${encodeURIComponent(sessionId)}`);
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
): Promise<SessionLogEntry[]> {
  const params = new URLSearchParams();
  if (level) params.set("level", level);
  const query = params.toString();
  return fetchJson(
    `/api/logs/${encodeURIComponent(sessionId)}${query ? `?${query}` : ""}`,
  );
}

// ── Backend agent service (port 7590) ─────────────────────

const BACKEND_URL = "http://127.0.0.1:7590";
const traceDiagnosisCache = new Map<string, TraceDiagnosis>();

export interface BackendMemoryRecord {
  slug: string;
  title: string;
  type: string;
}

export interface BackendMemoryDetail {
  slug: string;
  title: string;
  category: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface BackendScheduledTask {
  id: string;
  description: string;
  query: string;
  tabUrl: string | null;
  workspaceId: string | null;
  schedule: string | null;
  runAt: number | null;
  status: string;
  lastRunAt: number | null;
  result: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BackendHealth {
  status: string;
  uptime: number;
  gbrainConnected: boolean;
  pendingTasks: number;
  memoryStats?: { pageCount: number };
}

export interface TraceDiagnosisSummary {
  slug: string;
  title: string;
  recorded_at: string | null;
  session_id: string;
  run_id: string | null;
  domain: string | null;
  fixture: string | null;
  outcome: string;
  failure_category: string;
  failure_code: string;
  turn_count: number;
  models: string[];
  tools: string[];
  events: string[];
  summary: string;
  score?: number;
}

export interface TraceDiagnosisDetail {
  slug: string;
  title: string;
  tags: string[];
  page: {
    type: string;
    updated_at: string;
    compiled_truth: string;
    frontmatter?: Record<string, unknown>;
  };
  session: {
    sessionId: string;
    runId: string | null;
    workspaceId: string | null;
    recordedAt: string | null;
    startTime: number;
    endTime: number;
    startUrl: string;
    domain: string | null;
    fixture: string | null;
    outcome: string;
    failureCategory: string | null;
    failureCode: string | null;
    failureDetail: string | null;
    turnCount: number;
    summary: string;
    models: string[];
    metrics: Record<string, unknown> | null;
    sourceFiles: Record<string, string> | null;
  };
  turns?: Array<{
    turnNumber: number;
    timestamp: number;
    url: string | null;
    title: string | null;
    llmDurationMs: number | null;
    toolNames: string[];
    eventTypes: string[];
    responseSnippet: string;
    toolResults: Array<{
      toolName: string;
      success: boolean;
      detail: string;
    }>;
  }>;
  timeline?: Array<{
    date: string;
    source: string;
    summary: string;
    detail: string;
  }>;
}

export interface TracePathologySummary {
  total_sessions: number;
  failed_sessions: number;
  completed_sessions: number;
  outcomes: Array<{ value: string; count: number }>;
  failure_categories: Array<{ value: string; count: number }>;
  failure_codes: Array<{ value: string; count: number }>;
  domains: Array<{ value: string; count: number }>;
  fixtures: Array<{ value: string; count: number }>;
  recurring_tools_in_failed_sessions: Array<{ value: string; count: number }>;
  recurring_events_in_failed_sessions: Array<{ value: string; count: number }>;
}

export interface TraceDiagnosis {
  session: TraceDiagnosisDetail;
  similarFailures: {
    target: TraceDiagnosisSummary | null;
    query: string | null;
    failure_code: string | null;
    total_matches: number;
    results: TraceDiagnosisSummary[];
  };
  pathologySummary: TracePathologySummary;
  pathologyScope: {
    domain: string | null;
    fixture: string | null;
  };
}

export interface TraceResearchSeedResult {
  title: string;
  output: string;
}

export interface TraceBugBriefResult {
  title: string;
  content: string;
}

async function backendFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BACKEND_URL}${path}`, init);
  if (!r.ok) throw new Error(`Backend HTTP ${r.status}`);
  return r.json();
}

export async function fetchBackendHealth(): Promise<BackendHealth> {
  return backendFetch("/health");
}

export async function fetchMemoryList(category?: string): Promise<BackendMemoryRecord[]> {
  const params = category ? `?category=${encodeURIComponent(category)}` : "";
  const data = await backendFetch<{ results: BackendMemoryRecord[] }>(`/memory/list${params}`);
  return data.results;
}

export async function fetchMemorySearch(query: string): Promise<BackendMemoryDetail[]> {
  const data = await backendFetch<{ results: BackendMemoryDetail[] }>(
    `/memory/search?q=${encodeURIComponent(query)}&limit=20`,
  );
  return data.results;
}

export async function fetchMemoryDetail(slug: string): Promise<BackendMemoryDetail> {
  return backendFetch(`/memory/${encodeURIComponent(slug)}`);
}

export async function deleteMemory(slug: string): Promise<void> {
  await fetch(`${BACKEND_URL}/memory/${encodeURIComponent(slug)}`, { method: "DELETE" });
}

export async function fetchScheduledTasks(): Promise<BackendScheduledTask[]> {
  const data = await backendFetch<{ tasks: BackendScheduledTask[] }>("/tasks?limit=100");
  return data.tasks;
}

export async function deleteScheduledTask(id: string): Promise<void> {
  await fetch(`${BACKEND_URL}/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchTraceDiagnosis(sessionId: string): Promise<TraceDiagnosis> {
  const cached = traceDiagnosisCache.get(sessionId);
  if (cached) return cached;
  const result = await backendFetch<TraceDiagnosis>(
    `/lab/traces/diagnosis?sessionId=${encodeURIComponent(sessionId)}&limit=5`,
  );
  traceDiagnosisCache.set(sessionId, result);
  return result;
}

export async function createTraceResearchSeed(
  sessionId: string,
): Promise<TraceResearchSeedResult> {
  return backendFetch("/lab/research-seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

export async function createTraceBugBrief(
  sessionId: string,
): Promise<TraceBugBriefResult> {
  return backendFetch("/lab/bug-brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}
