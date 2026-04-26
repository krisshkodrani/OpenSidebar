/**
 * Backend Agent Service client — thin fetch wrapper.
 *
 * All calls are fire-and-forget with 2s timeout and silent catch when
 * the backend is not running. Same pattern as trace.ts and storage-logger.ts.
 */
import type {
  TaskRunProgressInput,
  TaskRunProgressKind,
  TaskRunProgressPayload,
} from "@shared-types/progress";
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
  id?: string;
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

export interface ProfileSafeContextResult {
  profilePath: string;
  entries: Array<{ path: string; value: unknown }>;
  rendered: string;
}

export interface ProfileFileResolveResult {
  profilePath: string;
  alias: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  data: string;
}

export type DurableTaskRunStatus =
  | "planning"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export interface DurableTaskRunCheckpointSummary {
  currentIndex: number;
  nodeCount: number;
  turnNumber: number | null;
  activeNodeId?: string | null;
  pageUrl?: string | null;
  snapshotFingerprint?: string | null;
  pendingInteractionKind?: "approval" | "clarification" | null;
}

export interface DurableTaskRun {
  id: string;
  clientRunId: string | null;
  workspaceId: string;
  query: string;
  rootTabId: number | null;
  rootTabUrl: string | null;
  turnNumber: number | null;
  status: DurableTaskRunStatus;
  startedAt: number | null;
  finishedAt: number | null;
  terminationReason: string | null;
  checkpointSummary: DurableTaskRunCheckpointSummary | null;
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
  lastResumeSource: "local" | "backend" | null;
  lastKnownResumeSafe: boolean | null;
  lastResumeSafetyCheckedAt: number | null;
  lastKnownResumeReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DurableTaskRunInput {
  id: string;
  clientRunId?: string | null;
  workspaceId: string;
  query: string;
  rootTabId?: number | null;
  rootTabUrl?: string | null;
  turnNumber?: number | null;
  status: DurableTaskRunStatus;
  startedAt?: number | null;
  finishedAt?: number | null;
  terminationReason?: string | null;
  checkpointSummary?: DurableTaskRunCheckpointSummary | null;
  sessionMetrics?: Record<string, unknown> | null;
  budget?: Record<string, unknown> | null;
  resumeStateVersion?: number;
  nodeCounts?: DurableTaskRun["nodeCounts"] | null;
  resumeRequestedAt?: number | null;
  resumeRequestedReason?: string | null;
  stopRequestedAt?: number | null;
  stopRequestedReason?: string | null;
  lastResumeSource?: "local" | "backend" | null;
  lastKnownResumeSafe?: boolean | null;
  lastResumeSafetyCheckedAt?: number | null;
  lastKnownResumeReason?: string | null;
}

export interface DurableTaskRunNodeInput {
  nodeId: string;
  description: string;
  successCriteria: string;
  selectedSkillId?: string | null;
  selectedSkillReason?: string | null;
  allowedTools: string[];
  dependencies: string[];
  assumptions: string[];
  verificationGate?: Record<string, unknown> | null;
  handoffArtifacts: unknown[];
  reflexionLog: unknown[];
  handoffDepth: number;
  handoffFromNodeId?: string | null;
  trajectory?: string[] | null;
  status: string;
  retries: number;
  result?: string | null;
  error?: string | null;
}

export interface DurableTaskRunNode extends DurableTaskRunNodeInput {
  runId: string;
  createdAt: number;
  updatedAt: number;
}

export interface DurableTaskRunProgress {
  runId: string;
  key: string;
  kind: TaskRunProgressKind;
  payload: TaskRunProgressPayload;
  updatedAt: number;
}

export interface DurablePendingInteractionInput {
  nodeId?: string | null;
  kind: "approval" | "clarification";
  payload: Record<string, unknown>;
  requestedAt: number;
  timeoutAt?: number | null;
  status: "active" | "resolved" | "timed_out" | "cleared";
}

export interface DurablePendingInteractionRecord
  extends DurablePendingInteractionInput {
  runId: string;
  updatedAt: number;
}

export interface DurableSideEffectInput {
  id: string;
  nodeId?: string | null;
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
  snapshotFingerprint?: string | null;
}

export interface DurableSideEffectRecord extends DurableSideEffectInput {
  runId: string;
}

export interface DurableTaskRunResumeResponse {
  run: DurableTaskRun;
  nodes: DurableTaskRunNode[];
  progress: DurableTaskRunProgress[];
  pendingInteraction: DurablePendingInteractionRecord | null;
  recentSideEffects: DurableSideEffectRecord[];
}

export interface DurableTaskRunSummary extends DurableTaskRun {
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
}

export type DurableTaskRunDetailResponse = DurableTaskRunResumeResponse;

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
    logger.debug("system", "Memory write failed (backend may be offline)");
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

export async function resolveProfileContext(
  query: string,
): Promise<ProfileSafeContextResult | null> {
  try {
    const res = await backendFetch("/profile/context", {
      method: "POST",
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ProfileSafeContextResult;
  } catch {
    return null;
  }
}

export async function resolveProfileFile(
  alias: string,
): Promise<ProfileFileResolveResult | null> {
  try {
    const res = await backendFetch("/profile/file", {
      method: "POST",
      body: JSON.stringify({ alias }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ProfileFileResolveResult;
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

// Durable task runs

export async function upsertTaskRun(input: DurableTaskRunInput): Promise<void> {
  try {
    await backendFetch("/task-runs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch {
    logger.debug("system", "Task run sync failed (backend may be offline)");
  }
}

export async function patchTaskRun(
  id: string,
  patch: Partial<DurableTaskRunInput>,
): Promise<void> {
  try {
    await backendFetch(`/task-runs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch {
    logger.debug("system", "Task run patch failed (backend may be offline)");
  }
}

export async function updateTaskRunCheckpoint(
  id: string,
  checkpointSummary: DurableTaskRunCheckpointSummary | null,
): Promise<void> {
  try {
    await backendFetch(`/task-runs/${encodeURIComponent(id)}/checkpoint`, {
      method: "PUT",
      body: JSON.stringify({ checkpointSummary }),
    });
  } catch {
    logger.debug("system", "Task run checkpoint sync failed");
  }
}

export async function upsertTaskRunNode(
  runId: string,
  node: DurableTaskRunNodeInput,
): Promise<void> {
  try {
    await backendFetch(
      `/task-runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node.nodeId)}`,
      {
        method: "PUT",
        body: JSON.stringify(node),
      },
    );
  } catch {
    logger.debug("system", "Task run node sync failed");
  }
}

export async function upsertTaskRunPendingInteraction(
  runId: string,
  interaction: DurablePendingInteractionInput | null,
): Promise<void> {
  try {
    await backendFetch(
      `/task-runs/${encodeURIComponent(runId)}/pending-interaction`,
      {
        method: "PUT",
        body: JSON.stringify({ interaction }),
      },
    );
  } catch {
    logger.debug("system", "Task run pending interaction sync failed");
  }
}

export async function upsertTaskRunProgress(
  runId: string,
  progress: TaskRunProgressInput,
): Promise<void> {
  try {
    await backendFetch(`/task-runs/${encodeURIComponent(runId)}/progress`, {
      method: "PUT",
      body: JSON.stringify(progress),
    });
  } catch {
    logger.debug("system", "Task run progress sync failed");
  }
}

export async function deleteTaskRunProgress(
  runId: string,
  key: string,
): Promise<void> {
  try {
    await backendFetch(
      `/task-runs/${encodeURIComponent(runId)}/progress/${encodeURIComponent(key)}`,
      {
        method: "DELETE",
      },
    );
  } catch {
    logger.debug("system", "Task run progress delete failed");
  }
}

export async function appendTaskRunSideEffects(
  runId: string,
  entries: DurableSideEffectInput[],
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await backendFetch(`/task-runs/${encodeURIComponent(runId)}/side-effects`, {
      method: "POST",
      body: JSON.stringify({ entries }),
    });
  } catch {
    logger.debug("system", "Task run side-effect sync failed");
  }
}

export async function listTaskRuns(options?: {
  workspaceId?: string;
  status?: DurableTaskRunStatus;
  limit?: number;
  includeCompleted?: boolean;
  includeProgressSummary?: boolean;
  controlRequested?: boolean;
}): Promise<DurableTaskRunSummary[]> {
  try {
    const params = new URLSearchParams();
    if (options?.workspaceId) params.set("workspace_id", options.workspaceId);
    if (options?.status) params.set("status", options.status);
    if (options?.limit != null) params.set("limit", String(options.limit));
    if (options?.includeCompleted) params.set("include_completed", "true");
    if (options?.includeProgressSummary) {
      params.set("include_progress_summary", "true");
    }
    if (options?.controlRequested) params.set("control_requested", "true");
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const res = await backendFetch(`/task-runs${suffix}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { runs: DurableTaskRunSummary[] };
    return data.runs ?? [];
  } catch {
    return [];
  }
}

export async function fetchTaskRunDetail(
  runId: string,
): Promise<DurableTaskRunDetailResponse | null> {
  try {
    const res = await backendFetch(`/task-runs/${encodeURIComponent(runId)}`);
    if (!res.ok) return null;
    return (await res.json()) as DurableTaskRunDetailResponse;
  } catch {
    return null;
  }
}

export async function fetchTaskRunResume(
  runId: string,
): Promise<DurableTaskRunResumeResponse | null> {
  try {
    const res = await backendFetch(`/task-runs/${encodeURIComponent(runId)}/resume`);
    if (!res.ok) return null;
    return (await res.json()) as DurableTaskRunResumeResponse;
  } catch {
    return null;
  }
}

export async function requestTaskRunResume(
  runId: string,
  reason?: string,
): Promise<DurableTaskRun | null> {
  try {
    const res = await backendFetch(`/task-runs/${encodeURIComponent(runId)}/resume`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? null }),
    });
    if (!res.ok) return null;
    return (await res.json()) as DurableTaskRun;
  } catch {
    return null;
  }
}

export async function requestTaskRunStop(
  runId: string,
  reason?: string,
): Promise<DurableTaskRun | null> {
  try {
    const res = await backendFetch(`/task-runs/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? null }),
    });
    if (!res.ok) return null;
    return (await res.json()) as DurableTaskRun;
  } catch {
    return null;
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
