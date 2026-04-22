import { getDatabase } from "../db.js";
import type {
  PendingInteractionRecord,
  PendingInteractionRecordInput,
  SideEffectRecord,
  SideEffectRecordInput,
  TaskRun,
  TaskRunDetailResponse,
  TaskRunCheckpointSummary,
  TaskRunInput,
  TaskRunNodeCounts,
  TaskRunNode,
  TaskRunNodeInput,
  TaskRunProgress,
  TaskRunProgressFactValue,
  TaskRunProgressKind,
  TaskRunProgressSummary,
  TaskRunProgressInput,
  TaskRunResumeResponse,
  TaskRunSummary,
  TaskRunStatus,
} from "../types.js";

const RESUME_SIDE_EFFECT_LIMIT = 50;
const SIDE_EFFECT_RETENTION_LIMIT = 50;
const CANONICAL_PROGRESS_KINDS: TaskRunProgressKind[] = [
  "reviewed-item-list",
  "extracted-fact-map",
  "completed-phase-list",
  "outstanding-question-list",
];

interface TaskRunRow {
  id: string;
  client_run_id: string | null;
  workspace_id: string;
  query: string;
  root_tab_id: number | null;
  root_tab_url: string | null;
  turn_number: number | null;
  status: TaskRunStatus;
  started_at: number | null;
  finished_at: number | null;
  termination_reason: string | null;
  checkpoint_summary_json: string | null;
  session_metrics_json: string | null;
  budget_json: string | null;
  resume_state_version: number;
  node_counts_json: string | null;
  resume_requested_at: number | null;
  resume_requested_reason: string | null;
  stop_requested_at: number | null;
  stop_requested_reason: string | null;
  last_resume_source: "local" | "backend" | null;
  last_known_resume_safe: number | null;
  last_resume_safety_checked_at: number | null;
  last_known_resume_reason: string | null;
  created_at: number;
  updated_at: number;
}

