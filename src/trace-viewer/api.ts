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
