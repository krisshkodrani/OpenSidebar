import { logger } from "../../utils";
import type { OrchestratorTask, TaskNode } from "./types";
import type { LaneRuntimeState } from "./lane-types";
import {
  getDependencyState,
  getResourceBlockedPendingNodes,
  getRunnablePendingNodes,
} from "./scheduling";
import {
  resolveExecutorNodeConcurrency,
  resolveLaneTopology,
} from "./lane-topology";
import { isLaneIsolated } from "./lane-supervisor";
import { buildParallelRunState } from "./plan-state";

type EmitTrace = (type: string, data: Record<string, unknown>) => void;

export function collectSchedulerCycle(input: {
  task: OrchestratorTask;
  runningCount: number;
  blockedResourceTraceKeys: Set<string>;
  getExecutorMaxConcurrent: () => number;
  emitTrace: EmitTrace;
}): { runnable: TaskNode[]; schedulerConcurrency: number } {
  const {
    task, runningCount, blockedResourceTraceKeys, getExecutorMaxConcurrent,
    emitTrace,
  } = input;
  const runningNodes = task.nodes.filter((node) => node.status === "running");
  const resourceBlocked = getResourceBlockedPendingNodes(
    task.nodes,
    runningNodes,
  );
  for (const blocked of resourceBlocked) {
    const key = `${blocked.node.id}:${blocked.conflicts
      .map((node) => node.id)
      .sort()
      .join(",")}`;
    if (blockedResourceTraceKeys.has(key)) continue;
    blockedResourceTraceKeys.add(key);
    emitTrace("worker_blocked_resource", {
      taskId: task.id,
      nodeId: blocked.node.id,
      conflicts: blocked.conflicts.map((node) => ({
        nodeId: node.id,
        resources: node.parallelContract?.resourceHints ?? [],
      })),
      requestedResources: blocked.node.parallelContract?.resourceHints ?? [],
      ...buildParallelRunState(task),
    });
  }
  const runnable = getRunnablePendingNodes(task.nodes, { runningNodes });
  const executorMaxConcurrent = getExecutorMaxConcurrent();
  const schedulerTopology = resolveLaneTopology(task.laneTopologyMode);
  const schedulerConcurrency = resolveExecutorNodeConcurrency({
    topology: schedulerTopology,
    maxWorkers: task.maxWorkers,
    executorMaxConcurrent,
  });
  logger.debug("orchestrator", "Scheduler cycle", {
    taskId: task.id,
    pending: task.nodes.filter((n) => n.status === "pending").length,
    running: runningCount,
    completed: task.nodes.filter((n) => n.status === "completed").length,
    failed: task.nodes.filter((n) => n.status === "failed").length,
    runnable: runnable.length,
    schedulerConcurrency,
    laneTopologyMode: schedulerTopology.mode,
  });
  return { runnable, schedulerConcurrency };
}

export function getExecutorLaneWait(input: {
  runningCount: number;
  runnable: TaskNode[];
  getLaneState: () => LaneRuntimeState;
}): LaneRuntimeState | null {
  const { runningCount, runnable, getLaneState } = input;
  if (
    runningCount === 0 &&
    runnable.length > 0 &&
    isLaneIsolated(getLaneState())
  ) {
    return getLaneState();
  }
  return null;
}

export async function waitForExecutorLane(input: {
  task: OrchestratorTask;
  runnable: TaskNode[];
  laneState: LaneRuntimeState;
  emitTrace: EmitTrace;
}): Promise<void> {
  const { task, runnable, laneState, emitTrace } = input;
  const reason =
    `Executor lane isolated until ${new Date(laneState.isolatedUntilMs).toISOString()} ` +
    `(lastError=${laneState.lastError || "unknown"})`;
  logger.warn("orchestrator", "Executor lane isolation blocked scheduler", {
    taskId: task.id,
    workspaceId: task.workspaceId,
    reason,
    runnableNodeIds: runnable.map((node) => node.id),
  });
  emitTrace("scheduler_executor_lane_wait", {
    taskId: task.id,
    reason,
    runnableNodeIds: runnable.map((node) => node.id),
    remainingMs: Math.max(0, laneState.isolatedUntilMs - Date.now()),
  });
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.min(1_000, Math.max(25, laneState.isolatedUntilMs - Date.now())),
    ),
  );
}

export function queueRunnableWorkers(input: {
  task: OrchestratorTask;
  runnable: TaskNode[];
  running: Set<Promise<void>>;
  schedulerConcurrency: number;
  queuedWorkerTraceNodeIds: Set<string>;
  launchWorker: (node: TaskNode) => Promise<void>;
  emitTrace: EmitTrace;
}): void {
  const {
    task, runnable, running, schedulerConcurrency, queuedWorkerTraceNodeIds,
    launchWorker, emitTrace,
  } = input;
  while (runnable.length > 0 && running.size < schedulerConcurrency) {
    const node = runnable.shift()!;
    if (!queuedWorkerTraceNodeIds.has(node.id)) {
      queuedWorkerTraceNodeIds.add(node.id);
      emitTrace("worker_queued", {
        taskId: task.id,
        nodeId: node.id,
        dependencyCount: node.dependencies.length,
        resources: node.parallelContract?.resourceHints ?? [],
        parallelism: node.parallelContract?.parallelism ?? "unknown",
        ...buildParallelRunState(task),
      });
    }
    const tracked = launchWorker(node);
    running.add(tracked);
    void tracked.then(
      () => running.delete(tracked),
      () => running.delete(tracked),
    );
  }
}

export function recordSchedulerStall(input: {
  task: OrchestratorTask;
  pendingNodes: TaskNode[];
  emitFailureAttribution: (
    node: TaskNode,
    reason: string,
    detail: Record<string, unknown>,
  ) => void;
  emitTrace: EmitTrace;
}): void {
  const { task, pendingNodes, emitFailureAttribution, emitTrace } = input;
  const nodesById = new Map<string, TaskNode>(
    task.nodes.map((node) => [node.id, node]),
  );
  for (const blockedNode of pendingNodes) {
    const depState = getDependencyState(blockedNode, nodesById);
    if (depState.ready || depState.waitingOn.length > 0) continue;
    blockedNode.status = "failed";
    blockedNode.error =
      depState.failedDeps.length > 0
        ? `Blocked by failed dependencies: ${depState.failedDeps.join(", ")}`
        : `Blocked by missing dependencies: ${depState.missingDeps.join(", ")}`;
    logger.warn("orchestrator", "Node failed due to unsatisfiable dependencies", {
      taskId: task.id,
      nodeId: blockedNode.id,
      failedDeps: depState.failedDeps,
      missingDeps: depState.missingDeps,
      dependencies: blockedNode.dependencies,
    });
    emitFailureAttribution(blockedNode, "unsatisfiable_dependencies", {
      failedDeps: depState.failedDeps,
      missingDeps: depState.missingDeps,
      dependencies: blockedNode.dependencies,
    });
    emitTrace("scheduler_dependency_failed", {
      taskId: task.id,
      nodeId: blockedNode.id,
      failedDeps: depState.failedDeps,
      missingDeps: depState.missingDeps,
      dependencies: blockedNode.dependencies,
    });
  }

  if (task.nodes.some((node) => node.status === "failed")) return;

  logger.warn("orchestrator", "Scheduler deadlock detected", {
    taskId: task.id,
    pendingNodeIds: pendingNodes.map((node) => node.id),
  });
  emitTrace("scheduler_deadlock", {
    taskId: task.id,
    pendingNodeIds: pendingNodes.map((node) => node.id),
  });
}