interface TaskRunNodeRow {
  run_id: string;
  node_id: string;
  description: string;
  success_criteria: string;
  selected_skill_id: string | null;
  selected_skill_reason: string | null;
  allowed_tools_json: string;
  dependencies_json: string;
  assumptions_json: string;
  verification_gate_json: string | null;
  handoff_artifacts_json: string;
  reflexion_log_json: string;
  handoff_depth: number;
  handoff_from_node_id: string | null;
  trajectory_json: string | null;
  status: string;
  retries: number;
  result: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface TaskRunProgressRow {
  run_id: string;
  key: string;
  kind: string;
  payload_json: string;
  updated_at: number;
}

interface PendingInteractionRow {
  run_id: string;
  node_id: string | null;
  kind: "approval" | "clarification";
  payload_json: string;
  requested_at: number;
  timeout_at: number | null;
  status: PendingInteractionRecord["status"];
  updated_at: number;
}

interface SideEffectRow {
  id: string;
  run_id: string;
  node_id: string | null;
  tool_name: string;
  args_json: string;
  result: string;
  timestamp: number;
  snapshot_fingerprint: string | null;
}

export class InvalidTaskRunProgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskRunProgressError";
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeStoredTaskRunProgressRow(row: TaskRunProgressRow): TaskRunProgressInput {
  const payload = parseJson(row.payload_json, null);
  if (row.kind === "completed-phase" && typeof payload === "string") {
    return {
      key: row.key,
      kind: "completed-phase-list",
      payload: [payload],
    };
  }
  if (row.kind === "outstanding-question" && typeof payload === "string") {
    return {
      key: row.key,
      kind: "outstanding-question-list",
      payload: [payload],
    };
  }
  return normalizeTaskRunProgressInput({
    key: row.key,
    kind: row.kind,
    payload,
  });
}

function rowToTaskRun(row: TaskRunRow): TaskRun {
  return {
    id: row.id,
    clientRunId: row.client_run_id,
    workspaceId: row.workspace_id,
    query: row.query,
    rootTabId: row.root_tab_id,
    rootTabUrl: row.root_tab_url,
    turnNumber: row.turn_number,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    terminationReason: row.termination_reason,
    checkpointSummary: parseJson<TaskRunCheckpointSummary | null>(
      row.checkpoint_summary_json,
      null,
    ),
    sessionMetrics: parseJson<Record<string, unknown> | null>(
      row.session_metrics_json,
      null,
    ),
    budget: parseJson<Record<string, unknown> | null>(row.budget_json, null),
    resumeStateVersion: row.resume_state_version,
    nodeCounts: parseJson<TaskRunNodeCounts | null>(row.node_counts_json, null),
    resumeRequestedAt: row.resume_requested_at,
    resumeRequestedReason: row.resume_requested_reason,
    stopRequestedAt: row.stop_requested_at,
    stopRequestedReason: row.stop_requested_reason,
    lastResumeSource: row.last_resume_source,
    lastKnownResumeSafe:
      row.last_known_resume_safe == null
        ? null
        : Boolean(row.last_known_resume_safe),
    lastResumeSafetyCheckedAt: row.last_resume_safety_checked_at,
    lastKnownResumeReason: row.last_known_resume_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTaskRunNode(row: TaskRunNodeRow): TaskRunNode {
  return {
    runId: row.run_id,
    nodeId: row.node_id,
    description: row.description,
    successCriteria: row.success_criteria,
    selectedSkillId: row.selected_skill_id,
    selectedSkillReason: row.selected_skill_reason,
    allowedTools: parseJson<string[]>(row.allowed_tools_json, []),
    dependencies: parseJson<string[]>(row.dependencies_json, []),
    assumptions: parseJson<string[]>(row.assumptions_json, []),
    verificationGate: parseJson<Record<string, unknown> | null>(
      row.verification_gate_json,
      null,
    ),
    handoffArtifacts: parseJson<unknown[]>(row.handoff_artifacts_json, []),
    reflexionLog: parseJson<unknown[]>(row.reflexion_log_json, []),
    handoffDepth: row.handoff_depth,
    handoffFromNodeId: row.handoff_from_node_id,
    trajectory: parseJson<string[] | null>(row.trajectory_json, null),
    status: row.status,
    retries: row.retries,
    result: row.result,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTaskRunProgress(row: TaskRunProgressRow): TaskRunProgress {
  const normalized = normalizeStoredTaskRunProgressRow(row);
  switch (normalized.kind) {
    case "reviewed-item-list":
    case "completed-phase-list":
    case "outstanding-question-list":
      return {
        runId: row.run_id,
        key: normalized.key,
        kind: normalized.kind,
        payload: normalized.payload,
        updatedAt: row.updated_at,
      };
    case "extracted-fact-map":
      return {
        runId: row.run_id,
        key: normalized.key,
        kind: normalized.kind,
        payload: normalized.payload,
        updatedAt: row.updated_at,
      };
  }
}

function rowToPendingInteraction(
  row: PendingInteractionRow,
): PendingInteractionRecord {
  return {
    runId: row.run_id,
    nodeId: row.node_id,
    kind: row.kind,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    requestedAt: row.requested_at,
    timeoutAt: row.timeout_at,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function rowToSideEffect(row: SideEffectRow): SideEffectRecord {
  return {
    id: row.id,
    runId: row.run_id,
    nodeId: row.node_id,
    toolName: row.tool_name,
    args: parseJson<Record<string, unknown>>(row.args_json, {}),
    result: row.result,
    timestamp: row.timestamp,
    snapshotFingerprint: row.snapshot_fingerprint,
  };
}

function emptyNodeCounts(): TaskRunNodeCounts {
  return {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };
}

function isCanonicalTaskRunProgressKind(
  value: unknown,
): value is TaskRunProgressKind {
  return (
    typeof value === "string" &&
    CANONICAL_PROGRESS_KINDS.includes(value as TaskRunProgressKind)
  );
}

function isPlainObject(
  value: unknown,
): value is Record<string, TaskRunProgressFactValue> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      next.push(value);
    }
  }
  return next;
}

function normalizeTaskRunProgressInput(input: {
  key: unknown;
  kind: unknown;
  payload: unknown;
}): TaskRunProgressInput {
  if (typeof input.key !== "string" || input.key.trim().length === 0) {
    throw new InvalidTaskRunProgressError("Progress key must be a non-empty string");
  }
  if (!isCanonicalTaskRunProgressKind(input.kind)) {
    throw new InvalidTaskRunProgressError(
      `Progress kind must be one of: ${CANONICAL_PROGRESS_KINDS.join(", ")}`,
    );
  }

  const key = input.key.trim();

  switch (input.kind) {
    case "reviewed-item-list":
    case "completed-phase-list":
    case "outstanding-question-list": {
      if (
        !Array.isArray(input.payload) ||
        !input.payload.every((value) => typeof value === "string")
      ) {
        throw new InvalidTaskRunProgressError(
          `Progress payload for ${input.kind} must be a string array`,
        );
      }
      return {
        key,
        kind: input.kind,
        payload: dedupeStrings(input.payload),
      };
    }
    case "extracted-fact-map": {
      if (!isPlainObject(input.payload)) {
        throw new InvalidTaskRunProgressError(
          "Progress payload for extracted-fact-map must be an object",
        );
      }
      return {
        key,
        kind: input.kind,
        payload: input.payload,
      };
    }
  }
}

function mergeTaskRunProgress(
  existing: TaskRunProgress | null,
  next: TaskRunProgressInput,
): TaskRunProgressInput {
  if (!existing) return next;
  if (existing.kind !== next.kind) {
    throw new InvalidTaskRunProgressError(
      `Progress key ${next.key} already exists with kind ${existing.kind}`,
    );
  }

  switch (next.kind) {
    case "reviewed-item-list":
    case "completed-phase-list":
    case "outstanding-question-list":
      return {
        key: next.key,
        kind: next.kind,
        payload: dedupeStrings([
          ...(existing.payload as string[]),
          ...next.payload,
        ]),
      };
    case "extracted-fact-map":
      return {
        key: next.key,
        kind: next.kind,
        payload: {
          ...(existing.payload as Record<string, TaskRunProgressFactValue>),
          ...next.payload,
        },
      };
  }
}

function summarizeProgress(progress: TaskRunProgress[]): TaskRunProgressSummary {
  const summary: TaskRunProgressSummary = {
    completedPhases: [],
    outstandingQuestions: [],
  };
  for (const entry of progress) {
    if (entry.kind === "completed-phase-list") {
      summary.completedPhases.push(...entry.payload);
      continue;
    }
    if (entry.kind === "outstanding-question-list") {
      summary.outstandingQuestions.push(...entry.payload);
      continue;
    }
    if (entry.kind === "reviewed-item-list") {
      summary.reviewedItemCount =
        (summary.reviewedItemCount ?? 0) + entry.payload.length;
      continue;
    }
    summary.extractedFactCount =
      (summary.extractedFactCount ?? 0) + Object.keys(entry.payload).length;
  }
  summary.completedPhases = dedupeStrings(summary.completedPhases);
  summary.outstandingQuestions = dedupeStrings(summary.outstandingQuestions);
  return summary;
}

function summarizePendingInteraction(
  interaction: PendingInteractionRecord | null,
): TaskRunSummary["pendingInteraction"] {
  if (!interaction) return null;
  return {
    kind: interaction.kind,
    requestedAt: interaction.requestedAt,
    timeoutAt: interaction.timeoutAt ?? null,
    active: interaction.status === "active",
  };
}

function recomputeNodeCounts(runId: string): TaskRunNodeCounts {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT status, COUNT(*) AS count FROM task_run_nodes WHERE run_id = ? GROUP BY status",
    )
    .all(runId) as Array<{ status: string; count: number }>;
  const counts = emptyNodeCounts();
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status as keyof TaskRunNodeCounts] = row.count;
    }
  }
  return counts;
}

