/**
 * Backend Agent Service client — thin fetch wrapper.
 *
 * All calls are fire-and-forget with 2s timeout and silent catch when
 * the backend is not running. Same pattern as trace.ts and storage-logger.ts.
 */

import { logger } from "../../utils";

const BACKEND_URL = "http://127.0.0.1:7590";
const TIMEOUT_MS = 5000;

// ── Types ──

export interface MemoryInput {
  category: "execution-result" | "user-preference" | "site-knowledge" | "learned-pattern";
  title: string;
  content: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryResult {
  slug: string;
  title: string;
  category: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface PendingTask {
  id: string;
  description: string;
  query: string;
  tabUrl: string | null;
  workspaceId: string | null;
}

export interface ProfileResolveResult {
  profilePath: string;
  values: Record<string, unknown>;
  missing: string[];
  sensitiveFields: string[];
}

// ── Helpers ──

async function backendFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${BACKEND_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...options.headers },
  });
}

// ── Memory ──

export async function postMemory(input: MemoryInput): Promise<void> {
  try {
    await backendFetch("/memory", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch {
    logger.debug("backend-client", "Memory write failed (backend may be offline)");
  }
}

export async function searchMemory(
  query: string,
  limit = 5,
): Promise<MemoryResult[]> {
  try {
    const res = await backendFetch(
      `/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results: MemoryResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function searchMemoryByDomain(
  domain: string,
  limit = 10,
): Promise<MemoryResult[]> {
  try {
    const res = await backendFetch(
      `/memory/domain?d=${encodeURIComponent(domain)}&limit=${limit}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results: MemoryResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function resolveProfileFields(
  fields: string[],
): Promise<ProfileResolveResult | null> {
  try {
    const res = await backendFetch("/profile/resolve", {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ProfileResolveResult;
  } catch {
    return null;
  }
}

// ── Tasks ──

export async function pollPendingTasks(): Promise<PendingTask[]> {
  try {
    const res = await backendFetch("/tasks/pending");
    if (!res.ok) return [];
    const data = (await res.json()) as { tasks: PendingTask[] };
    return data.tasks ?? [];
  } catch {
    return [];
  }
}

// ── Health ──

export async function isBackendAvailable(): Promise<boolean> {
  try {
    const res = await backendFetch("/health");
    return res.ok;
  } catch {
    return false;
  }
}

// ── Prompt formatting ──

export function formatBackendMemoriesForPrompt(
  memories: MemoryResult[],
): string {
  if (memories.length === 0) return "";

  const sections = ["LONG-TERM MEMORY (relevant past experiences):"];
  for (const mem of memories) {
    const content =
      mem.content.length > 300
        ? mem.content.slice(0, 300).trimEnd() + "..."
        : mem.content;
    sections.push("", `[${mem.category}] ${mem.title}`, content);
  }
  return sections.join("\n");
}
