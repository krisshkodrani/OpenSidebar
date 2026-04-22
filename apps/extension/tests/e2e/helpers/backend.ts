const BACKEND_URL = "http://127.0.0.1:7590";
const BACKEND_TIMEOUT_MS = 8_000;

export interface BackendMemoryResult {
  id?: string;
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

export interface SeedDurableTaskRunInput {
  id: string;
  workspaceId: string;
  query: string;
  rootTabId: number;
  clientRunId?: string | null;
  status?: "planning" | "running" | "completed" | "failed" | "stopped";
  checkpointSummary?: Record<string, unknown> | null;
  sessionMetrics?: Record<string, unknown> | null;
  budget?: Record<string, unknown> | null;
}

export interface SeedDurableTaskRunNodeInput {
  description: string;
  successCriteria: string;
  selectedSkillId?: string | null;
  selectedSkillReason?: string | null;
  allowedTools?: string[];
  dependencies?: string[];
  assumptions?: string[];
  verificationGate?: Record<string, unknown> | null;
  handoffArtifacts?: unknown[];
  reflexionLog?: unknown[];
  handoffDepth?: number;
  handoffFromNodeId?: string | null;
  trajectory?: string[] | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  retries?: number;
  result?: string | null;
  error?: string | null;
}

export interface SeedDurableTaskRunProgressInput {
  key: string;
  kind:
    | "reviewed-item-list"
    | "extracted-fact-map"
    | "completed-phase-list"
    | "outstanding-question-list";
  payload: unknown;
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

export async function createMemory(input: {
  category:
    | "execution-result"
    | "user-preference"
    | "site-knowledge"
    | "learned-pattern";
  title: string;
  content: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<BackendMemoryResult> {
  const res = await fetch(`${BACKEND_URL}/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Failed to create memory: ${res.status}`);
  }

  const data = (await res.json()) as { id?: string; slug?: string };
  const id = data.id ?? data.slug;
  if (!id || !data.slug) {
    throw new Error("Backend did not return a memory id");
  }

  return {
    id,
    slug: data.slug,
    title: input.title,
    category: input.category,
    content: input.content,
    score: 1,
    metadata: input.metadata,
  };
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

export async function listMemories(params: {
  category?: string;
  limit?: number;
} = {}): Promise<BackendMemoryResult[]> {
  const search = new URLSearchParams();
  if (params.category) search.set("category", params.category);
  if (params.limit) search.set("limit", String(params.limit));
  const suffix = search.size ? `?${search.toString()}` : "";
  const res = await fetch(`${BACKEND_URL}/memory/list${suffix}`, {
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Failed to load memories: ${res.status}`);
  }
  const data = (await res.json()) as { results?: BackendMemoryResult[] };
  return data.results ?? [];
}

export async function searchMemories(
  query: string,
  limit = 10,
): Promise<BackendMemoryResult[]> {
  const res = await fetch(
    `${BACKEND_URL}/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS) },
  );
  if (!res.ok) {
    throw new Error(`Failed to search memories: ${res.status}`);
  }
  const data = (await res.json()) as { results?: BackendMemoryResult[] };
  return data.results ?? [];
}

export async function fetchMemoryBySlug(
  slug: string,
): Promise<BackendMemoryResult | null> {
  const res = await fetch(`${BACKEND_URL}/memory/${encodeURIComponent(slug)}`, {
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch memory detail: ${res.status}`);
  }
  return (await res.json()) as BackendMemoryResult;
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

export async function createDurableTaskRun(
  input: SeedDurableTaskRunInput,
): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/task-runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: input.id,
      clientRunId: input.clientRunId ?? null,
      workspaceId: input.workspaceId,
      query: input.query,
      rootTabId: input.rootTabId,
      status: input.status ?? "running",
      checkpointSummary:
        input.checkpointSummary ??
        {
          currentIndex: 0,
          nodeCount: 1,
          turnNumber: 1,
        },
      sessionMetrics:
        input.sessionMetrics ??
        {
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          totalCostActual: 0,
          totalCostEstimated: 0,
          costMode: "none",
          totalLlmTimeMs: 0,
          totalSessionTimeMs: 1_000,
          llmCallCount: 0,
          totalCachedTokens: 0,
          modelBreakdown: {},
        },
      budget:
        input.budget ??
        {
          maxSessionTimeMs: 120_000,
          maxTotalTokens: 200_000,
          maxTotalCostUsd: 1,
        },
    }),
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Failed to create durable task run: ${res.status}`);
  }
}

export async function upsertDurableTaskRunNode(
  runId: string,
  nodeId: string,
  input: SeedDurableTaskRunNodeInput,
): Promise<void> {
  const res = await fetch(
    `${BACKEND_URL}/task-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: input.description,
        successCriteria: input.successCriteria,
        selectedSkillId: input.selectedSkillId ?? null,
        selectedSkillReason: input.selectedSkillReason ?? null,
        allowedTools: input.allowedTools ?? [],
        dependencies: input.dependencies ?? [],
        assumptions: input.assumptions ?? [],
        verificationGate: input.verificationGate ?? null,
        handoffArtifacts: input.handoffArtifacts ?? [],
        reflexionLog: input.reflexionLog ?? [],
        handoffDepth: input.handoffDepth ?? 0,
        handoffFromNodeId: input.handoffFromNodeId ?? null,
        trajectory: input.trajectory ?? null,
        status: input.status,
        retries: input.retries ?? 0,
        result: input.result ?? null,
        error: input.error ?? null,
      }),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to upsert durable task run node: ${res.status}`);
  }
}

export async function upsertDurableTaskRunProgress(
  runId: string,
  input: SeedDurableTaskRunProgressInput,
): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/task-runs/${encodeURIComponent(runId)}/progress`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Failed to upsert durable task run progress: ${res.status}`);
  }
}
