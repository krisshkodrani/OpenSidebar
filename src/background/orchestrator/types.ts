import { AgentLoop } from "../agent";
import { UserSettings } from "../../types";

export interface TaskNode {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  retries: number;
  result?: string;
  error?: string;
}

export interface OrchestratorTask {
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
  currentIndex: number;
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
