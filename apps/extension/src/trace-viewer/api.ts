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
