/**
 * Orchestrator utility functions
 */

import { EscalationOptionId, SubtaskSummary } from "../../types";
import { TaskNode } from "./types";
import { NodeVerificationResult } from "./verifier";
import { LaneIsolationError, RuntimeLane } from "./lane-types";

export function toSubtasks(nodes: TaskNode[]): SubtaskSummary[] {
  return nodes.map((node) => ({
    description: node.description,
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
  }));
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
