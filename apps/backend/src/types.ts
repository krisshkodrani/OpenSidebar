/**
 * Backend Agent Service — shared types
 */

// —— Profile types (filesystem-backed) ——

export type ProfileScalar = string | number | boolean | null;
export type ProfileObject = Record<string, unknown>;
export type ProfileValue =
  | ProfileScalar
  | ProfileScalar[]
  | ProfileObject
  | ProfileObject[];

export interface PersonalProfileDocument {
  profile: Record<string, unknown>;
}

// `/profile/resolve` and `/profile/context` (and their result types) were
// removed in RFC LP-8, M1 — no extension callers. Only file-alias resolution
// remains.

export interface ProfileFileResolveInput {
  alias: string;
}

export interface ProfileFileResolveResult {
  profilePath: string;
  alias: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  data: string;
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
  storage: {
    databasePath: string;
  };
}

// ── Health ──

export interface HealthResponse {
  status: "ok" | "degraded";
  uptime: number;
  pendingTasks: number;
}
