/**
 * Backend Agent Service client — thin fetch wrapper.
 *
 * All calls are fire-and-forget with 2s timeout and silent catch when
 * the backend is not running. Same pattern as trace.ts and storage-logger.ts.
 */

import { logger } from "../../utils";

const BACKEND_URL = "http://127.0.0.1:7590";
const TIMEOUT_MS = 2000;

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

export async function markTaskRunning(id: string): Promise<void> {
  try {
    await backendFetch(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "running" }),
    });
  } catch {
    logger.debug("backend-client", "Task status update failed");
  }
}

export async function markTaskCompleted(
  id: string,
  result: string,
): Promise<void> {
  try {
    await backendFetch(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed", result }),
    });
  } catch {
    logger.debug("backend-client", "Task completion update failed");
  }
}

export async function markTaskFailed(
  id: string,
  result: string,
): Promise<void> {
  try {
    await backendFetch(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "failed", result }),
    });
  } catch {
    logger.debug("backend-client", "Task failure update failed");
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
