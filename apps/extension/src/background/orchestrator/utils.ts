/**
 * Orchestrator utility functions
 */

import { EscalationOptionId, SubtaskSummary } from "../../types";
import { TaskNode } from "./types";
import { NodeVerificationResult } from "./verifier";
import { LaneIsolationError, RuntimeLane } from "./lane-types";
import { getNodeResourceConflicts } from "./parallel-contract";

function compactResourceSummary(node: TaskNode): string | undefined {
  const hints = node.parallelContract?.resourceHints ?? [];
  if (hints.length === 0) return undefined;
  return hints
    .slice(0, 2)
    .map((hint) => `${hint.kind}:${hint.key} (${hint.access})`)
    .join(", ");
}

function workerStatusForNode(
  node: TaskNode,
  runningNodes: TaskNode[],
  nodesById: Map<string, TaskNode>,
): Pick<
  SubtaskSummary,
  "workerStatus" | "workerStatusDetail" | "parallelism" | "resourceSummary"
> {
  const resourceSummary = compactResourceSummary(node);
  const parallelism = node.parallelContract?.parallelism ?? "unknown";

  if (node.status === "completed") {
    return { workerStatus: "completed", parallelism, resourceSummary };
  }
  if (isUserSkippedNode(node)) {
    return { workerStatus: "skipped", parallelism, resourceSummary };
  }
  if (node.status === "failed") {
    return {
      workerStatus: "failed",
      workerStatusDetail: node.error,
      parallelism,
      resourceSummary,
    };
  }
  if (node.status === "running") {
    return {
      workerStatus: node.retries > 0 ? "retrying" : "running",
      workerStatusDetail: resourceSummary
        ? `Using ${resourceSummary}`
        : "Worker is active.",
      parallelism,
      resourceSummary,
    };
  }

  const unresolvedDependencies = node.dependencies.filter((dependencyId) => {
    const dependency = nodesById.get(dependencyId);
    if (!dependency) return true;
    if (isUserSkippedNode(dependency)) return false;
    return dependency.status !== "completed";
  });
  if (unresolvedDependencies.length > 0) {
    return {
      workerStatus: node.retries > 0 ? "retrying" : "queued",
      workerStatusDetail: `Waiting for ${unresolvedDependencies.length} dependency${
        unresolvedDependencies.length === 1 ? "" : "ies"
      }.`,
      parallelism,
      resourceSummary,
    };
  }

  const conflicts = getNodeResourceConflicts(node, runningNodes);
  if (conflicts.length > 0) {
    return {
      workerStatus: "blocked",
      workerStatusDetail: `Waiting for ${conflicts
        .map((candidate) => candidate.description)
        .slice(0, 2)
        .join(", ")}`,
      parallelism,
      resourceSummary,
    };
  }

  return {
    workerStatus: node.retries > 0 ? "retrying" : "queued",
    workerStatusDetail: resourceSummary
      ? `Queued for ${resourceSummary}`
      : "Queued.",
    parallelism,
    resourceSummary,
  };
}

export function toSubtasks(nodes: TaskNode[]): SubtaskSummary[] {
  const runningNodes = nodes.filter((node) => node.status === "running");
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    const worker = workerStatusForNode(node, runningNodes, nodesById);
    return {
      description: node.description,
      ...(node.displayLabel ? { label: node.displayLabel } : {}),
      status:
        node.status === "completed"
          ? "completed"
          : isUserSkippedNode(node)
            ? "skipped"
            : node.status === "failed"
              ? "failed"
              : node.status === "running"
                ? "running"
                : "pending",
      turnsUsed: 0,
      turnBudget: 0,
      result: node.result || node.error,
      nodeId: node.id,
      selectedSkillId: node.selectedSkillId,
      toolProfile: node.toolProfile,
      ...worker,
    };
  });
}

export function currentIndex(nodes: TaskNode[]): number {
  const running = nodes.findIndex((n) => n.status === "running");
  if (running >= 0) return running;
  const pending = nodes.findIndex((n) => n.status === "pending");
  if (pending >= 0) return pending;
  return nodes.length;
}

export function isUserSkippedNode(node: Pick<TaskNode, "status">): boolean {
  return node.status === "skipped";
}

export function clampInteger(value: number, min: number, max?: number): number {
  const safe = Number.isFinite(value) ? Math.floor(value) : min;
  const lowerBounded = Math.max(min, safe);
  return typeof max === "number" ? Math.min(max, lowerBounded) : lowerBounded;
}

export function isLaneIsolationError(
  error: unknown,
  lane?: RuntimeLane,
): boolean {
  if (!(error instanceof LaneIsolationError)) return false;
  return lane ? error.lane === lane : true;
}

export function deriveSuggestedApproach(
  verification: NodeVerificationResult,
): string | undefined {
  switch (verification.failureType) {
    case "blocked":
      return "Try an alternate navigation path or use a different element to bypass the block.";
    case "state_mismatch":
      return "Re-read the page state and adapt to what is actually present instead of assumed state.";
    case "insufficient_evidence":
      return "Gather more evidence before calling done — verify success criteria explicitly.";
    case "transient":
      return "Wait briefly and retry the same action — the failure may be timing-related.";
    default:
      return undefined;
  }
}

export function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export function normalizeEscalationOptionId(
  value: unknown,
): EscalationOptionId | null {
  if (
    value === "approve_continue" ||
    value === "reroute_with_option" ||
    value === "skip_node" ||
    value === "stop_task"
  ) {
    return value;
  }
  return null;
}
