import { logger } from "../../utils";
import type { LoopResult } from "../agent/loop-types";
import type { CompletionEnvelope } from "../agent/completion-kernel";
import { LaneTimeoutError } from "./lane-types";
import { appendRecentSideEffects } from "./node-heuristics";
import { buildParallelRunState } from "./plan-state";
import { decideRetryPolicy } from "./retry-policy";
import type { OrchestratorTask, TaskNode } from "./types";
import { isLaneIsolationError } from "./utils";
import { partialHandoffTerminationReason } from "./partial-handoff-reason";

export function recordIncompleteWorkerResult(input: {
  task: OrchestratorTask;
  node: TaskNode;
  result: LoopResult;
  emitTrace: (type: string, data: Record<string, unknown>) => void;
}): void {
  const { task, node, result, emitTrace } = input;
  if (result.outcome === "max_turns" && result.partialHandoff) {
    node.status = "failed";
    node.error = result.summary;
    task.partialHandoff = result.partialHandoff;
    task.terminationReason =
      task.terminationReason || partialHandoffTerminationReason(result.partialHandoff);
    emitTrace("partial_handoff_created", {
      nodeId: node.id,
      reason: result.partialHandoff.reason,
      turnsUsed: result.partialHandoff.turnsUsed,
      maxTurns: result.partialHandoff.maxTurns,
      completedCount: result.partialHandoff.completed.length,
      evidenceCount: result.partialHandoff.evidence.length,
      remainingCount: result.partialHandoff.remaining.length,
    });
    return;
  }
  const retryDecision = decideRetryPolicy(
    { source: "executor", errorMessage: result.summary },
    node.retries,
  );
  if (retryDecision.shouldRetry && task.status === "running") {
    node.status = "pending";
    node.retries += 1;
    node.error = appendRecentSideEffects(
      `${result.summary} (${retryDecision.rationale})`,
      result.sideEffectsLog,
    );
  } else {
    node.status = "failed";
    node.error = appendRecentSideEffects(
      `${result.summary} (${retryDecision.rationale})`,
      result.sideEffectsLog,
    );
  }
}

export function recordThrownWorkerFailure(input: {
  task: OrchestratorTask;
  node: TaskNode;
  workerId: string;
  error: unknown;
  completedResult: {
    outcome: "completed";
    summary: string;
    completionEnvelope?: CompletionEnvelope;
  } | null;
  emitTrace: (type: string, data: Record<string, unknown>) => void;
  emitCompletionScope: (data: {
    scope: "lane" | "node";
    status: "completed";
    nodeId: string;
    reason: string;
    envelope?: CompletionEnvelope;
  }) => void;
  emitFailureAttribution: (
    reason: string,
    detail: Record<string, unknown>,
  ) => void;
}): void {
  const {
    task,
    node,
    workerId,
    error,
    completedResult,
    emitTrace,
    emitCompletionScope,
    emitFailureAttribution,
  } = input;
  const errorMessage =
    (error as { message?: string } | null | undefined)?.message || String(error);
  if (node.status !== "running") {
    emitTrace("worker_result_ignored", {
      taskId: task.id,
      nodeId: node.id,
      workerId,
      currentStatus: node.status,
      executorOutcome: error instanceof LaneTimeoutError ? "timeout" : "error",
      reason: "node_already_terminal",
      hadCompletedResult: Boolean(completedResult),
      error: errorMessage,
      ...buildParallelRunState(task),
    });
    return;
  }
  if ((task.status as string) === "stopping") {
    emitTrace("worker_result_ignored", {
      taskId: task.id,
      nodeId: node.id,
      workerId,
      currentStatus: node.status,
      executorOutcome: error instanceof LaneTimeoutError ? "timeout" : "error",
      reason: "task_stop_requested",
      hadCompletedResult: Boolean(completedResult),
      error: errorMessage,
      ...buildParallelRunState(task),
    });
    node.status = "failed";
    node.error = "Stopped by user";
    return;
  }

  // A terminal done() can race with lane timeout; accepting it avoids replaying
  // an action that already completed.
  if (completedResult) {
    logger.info(
      "orchestrator",
      "Worker timed out but done() was already called — accepting result",
      {
        taskId: task.id,
        nodeId: node.id,
        summary: completedResult.summary.slice(0, 120),
      },
    );
    node.status = "completed";
    node.result = completedResult.summary;
    emitCompletionScope({
      scope: "lane",
      status: "completed",
      nodeId: node.id,
      reason: "executor_timeout_after_terminal_completion",
      envelope: completedResult.completionEnvelope,
    });
    emitCompletionScope({
      scope: "node",
      status: "completed",
      nodeId: node.id,
      reason: "accepted_terminal_completion_after_executor_timeout",
      envelope: completedResult.completionEnvelope,
    });
    return;
  }

  if (
    isLaneIsolationError(error, "executor") ||
    isLaneIsolationError(error, "verifier") ||
    isLaneIsolationError(error, "planner")
  ) {
    if (isLaneIsolationError(error, "executor") && task.status === "running") {
      const retryDecision = decideRetryPolicy(
        { source: "system", errorMessage },
        node.retries,
      );
      if (retryDecision.shouldRetry) {
        node.status = "pending";
        node.retries += 1;
        node.error = `Executor lane cooldown: ${errorMessage} (${retryDecision.rationale})`;
        logger.warn("orchestrator", "Retrying node after executor lane isolation", {
          taskId: task.id,
          nodeId: node.id,
          retries: node.retries,
          error,
        });
        emitTrace("scheduler_executor_lane_retry", {
          nodeId: node.id,
          retries: node.retries,
          reason: errorMessage,
        });
        return;
      }
    }
    node.status = "failed";
    node.error = `Critical lane isolation while executing node: ${errorMessage}`;
    logger.warn("orchestrator", "Failing node due to lane isolation", {
      taskId: task.id,
      nodeId: node.id,
      error,
    });
    emitFailureAttribution("executor_lane_isolation", { error: errorMessage });
    return;
  }
  const retryDecision = decideRetryPolicy(
    { source: "system", errorMessage },
    node.retries,
  );
  if (retryDecision.shouldRetry && task.status === "running") {
    node.status = "pending";
    node.retries += 1;
    node.error = `${errorMessage} (${retryDecision.rationale})`;
  } else {
    node.status = "failed";
    node.error = `${errorMessage} (${retryDecision.rationale})`;
  }
}
