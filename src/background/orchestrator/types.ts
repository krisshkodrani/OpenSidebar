import { AgentLoop } from "../agent";
import {
  AgentRole,
  EscalationDecisionMessage,
  EscalationPacket,
  SessionMetrics,
  ToolName,
  UserSettings,
} from "../../types";

export interface PlannerAssignment {
  role: Extract<AgentRole, "executor">;
  objective: string;
  successCriteria: string;
  allowedTools: ToolName[];
  dependencies?: string[];
  assumptions?: string[];
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
    | "verifier_reroute";
  note: string;
  timestamp: number;
}

export interface TaskNode {
  id: string;
  role: Extract<AgentRole, "executor">;
  description: string;
  successCriteria: string;
  allowedTools: ToolName[];
  dependencies: string[];
  assumptions: string[];
  handoffArtifacts: NodeHandoffArtifact[];
  handoffDepth: number;
  handoffFromNodeId?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  retries: number;
  result?: string;
  error?: string;
}

export interface OrchestratorTask {
  runId?: string;
  id: string;
  workspaceId: string;
  rootTabId: number;
  query: string;
  status: "planning" | "running" | "completed" | "failed" | "stopped";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  nodes: TaskNode[];
  maxWorkers: number;
  maxReplans: number;
  replansUsed: number;
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
}

export interface OrchestratorCheckpoint {
  version: 1;
  savedAt: number;
  task: OrchestratorTask;
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
  groqApiKey?: string;
  cerebrasApiKey?: string;
}

export interface BufferedMemory {
  content: string;
  category: string;
  sourceUrl: string;
  createdAt: number;
}