function persistNodeCounts(runId: string): TaskRunNodeCounts {
  const db = getDatabase();
  const counts = recomputeNodeCounts(runId);
  db.prepare(
    "UPDATE task_runs SET node_counts_json = ?, updated_at = ? WHERE id = ?",
  ).run(JSON.stringify(counts), Date.now(), runId);
  return counts;
}

export function upsertTaskRun(input: TaskRunInput): TaskRun {
  const db = getDatabase();
  const now = Date.now();
  const existing = db
    .prepare("SELECT * FROM task_runs WHERE id = ?")
    .get(input.id) as TaskRunRow | undefined;

  const createdAt = existing?.created_at ?? now;
  db.prepare(`
    INSERT INTO task_runs (
      id, client_run_id, workspace_id, query, root_tab_id, root_tab_url, turn_number,
      status, started_at, finished_at, termination_reason, checkpoint_summary_json,
      session_metrics_json, budget_json, resume_state_version, node_counts_json,
      resume_requested_at, resume_requested_reason, stop_requested_at, stop_requested_reason,
      last_resume_source, last_known_resume_safe, last_resume_safety_checked_at,
      last_known_resume_reason, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      client_run_id = excluded.client_run_id,
      workspace_id = excluded.workspace_id,
      query = excluded.query,
      root_tab_id = excluded.root_tab_id,
      root_tab_url = excluded.root_tab_url,
      turn_number = excluded.turn_number,
      status = excluded.status,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      termination_reason = excluded.termination_reason,
      checkpoint_summary_json = excluded.checkpoint_summary_json,
      session_metrics_json = excluded.session_metrics_json,
      budget_json = excluded.budget_json,
      resume_state_version = excluded.resume_state_version,
      node_counts_json = excluded.node_counts_json,
      resume_requested_at = excluded.resume_requested_at,
      resume_requested_reason = excluded.resume_requested_reason,
      stop_requested_at = excluded.stop_requested_at,
      stop_requested_reason = excluded.stop_requested_reason,
      last_resume_source = excluded.last_resume_source,
      last_known_resume_safe = excluded.last_known_resume_safe,
      last_resume_safety_checked_at = excluded.last_resume_safety_checked_at,
      last_known_resume_reason = excluded.last_known_resume_reason,
      updated_at = excluded.updated_at
  `).run(
    input.id,
    input.clientRunId ?? null,
    input.workspaceId,
    input.query,
    input.rootTabId ?? null,
    input.rootTabUrl ?? null,
    input.turnNumber ?? null,
    input.status,
    input.startedAt ?? null,
    input.finishedAt ?? null,
    input.terminationReason ?? null,
    input.checkpointSummary ? JSON.stringify(input.checkpointSummary) : null,
    input.sessionMetrics ? JSON.stringify(input.sessionMetrics) : null,
    input.budget ? JSON.stringify(input.budget) : null,
    input.resumeStateVersion ?? 1,
    input.nodeCounts ? JSON.stringify(input.nodeCounts) : null,
    input.resumeRequestedAt ?? null,
    input.resumeRequestedReason ?? null,
    input.stopRequestedAt ?? null,
    input.stopRequestedReason ?? null,
    input.lastResumeSource ?? null,
    input.lastKnownResumeSafe == null ? null : input.lastKnownResumeSafe ? 1 : 0,
    input.lastResumeSafetyCheckedAt ?? null,
    input.lastKnownResumeReason ?? null,
    createdAt,
    now,
  );

  return getTaskRun(input.id)!;
}

