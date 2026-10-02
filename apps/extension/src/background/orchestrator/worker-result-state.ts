import { logger } from "../../utils";
import type { LoopResult } from "../agent/loop-types";
import type { BudgetEstimator } from "./budget-estimator";
import {
  createTaskFleetTelemetryState,
  recordTaskFleetLoopResult,
  type TaskFleetTelemetryState,
} from "./fleet-telemetry";
import { mergeSessionMetrics } from "./sanitizers";
import type { OrchestratorTask, TaskNode } from "./types";

export function recordWorkerResultState(input: {
  task: OrchestratorTask;
  node: TaskNode;
  result: LoopResult;
  nodeStartMs: number;
  budgetEstimator: BudgetEstimator;
  fleetTelemetryByTaskId: Map<string, TaskFleetTelemetryState>;
}): void {
  const {
    task,
    node,
    result,
    nodeStartMs,
    budgetEstimator,
    fleetTelemetryByTaskId,
  } = input;
  task.sessionMetrics = mergeSessionMetrics(task.sessionMetrics, result.metrics);
  let fleetTelemetry = fleetTelemetryByTaskId.get(task.id);
  if (!fleetTelemetry) {
    fleetTelemetry = createTaskFleetTelemetryState();
    fleetTelemetryByTaskId.set(task.id, fleetTelemetry);
  }
  recordTaskFleetLoopResult(fleetTelemetry, result);
  budgetEstimator.recordObservation({
    tokens: result.metrics?.totalTokens ?? 0,
    costUsd: result.metrics?.totalCost ?? 0,
    timeMs: Math.max(
      result.metrics?.totalSessionTimeMs ?? 0,
      Date.now() - nodeStartMs,
    ),
  });
  logger.debug("orchestrator", "Worker metrics merged", {
    taskId: task.id,
    nodeId: node.id,
    totalTokens: task.sessionMetrics.totalTokens,
    totalCost: task.sessionMetrics.totalCost,
    totalLlmTimeMs: task.sessionMetrics.totalLlmTimeMs,
    llmCallCount: task.sessionMetrics.llmCallCount,
    budgetEstimate: budgetEstimator.getEstimate(),
  });
  // Store condensed action trajectory for same-tab handoff
  if (result.trajectory && result.trajectory.length > 0) {
    node.trajectory = result.trajectory;
  }
  if (result.partialHandoff) {
    node.partialHandoff = result.partialHandoff;
    task.partialHandoff = result.partialHandoff;
  }
}
