/**
 * Backend Agent Service — shared types
 */

// Memory types (SQLite-backed)

export interface MemoryInput {
  category: MemoryCategory;
  title: string;
  content: string;
  workspaceId?: string;
  metadata?: MemoryMetadata;
}

export type MemoryMetadata = Record<string, unknown>;

export type MemoryCategory =
  | "execution-result"
  | "user-preference"
  | "site-knowledge"
  | "learned-pattern";

export interface MemoryResult {
  id: string;
  slug: string;
  title: string;
  category: MemoryCategory;
  content: string;
  score: number;
  metadata?: MemoryMetadata;
}

export interface MemoryListResult {
  id: string;
  slug: string;
  title: string;
  category: MemoryCategory;
  type: string;
}

// —— Profile types (filesystem-backed) ——

export type ProfileScalar = string | number | boolean | null;
export type ProfileValue =
  | ProfileScalar
  | ProfileScalar[]
  | Record<string, unknown>;

export interface PersonalProfileDocument {
  profile: Record<string, unknown>;
}

export interface ProfileResolveInput {
  fields: string[];
}

export interface ProfileResolveResult {
  profilePath: string;
  values: Record<string, ProfileValue>;
  missing: string[];
  sensitiveFields: string[];
}

// ── Task types (SQLite-backed) ──

export interface TaskInput {
  description: string;
  query: string;
  schedule?: string; // cron expression
  runAt?: number; // unix ms (for one-shot)
  tabUrl?: string;
  workspaceId?: string;
}

export interface ScheduledTask {
  id: string;
  description: string;
  query: string;
  tabUrl: string | null;
  workspaceId: string | null;
  schedule: string | null;
  runAt: number | null;
  status: TaskStatus;
  lastRunAt: number | null;
  result: string | null;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskPatch {
  status?: TaskStatus;
  result?: string;
}

// Durable task-run types (SQLite-backed)

export type TaskRunStatus =
  | "planning"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export interface TaskRunNodeCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface TaskRunProgressSummary {
  completedPhases: string[];
  outstandingQuestions: string[];
  reviewedItemCount?: number;
  extractedFactCount?: number;
}

export interface TaskRunCheckpointSummary {
  currentIndex: number;
  nodeCount: number;
  turnNumber: number | null;
  activeNodeId?: string | null;
  pageUrl?: string | null;
  snapshotFingerprint?: string | null;
  pendingInteractionKind?: "approval" | "clarification" | null;
}

export interface TaskRunInput {
  id: string;
  clientRunId?: string | null;
  workspaceId: string;
  query: string;
  rootTabId?: number | null;
  rootTabUrl?: string | null;
  turnNumber?: number | null;
  status: TaskRunStatus;
  startedAt?: number | null;
  finishedAt?: number | null;
  terminationReason?: string | null;
  checkpointSummary?: TaskRunCheckpointSummary | null;
  sessionMetrics?: Record<string, unknown> | null;
  budget?: Record<string, unknown> | null;
  resumeStateVersion?: number;
  nodeCounts?: TaskRunNodeCounts | null;
  resumeRequestedAt?: number | null;
  resumeRequestedReason?: string | null;
  stopRequestedAt?: number | null;
  stopRequestedReason?: string | null;
  lastResumeSource?: "local" | "backend" | null;
  lastKnownResumeSafe?: boolean | null;
  lastResumeSafetyCheckedAt?: number | null;
  lastKnownResumeReason?: string | null;
}

export interface TaskRun {
  id: string;
  clientRunId: string | null;
  workspaceId: string;
  query: string;
  rootTabId: number | null;
  rootTabUrl: string | null;
  turnNumber: number | null;
  status: TaskRunStatus;
  startedAt: number | null;
  finishedAt: number | null;
  terminationReason: string | null;
  checkpointSummary: TaskRunCheckpointSummary | null;
  sessionMetrics: Record<string, unknown> | null;
  budget: Record<string, unknown> | null;
  resumeStateVersion: number;
  nodeCounts: TaskRunNodeCounts | null;
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

export interface TaskRunSummary extends TaskRun {
  pendingInteraction: {
    kind: "approval" | "clarification";
    requestedAt: number;
    timeoutAt: number | null;
    active: boolean;
  } | null;
  progressSummary?: TaskRunProgressSummary;
}

export interface TaskRunNodeInput {
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

export interface TaskRunNode extends TaskRunNodeInput {
  runId: string;
  createdAt: number;
  updatedAt: number;
}

export type TaskRunProgressKind =
  | "reviewed-item-list"
  | "extracted-fact-map"
  | "completed-phase-list"
  | "outstanding-question-list";

export type TaskRunProgressFactValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[]
  | Record<string, unknown>;

export type TaskRunProgressInput =
  | {
      key: string;
      kind: "reviewed-item-list";
      payload: string[];
    }
  | {
      key: string;
      kind: "extracted-fact-map";
      payload: Record<string, TaskRunProgressFactValue>;
    }
  | {
      key: string;
      kind: "completed-phase-list";
      payload: string[];
    }
  | {
      key: string;
      kind: "outstanding-question-list";
      payload: string[];
    };

export type TaskRunProgress = TaskRunProgressInput & {
  runId: string;
  updatedAt: number;
};

export type PendingInteractionStatus =
  | "active"
  | "resolved"
  | "timed_out"
  | "cleared";

export interface PendingInteractionRecordInput {
  nodeId?: string | null;
  kind: "approval" | "clarification";
  payload: Record<string, unknown>;
  requestedAt: number;
  timeoutAt?: number | null;
  status: PendingInteractionStatus;
}

export interface PendingInteractionRecord extends PendingInteractionRecordInput {
  runId: string;
  updatedAt: number;
}

export interface SideEffectRecordInput {
  id: string;
  nodeId?: string | null;
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
  snapshotFingerprint?: string | null;
}

export interface SideEffectRecord extends SideEffectRecordInput {
  runId: string;
}

export interface TaskRunResumeResponse {
  run: TaskRun;
  nodes: TaskRunNode[];
  progress: TaskRunProgress[];
  pendingInteraction: PendingInteractionRecord | null;
  recentSideEffects: SideEffectRecord[];
}

export type TaskRunDetailResponse = TaskRunResumeResponse;

// ── Config ──

export interface BackendConfig {
  server: {
    port: number;
    host: string;
  };
  memory: {
    enabled: boolean;
    backend: "sqlite";
  };
  tasks: {
    databasePath: string;
    tickIntervalSeconds: number;
    maxConcurrent: number;
  };
}

// ── Health ──

export interface HealthResponse {
  status: "ok" | "degraded";
  uptime: number;
  memoryConnected: boolean;
  memoryBackend?: "sqlite";
  pendingTasks: number;
  memoryStats?: { pageCount: number };
}
