const BACKEND_URL = "http://127.0.0.1:7590";
const BACKEND_TIMEOUT_MS = 8_000;

export interface BackendMemoryResult {
  slug: string;
  title: string;
  category: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface BackendTaskRunSummary {
  id: string;
  workspaceId: string;
  clientRunId?: string | null;
  status: string;
  query: string;
  updatedAt: number;
  createdAt: number;
  lastResumeSource?: "local" | "backend" | null;
  stopRequestedAt?: number | null;
  resumeRequestedAt?: number | null;
}

export async function isBackendHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, {
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createSiteKnowledgeMemory(input: {
  title: string;
  content: string;
  domain: string;
  tipType?: "strategy" | "recovery" | "optimization";
  confidence?: number;
}): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "site-knowledge",
      title: input.title,
      content: input.content,
      metadata: {
        domain: input.domain,
        tipType: input.tipType ?? "strategy",
        confidence: input.confidence ?? 0.95,
      },
    }),
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Failed to create site knowledge memory: ${res.status}`);
  }

  const data = (await res.json()) as { slug?: string };
  if (!data.slug) {
    throw new Error("Backend did not return a memory slug");
  }
  return data.slug;
}

export async function deleteMemoryBySlug(slug: string): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/memory/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
  } catch {
    // Cleanup should be best-effort in E2E.
  }
}

export async function searchDomainMemories(
  domain: string,
): Promise<BackendMemoryResult[]> {
  const res = await fetch(
    `${BACKEND_URL}/memory/domain?d=${encodeURIComponent(domain)}&limit=20`,
    { signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS) },
  );
  if (!res.ok) {
    throw new Error(`Failed to load domain memories: ${res.status}`);
  }
  const data = (await res.json()) as { results?: BackendMemoryResult[] };
  return data.results ?? [];
}

export async function waitForBackendHealthy(timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isBackendHealthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

export async function waitForDomainMemory(
  domain: string,
  predicate: (memory: BackendMemoryResult) => boolean,
  timeoutMs = 8_000,
): Promise<BackendMemoryResult | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const memories = await searchDomainMemories(domain).catch(() => []);
    const match = memories.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

export async function listTaskRuns(params: {
  workspaceId?: string;
  status?: string;
  includeCompleted?: boolean;
  includeProgressSummary?: boolean;
  controlRequested?: boolean;
  limit?: number;
} = {}): Promise<BackendTaskRunSummary[]> {
  const search = new URLSearchParams();
  if (params.workspaceId) search.set("workspace_id", params.workspaceId);
  if (params.status) search.set("status", params.status);
  if (params.includeCompleted) search.set("include_completed", "true");
  if (params.includeProgressSummary) {
    search.set("include_progress_summary", "true");
  }
  if (params.controlRequested) search.set("control_requested", "true");
  if (params.limit) search.set("limit", String(params.limit));

  const res = await fetch(`${BACKEND_URL}/task-runs?${search.toString()}`, {
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Failed to list durable task runs: ${res.status}`);
  }

  const data = (await res.json()) as { runs?: BackendTaskRunSummary[] };
  return data.runs ?? [];
}

export async function waitForTaskRun(
  workspaceId: string,
  predicate: (run: BackendTaskRunSummary) => boolean,
  timeoutMs = 8_000,
): Promise<BackendTaskRunSummary | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const runs = await listTaskRuns({
      workspaceId,
      includeCompleted: true,
      limit: 10,
    }).catch(() => []);
    const match = runs.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}
