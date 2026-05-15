import { TaskNode } from "./types";
import { getNodeResourceConflicts } from "./parallel-contract";

export interface DependencyState {
  ready: boolean;
  waitingOn: string[];
  failedDeps: string[];
  missingDeps: string[];
}

export function getDependencyState(
  node: TaskNode,
  nodesById: Map<string, TaskNode>,
): DependencyState {
  const waitingOn: string[] = [];
  const failedDeps: string[] = [];
  const missingDeps: string[] = [];
  const deps = Array.isArray(node.dependencies) ? node.dependencies : [];

  for (const depId of deps) {
    if (depId === node.id) continue;
    const dep = nodesById.get(depId);
    if (!dep) {
      missingDeps.push(depId);
      continue;
    }
    if (dep.status === "failed") {
      failedDeps.push(depId);
      continue;
    }
    if (dep.status !== "completed") {
      waitingOn.push(depId);
    }
  }

  return {
    ready:
      waitingOn.length === 0 &&
      failedDeps.length === 0 &&
      missingDeps.length === 0,
    waitingOn,
    failedDeps,
    missingDeps,
  };
}

export function getRunnablePendingNodes(
  nodes: TaskNode[],
  options: { runningNodes?: TaskNode[] } = {},
): TaskNode[] {
  const nodesById = new Map<string, TaskNode>(
    nodes.map((node) => [node.id, node]),
  );
  return nodes.filter((node) => {
    if (node.status !== "pending") return false;
    if (!getDependencyState(node, nodesById).ready) return false;
    if (options.runningNodes?.length) {
      return getNodeResourceConflicts(node, options.runningNodes).length === 0;
    }
    return true;
  });
}

export function getResourceBlockedPendingNodes(
  nodes: TaskNode[],
  runningNodes: TaskNode[],
): Array<{ node: TaskNode; conflicts: TaskNode[] }> {
  if (runningNodes.length === 0) return [];
  const dependencyReady = getRunnablePendingNodes(nodes);
  return dependencyReady
    .map((node) => ({
      node,
      conflicts: getNodeResourceConflicts(node, runningNodes),
    }))
    .filter((entry) => entry.conflicts.length > 0);
}
