import { logger } from "../../utils";
import type { AgentLoop } from "../agent";
import type { WorkspaceLanePools } from "./lane-types";
import { buildParallelRunState } from "./plan-state";
import { appendHandoffArtifact } from "./task-messaging";
import type { OrchestratorTask, TaskNode } from "./types";
import { currentIndex } from "./utils";

type EmitTrace = (type: string, data: Record<string, unknown>) => void;

export async function startWorkerNode(input: {
  task: OrchestratorTask;
  node: TaskNode;
  emitTrace: EmitTrace;
  sendProgress: () => void;
  persistTaskCheckpoint: () => Promise<void>;
}): Promise<void> {
  const { task, node, emitTrace, sendProgress, persistTaskCheckpoint } = input;
  node.status = "running";
  emitTrace("node_started", {
    nodeId: node.id,
    selectedSkillId: node.selectedSkillId,
    selectedSkillReason: node.selectedSkillReason,
    retries: node.retries,
    handoffDepth: node.handoffDepth,
    hasReflexion: node.reflexionLog.length > 0,
    dependencyCount: node.dependencies.length,
  });
  appendHandoffArtifact(node, {
    role: "executor",
    phase: "executor_started",
    note: `Executor started objective: ${node.description}`,
  });
  task.currentIndex = currentIndex(task.nodes);
  sendProgress();
  await persistTaskCheckpoint();
}

export function registerWorker(input: {
  task: OrchestratorTask;
  node: TaskNode;
  workerId: string;
  tabId: number;
  loop: AgentLoop;
  getWorkspaceLanePools: () => WorkspaceLanePools;
  drainPendingFeedback: () => void;
}): void {
  const {
    task, node, workerId, tabId, loop, getWorkspaceLanePools,
    drainPendingFeedback,
  } = input;
  const wsPools = getWorkspaceLanePools();
  wsPools.executor.set(workerId, { workerId, nodeId: node.id, tabId, loop });
  drainPendingFeedback();
  logger.debug("orchestrator", "Executor worker registered in lane pool", {
    taskId: task.id,
    workspaceId: task.workspaceId,
    workerId,
    nodeId: node.id,
    lane: "executor",
    activeExecutorWorkers: wsPools.executor.size,
  });
}

export async function releaseWorker(input: {
  task: OrchestratorTask;
  node: TaskNode;
  workerId: string;
  nodeStartMs: number;
  getWorkspaceLanePools: () => WorkspaceLanePools;
  emitTrace: EmitTrace;
  sendProgress: () => void;
  persistTaskCheckpoint: () => Promise<void>;
}): Promise<void> {
  const {
    task, node, workerId, nodeStartMs, getWorkspaceLanePools,
    emitTrace, sendProgress, persistTaskCheckpoint,
  } = input;
  emitTrace("node_completed", {
    nodeId: node.id,
    outcome: node.status,
    summary: (node.result || node.error || "").slice(0, 300),
    retries: node.retries,
    durationMs: Date.now() - nodeStartMs,
    ...buildParallelRunState(task),
  });
  emitTrace("worker_released_resource", {
    taskId: task.id,
    nodeId: node.id,
    workerId,
    resources: node.parallelContract?.resourceHints ?? [],
    outcome: node.status,
    ...buildParallelRunState(task),
  });
  const wsPools = getWorkspaceLanePools();
  wsPools.executor.delete(workerId);
  logger.debug("orchestrator", "Executor worker released from lane pool", {
    taskId: task.id,
    workspaceId: task.workspaceId,
    workerId,
    nodeId: node.id,
    lane: "executor",
    activeExecutorWorkers: wsPools.executor.size,
  });
  task.currentIndex = currentIndex(task.nodes);
  sendProgress();
  await persistTaskCheckpoint();
}
