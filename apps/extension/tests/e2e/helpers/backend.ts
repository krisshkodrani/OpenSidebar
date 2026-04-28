const BACKEND_URL = "http://127.0.0.1:7589/api/backend";
const BACKEND_TIMEOUT_MS = 8_000;

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

export async function waitForBackendHealthy(timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isBackendHealthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
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
