import type { TraceFilters, SkillRecord, MemoryRecord, DayBucket, CategoryBucket, SessionLogEntry } from "./store/types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function fetchTraceSessions(
  filters: TraceFilters,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams();
  if (filters.outcome && filters.outcome !== "all") params.set("outcome", filters.outcome);
  if (filters.day && filters.day !== "all") params.set("day", filters.day);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.sessionPrefix) params.set("sessionIdPrefix", filters.sessionPrefix);
  params.set("limit", "1000");
  return fetchJson(`/api/traces/search?${params.toString()}`);
}

export async function fetchTraceDays(): Promise<DayBucket[]> {
  return fetchJson("/api/traces/days");
}

export async function fetchTraceEntries(
  sessionId: string,
): Promise<Record<string, unknown>[]> {
  return fetchJson(`/api/traces/${encodeURIComponent(sessionId)}`);
}

export function screenshotUrl(sessionId: string, turn: number): string {
  return `/api/traces/${encodeURIComponent(sessionId)}/screenshots/${turn}`;
}

export async function fetchSessionLogs(
  sessionId: string,
  level?: string,
): Promise<SessionLogEntry[]> {
  const params = new URLSearchParams();
  if (level) params.set("level", level);
  const query = params.toString();
  return fetchJson(`/api/logs/${encodeURIComponent(sessionId)}${query ? `?${query}` : ""}`);
}

export async function fetchSkills(): Promise<SkillRecord[]> {
  return fetchJson("/api/skills");
}

export async function updateSkill(
  id: string,
  updates: Partial<SkillRecord>,
): Promise<SkillRecord> {
  return fetchJson(`/api/skills/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function deleteSkill(id: string): Promise<void> {
  const r = await fetch(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

export async function fetchMemory(
  params?: { category?: string; q?: string },
): Promise<MemoryRecord[]> {
  const qs = new URLSearchParams();
  if (params?.category) qs.set("category", params.category);
  if (params?.q) qs.set("q", params.q);
  const query = qs.toString();
  return fetchJson(`/api/memory${query ? `?${query}` : ""}`);
}

export async function fetchMemoryCategories(): Promise<CategoryBucket[]> {
  return fetchJson("/api/memory/categories");
}

export async function deleteMemoryEntry(id: string): Promise<void> {
  const r = await fetch(`/api/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}