export function listTaskRuns(options?: {
  workspaceId?: string;
  status?: TaskRunStatus;
  limit?: number;
  includeCompleted?: boolean;
  includeProgressSummary?: boolean;
  controlRequested?: boolean;
}): TaskRunSummary[] {
  const db = getDatabase();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options?.workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(options.workspaceId);
  }
  if (options?.status) {
    clauses.push("status = ?");
    params.push(options.status);
  } else if (!options?.includeCompleted) {
    clauses.push("status NOT IN ('completed', 'stopped')");
  }
  if (options?.controlRequested) {
    clauses.push(
      "(resume_requested_at IS NOT NULL OR stop_requested_at IS NOT NULL)",
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options?.limit ?? 50;

  const rows = db
    .prepare(`SELECT * FROM task_runs ${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...params, limit) as TaskRunRow[];
  return rows.map((row) => {
    const run = rowToTaskRun(row);
    const interaction = getTaskRunPendingInteraction(run.id);
    const progress = options?.includeProgressSummary
      ? getTaskRunProgress(run.id)
      : [];
    return {
      ...run,
      pendingInteraction: summarizePendingInteraction(interaction),
      ...(options?.includeProgressSummary
        ? { progressSummary: summarizeProgress(progress) }
        : {}),
    };
  });
}

export function getTaskRun(id: string): TaskRun | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM task_runs WHERE id = ?")
    .get(id) as TaskRunRow | undefined;
  return row ? rowToTaskRun(row) : null;
}

export function patchTaskRun(
  id: string,
  patch: Partial<Omit<TaskRunInput, "id" | "workspaceId" | "query">> & {
    workspaceId?: string;
    query?: string;
  },
): TaskRun | null {
  const existing = getTaskRun(id);
  if (!existing) return null;

  return upsertTaskRun({
    id,
    clientRunId: patch.clientRunId ?? existing.clientRunId,
    workspaceId: patch.workspaceId ?? existing.workspaceId,
    query: patch.query ?? existing.query,
    rootTabId: patch.rootTabId ?? existing.rootTabId,
    rootTabUrl: patch.rootTabUrl ?? existing.rootTabUrl,
    turnNumber: patch.turnNumber ?? existing.turnNumber,
    status: patch.status ?? existing.status,
    startedAt: patch.startedAt ?? existing.startedAt,
    finishedAt: patch.finishedAt ?? existing.finishedAt,
    terminationReason: patch.terminationReason ?? existing.terminationReason,
    checkpointSummary: patch.checkpointSummary ?? existing.checkpointSummary,
    sessionMetrics: patch.sessionMetrics ?? existing.sessionMetrics,
    budget: patch.budget ?? existing.budget,
    resumeStateVersion: patch.resumeStateVersion ?? existing.resumeStateVersion,
    nodeCounts: patch.nodeCounts ?? existing.nodeCounts,
    resumeRequestedAt: patch.resumeRequestedAt ?? existing.resumeRequestedAt,
    resumeRequestedReason:
      patch.resumeRequestedReason ?? existing.resumeRequestedReason,
    stopRequestedAt: patch.stopRequestedAt ?? existing.stopRequestedAt,
    stopRequestedReason:
      patch.stopRequestedReason ?? existing.stopRequestedReason,
    lastResumeSource: patch.lastResumeSource ?? existing.lastResumeSource,
    lastKnownResumeSafe:
      patch.lastKnownResumeSafe ?? existing.lastKnownResumeSafe,
    lastResumeSafetyCheckedAt:
      patch.lastResumeSafetyCheckedAt ?? existing.lastResumeSafetyCheckedAt,
    lastKnownResumeReason:
      patch.lastKnownResumeReason ?? existing.lastKnownResumeReason,
  });
}

export function requestTaskRunResume(
  id: string,
  reason?: string | null,
): TaskRun | null {
  const run = getTaskRun(id);
  if (!run) return null;
  return patchTaskRun(id, {
    resumeRequestedAt: Date.now(),
    resumeRequestedReason: reason ?? null,
  });
}

export function requestTaskRunStop(
  id: string,
  reason?: string | null,
): TaskRun | null {
  const run = getTaskRun(id);
  if (!run) return null;
  return patchTaskRun(id, {
    stopRequestedAt: Date.now(),
    stopRequestedReason: reason ?? null,
  });
}

export function clearTaskRunControls(
  id: string,
  fields: { resume?: boolean; stop?: boolean },
): TaskRun | null {
  const run = getTaskRun(id);
  if (!run) return null;
  return patchTaskRun(id, {
    ...(fields.resume
      ? { resumeRequestedAt: null, resumeRequestedReason: null }
      : {}),
    ...(fields.stop ? { stopRequestedAt: null, stopRequestedReason: null } : {}),
  });
}

export function getTaskRunDetail(id: string): TaskRunDetailResponse | null {
  const run = getTaskRun(id);
  if (!run) return null;
  return {
    run,
    nodes: getTaskRunNodes(id),
    progress: getTaskRunProgress(id),
    pendingInteraction: getTaskRunPendingInteraction(id),
    recentSideEffects: getTaskRunSideEffects(id, RESUME_SIDE_EFFECT_LIMIT),
  };
}

export function updateTaskRunCheckpoint(
  id: string,
  checkpointSummary: TaskRunCheckpointSummary | null,
): TaskRun | null {
  const db = getDatabase();
  const changes = db
    .prepare(`
      UPDATE task_runs
      SET checkpoint_summary_json = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(
      checkpointSummary ? JSON.stringify(checkpointSummary) : null,
      Date.now(),
      id,
    );
  return changes.changes > 0 ? getTaskRun(id) : null;
}

export function upsertTaskRunNode(
  runId: string,
  input: TaskRunNodeInput,
): TaskRunNode {
  const db = getDatabase();
  const now = Date.now();
  const existing = db
    .prepare("SELECT created_at FROM task_run_nodes WHERE run_id = ? AND node_id = ?")
    .get(runId, input.nodeId) as { created_at: number } | undefined;
  const createdAt = existing?.created_at ?? now;

  db.prepare(`
    INSERT INTO task_run_nodes (
      run_id, node_id, description, success_criteria, selected_skill_id,
      selected_skill_reason, allowed_tools_json, dependencies_json, assumptions_json,
      verification_gate_json, handoff_artifacts_json, reflexion_log_json, handoff_depth,
      handoff_from_node_id, trajectory_json, status, retries, result, error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, node_id) DO UPDATE SET
      description = excluded.description,
      success_criteria = excluded.success_criteria,
      selected_skill_id = excluded.selected_skill_id,
      selected_skill_reason = excluded.selected_skill_reason,
      allowed_tools_json = excluded.allowed_tools_json,
      dependencies_json = excluded.dependencies_json,
      assumptions_json = excluded.assumptions_json,
      verification_gate_json = excluded.verification_gate_json,
      handoff_artifacts_json = excluded.handoff_artifacts_json,
      reflexion_log_json = excluded.reflexion_log_json,
      handoff_depth = excluded.handoff_depth,
      handoff_from_node_id = excluded.handoff_from_node_id,
      trajectory_json = excluded.trajectory_json,
      status = excluded.status,
      retries = excluded.retries,
      result = excluded.result,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(
    runId,
    input.nodeId,
    input.description,
    input.successCriteria,
    input.selectedSkillId ?? null,
    input.selectedSkillReason ?? null,
    JSON.stringify(input.allowedTools),
    JSON.stringify(input.dependencies),
    JSON.stringify(input.assumptions),
    input.verificationGate ? JSON.stringify(input.verificationGate) : null,
    JSON.stringify(input.handoffArtifacts),
    JSON.stringify(input.reflexionLog),
    input.handoffDepth,
    input.handoffFromNodeId ?? null,
    input.trajectory ? JSON.stringify(input.trajectory) : null,
    input.status,
    input.retries,
    input.result ?? null,
    input.error ?? null,
    createdAt,
    now,
  );
  persistNodeCounts(runId);

  return getTaskRunNodes(runId).find((node) => node.nodeId === input.nodeId)!;
}

export function getTaskRunNodes(runId: string): TaskRunNode[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT * FROM task_run_nodes WHERE run_id = ? ORDER BY created_at ASC, node_id ASC",
    )
    .all(runId) as TaskRunNodeRow[];
  return rows.map(rowToTaskRunNode);
}

export function upsertTaskRunProgress(
  runId: string,
  input: {
    key: unknown;
    kind: unknown;
    payload: unknown;
  },
): TaskRunProgress {
  const db = getDatabase();
  const now = Date.now();
  const normalized = normalizeTaskRunProgressInput(input);
  const existing = getTaskRunProgress(runId).find(
    (entry) => entry.key === normalized.key,
  ) ?? null;
  const merged = mergeTaskRunProgress(existing, normalized);
  db.prepare(`
    INSERT INTO task_run_progress (run_id, key, kind, payload_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(run_id, key) DO UPDATE SET
      kind = excluded.kind,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run(runId, merged.key, merged.kind, JSON.stringify(merged.payload), now);

  return getTaskRunProgress(runId).find((entry) => entry.key === merged.key)!;
}

export function getTaskRunProgress(runId: string): TaskRunProgress[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM task_run_progress WHERE run_id = ? ORDER BY key ASC")
    .all(runId) as TaskRunProgressRow[];
  return rows.map(rowToTaskRunProgress);
}

export function deleteTaskRunProgress(runId: string, key: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM task_run_progress WHERE run_id = ? AND key = ?")
    .run(runId, key);
  return result.changes > 0;
}

export function setTaskRunPendingInteraction(
  runId: string,
  input: PendingInteractionRecordInput | null,
): PendingInteractionRecord | null {
  const db = getDatabase();
  const now = Date.now();

  if (!input) {
    db.prepare("DELETE FROM task_run_pending_interactions WHERE run_id = ?").run(
      runId,
    );
    return null;
  }

  db.prepare(`
    INSERT INTO task_run_pending_interactions (
      run_id, node_id, kind, payload_json, requested_at, timeout_at, status, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      node_id = excluded.node_id,
      kind = excluded.kind,
      payload_json = excluded.payload_json,
      requested_at = excluded.requested_at,
      timeout_at = excluded.timeout_at,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    runId,
    input.nodeId ?? null,
    input.kind,
    JSON.stringify(input.payload),
    input.requestedAt,
    input.timeoutAt ?? null,
    input.status,
    now,
  );

  return getTaskRunPendingInteraction(runId);
}

export function getTaskRunPendingInteraction(
  runId: string,
): PendingInteractionRecord | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM task_run_pending_interactions WHERE run_id = ?")
    .get(runId) as PendingInteractionRow | undefined;
  return row ? rowToPendingInteraction(row) : null;
}

export function appendTaskRunSideEffects(
  runId: string,
  entries: SideEffectRecordInput[],
): SideEffectRecord[] {
  const db = getDatabase();
  const tx = db.transaction((items: SideEffectRecordInput[]) => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO task_run_side_effects (
        id, run_id, node_id, tool_name, args_json, result, timestamp, snapshot_fingerprint
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const trim = db.prepare(`
      DELETE FROM task_run_side_effects
      WHERE run_id = ?
        AND id NOT IN (
          SELECT id FROM task_run_side_effects
          WHERE run_id = ?
          ORDER BY timestamp DESC, id DESC
          LIMIT ?
        )
    `);

    for (const item of items) {
      insert.run(
        item.id,
        runId,
        item.nodeId ?? null,
        item.toolName,
        JSON.stringify(item.args),
        item.result,
        item.timestamp,
        item.snapshotFingerprint ?? null,
      );
    }
    trim.run(runId, runId, SIDE_EFFECT_RETENTION_LIMIT);
  });

  tx(entries);
  return getTaskRunSideEffects(runId, RESUME_SIDE_EFFECT_LIMIT);
}

export function getTaskRunSideEffects(
  runId: string,
  limit = RESUME_SIDE_EFFECT_LIMIT,
): SideEffectRecord[] {
  const db = getDatabase();
  const rows = db
    .prepare(`
      SELECT * FROM task_run_side_effects
      WHERE run_id = ?
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `)
    .all(runId, limit) as SideEffectRow[];
  return rows.map(rowToSideEffect);
}

export function getTaskRunResume(id: string): TaskRunResumeResponse | null {
  return getTaskRunDetail(id);
}
