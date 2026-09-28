import { logger } from "../../utils";
import type { LoopResult } from "../agent/loop-types";
import { formatPlannerReflexionContext } from "./handoff";
import { appendRecentSideEffects } from "./node-heuristics";
import { appendHandoffArtifact, sendMessage } from "./task-messaging";
import type { OrchestratorTask, TaskNode } from "./types";
import { isLaneIsolationError } from "./utils";
import type { NodeVerificationResult } from "./verifier";

export async function maybeReplanVerifierRetry(input: {
  task: OrchestratorTask;
  node: TaskNode;
  result: Pick<LoopResult, "sideEffectsLog">;
  verification: NodeVerificationResult;
  driftDetected: boolean;
  staleSignalCount: number;
  expandNode: (reason: string) => Promise<TaskNode[] | null>;
  emitFailureAttribution: (
    reason: string,
    detail: Record<string, unknown>,
  ) => void;
}): Promise<boolean> {
  const {
    task,
    node,
    result,
    verification,
    driftDetected,
    staleSignalCount,
    expandNode,
    emitFailureAttribution,
  } = input;
  if (
    verification.decision !== "retry" ||
    (!driftDetected && staleSignalCount <= 0)
  ) {
    return false;
  }

  if (task.replansUsed >= task.maxReplans) {
    const reason = `Replan budget exhausted (${task.replansUsed}/${task.maxReplans}). ${verification.reason}`;
    appendHandoffArtifact(node, {
      role: "planner",
      phase: "planner_replan",
      note: reason,
    });
    node.status = "failed";
    node.error = appendRecentSideEffects(reason, result.sideEffectsLog);

    logger.warn("orchestrator", "Replan budget exhausted; failing node", {
      taskId: task.id,
      nodeId: node.id,
      replansUsed: task.replansUsed,
      maxReplans: task.maxReplans,
    });
    emitFailureAttribution("replan_budget_exhausted", {
      replansUsed: task.replansUsed,
      maxReplans: task.maxReplans,
      verifierReason: verification.reason,
    });
    sendMessage({
      type: "AGENT_STEP",
      workspaceId: task.workspaceId,
      payload: {
        step: {
          id: crypto.randomUUID(),
          type: "warning",
          label: `Planner: replan budget exhausted for node ${node.id}`,
          detail: reason,
          status: "done",
          timestamp: Date.now(),
        },
        update: false,
      },
    });
    return true;
  }

  try {
    const reflexionContext = formatPlannerReflexionContext(
      task.plannerReflexionLog,
    );
    const replanReason = reflexionContext
      ? `${verification.reason} (driftDetected=${driftDetected}; staleSignalCount=${staleSignalCount})\n\nPrior failure lessons:\n${reflexionContext}`
      : `${verification.reason} (driftDetected=${driftDetected}; staleSignalCount=${staleSignalCount})`;
    const expandedNodes = await expandNode(replanReason);
    if (expandedNodes && expandedNodes.length > 0) {
      appendHandoffArtifact(node, {
        role: "planner",
        phase: "planner_replan",
        note:
          staleSignalCount > 0
            ? `Planner expanded node due to stale-signal retry: ${verification.reason}`
            : `Planner expanded node due to drift/retry: ${verification.reason}`,
      });
      node.status = "completed";
      node.result = `Replanned into ${expandedNodes.length} node(s): ${verification.reason}`;
      task.nodes.push(...expandedNodes);
      task.replansUsed += 1;

      logger.info("orchestrator", "Node replanned after drift retry", {
        taskId: task.id,
        nodeId: node.id,
        expandedCount: expandedNodes.length,
        replansUsed: task.replansUsed,
        maxReplans: task.maxReplans,
      });
      return true;
    }
  } catch (error) {
    if (isLaneIsolationError(error, "planner")) {
      node.status = "failed";
      node.error = appendRecentSideEffects(
        `Planner lane isolated during replan: ${error instanceof Error ? error.message : String(error)}`,
        result.sideEffectsLog,
      );

      logger.warn("orchestrator", "Planner lane isolated, failing node without retry", {
        taskId: task.id,
        nodeId: node.id,
        error,
      });
      sendMessage({
        type: "AGENT_STEP",
        workspaceId: task.workspaceId,
        payload: {
          step: {
            id: crypto.randomUUID(),
            type: "warning",
            label: `Planner lane isolated for node ${node.id.slice(0, 6)}`,
            detail: node.error,
            status: "done",
            timestamp: Date.now(),
          },
          update: false,
        },
      });
      return true;
    }
    logger.warn("orchestrator", "Dynamic replanning failed; falling back to retry", {
      taskId: task.id,
      nodeId: node.id,
      error,
    });
  }
  return false;
}
