import { AgentLoop } from "../agent";
import type { Difficulty } from "../agent/constants";
import type { PendingUserInteraction } from "../agent/loop-types";
import type { TaskRunProgressInput } from "@shared-types/progress";
import {
  AgentRole,
  EvidenceEvent,
  EscalationDecisionMessage,
  EscalationPacket,
  SessionMetrics,
  ToolName,
  UserSettings,
} from "../../types";

export interface VerificationGate {
  trigger: string; // "text 'Code accepted' visible", "URL contains /step3"
  action: "call_done" | "advance_step" | "retry_step";
  maxRetries?: number;
  pattern?: string; // optional regex for precise matching
}

export interface PlannerAssignment {
  role: Extract<AgentRole, "executor">;
  objective: string;
  successCriteria: string;
  allowedTools: ToolName[];
  dependencies?: string[];
  assumptions?: string[];
  verificationGate?: VerificationGate;
}

export interface StructuredEvidence {
  event?: EvidenceEvent;
  claim?: string;
  basis?: "tool_output" | "observation" | "inference" | "user_input";
  confidence?: number;
  sourceToolCall?: string;
  turnNumber?: number;
}

export interface NodeHandoffArtifact {
  role: AgentRole;
  phase:
    | "planned"
    | "planner_replan"
    | "executor_started"
    | "executor_finished"
    | "verifier_accept"
    | "verifier_retry"
    | "verifier_reroute"
    | "verifier_advisory";
  note: string;
  timestamp: number;
  evidence?: StructuredEvidence[];
}

export interface PlannerReflexionEntry {
  nodeId: string;
  verifierDecision: "retry" | "reroute";
  failureType?: string;
  executorSummary: string;
  plannerLesson: string;
  timestamp: number;
}

export interface ReflexionEntry {
  attempt: number;
  executorSummary: string;
  verifierDecision: "retry" | "reroute";
  verifierReason: string;
  failureType?: string;
  confidence: number;
  suggestedApproach?: string;
  timestamp: number;
}

export interface TaskNode {
  id: string;
  role: Extract<AgentRole, "executor">;
  description: string;
  successCriteria: string;
  selectedSkillId?: string;
  selectedSkillReason?: string;
  allowedTools: ToolName[];
  dependencies: string[];
  assumptions: string[];
  handoffArtifacts: NodeHandoffArtifact[];
  reflexionLog: ReflexionEntry[];
  handoffDepth: number;
  handoffFromNodeId?: string;
  verificationGate?: VerificationGate;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  retries: number;
  result?: string;
  error?: string;
  /** Condensed action history from the executor for same-tab handoff */
  trajectory?: string[];
}

export interface BuildNodesResult {
  nodes: TaskNode[];
  isSingleNode: boolean;
  difficulty: Difficulty;
}

export type TaskTabRole = "primary" | "auxiliary" | "comparison";

export interface TaskOwnedTab {
  tabId: number;
  role: TaskTabRole;
  createdByTask: boolean;
  lastKnownUrl?: string | null;
  claimedAt: number;
  lastUsedAt: number;
  releasedAt?: number | null;
}

export interface TaskTabCoordination {
  primaryTabId: number;
  ownedTabs: TaskOwnedTab[];
  nodeBindings: Record<string, number>;
  lastReboundTabId?: number | null;
}

export interface OrchestratorTask {
  runId?: string;
  id: string;
  workspaceId: string;
  rootTabId: number;
  rootTabUrl?: string | null;
  query: string;
  turnNumber?: number;
  status:
    | "planning"
    | "running"
    | "stopping"
    | "completed"
    | "failed"
    | "stopped";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  nodes: TaskNode[];
  plannerReflexionLog: PlannerReflexionEntry[];
  maxWorkers: number;
  maxReplans: number;
  replansUsed: number;
  horizonExpansions: number;
  currentIndex: number;
  sessionMetrics: SessionMetrics;
  budget: {
    maxSessionTimeMs: number;
    maxTotalTokens: number;
    maxTotalCostUsd: number;
  };
  terminationReason?: string;
  pendingEscalation?: {
    packet: EscalationPacket;
    selectedOption?: EscalationDecisionMessage["payload"];
  };
  pendingInteraction?: PendingUserInteraction;
  durableMeta?: {
    lastResumeSource?: "local" | "backend" | null;
    lastKnownResumeSafe?: boolean | null;
    lastResumeSafetyCheckedAt?: number | null;
    lastKnownResumeReason?: string | null;
    resumeRequestedAt?: number | null;
    resumeRequestedReason?: string | null;
    stopRequestedAt?: number | null;
    stopRequestedReason?: string | null;
  };
  planClassification?: {
    isSingleNode: boolean;
    difficulty: Difficulty;
  };
  /** Internal: tracks whether onStreamChunk forwarded non-empty content (for dedup) */
  _streamHasContent?: boolean;
  /** Tab IDs created by the orchestrator for worker nodes (cleaned up on task end) */
  createdWorkerTabIds?: number[];
  /** Explicit task-owned tab roles, bindings, and rebound metadata */
  tabCoordination?: TaskTabCoordination;
  /** Task-relevant, user-authored non-secret profile context */
  personalContextBrief?: string;
  structuredProgress?: Record<string, TaskRunProgressInput>;
}

export interface OrchestratorCheckpoint {
  version: 1;
  savedAt: number;
  task: OrchestratorTask;
  pendingFeedback?: string[];
}

export interface WorkerInstance {
  workerId: string;
  nodeId: string;
  tabId: number;
  loop: AgentLoop;
}

export interface OrchestratorStartInput {
  query: string;
  tabId: number;
  workspaceId: string;
  settings: UserSettings;
  openRouterApiKey: string;
}
