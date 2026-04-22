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
  memoryConnected: boolean;
  pendingTasks: number;
  memoryStats?: { pageCount: number };
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

export async function fetchDurableRuns(
  options?: {
    includeCompleted?: boolean;
    includeProgressSummary?: boolean;
    controlRequested?: boolean;
  },
): Promise<BackendDurableRunSummary[]> {
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
