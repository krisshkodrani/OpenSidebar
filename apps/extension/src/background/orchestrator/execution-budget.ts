import { logger } from "../../utils";
import { getTokenBudgetWarning } from "../agent/token-budget-policy";
import type { OrchestratorTask } from "./types";
import { sendMessage } from "./task-messaging";

export function getBudgetExhaustionReason(task: OrchestratorTask): string | null {
  const elapsedMs = Date.now() - (task.startedAt || task.createdAt);
  if (elapsedMs > task.budget.maxSessionTimeMs) {
    return `Global time budget exceeded (${elapsedMs}ms > ${task.budget.maxSessionTimeMs}ms)`;
  }
  if (task.sessionMetrics.totalTokens > task.budget.maxTotalTokens) {
    return `Global token budget exceeded (${task.sessionMetrics.totalTokens} > ${task.budget.maxTotalTokens})`;
  }
  if (task.sessionMetrics.totalCost > task.budget.maxTotalCostUsd) {
    return `Global cost budget exceeded ($${task.sessionMetrics.totalCost.toFixed(4)} > $${task.budget.maxTotalCostUsd.toFixed(4)})`;
  }
  return null;
}

export function emitBudgetWarnings(
  task: OrchestratorTask,
  warningsEmitted: Set<string>,
  emitTrace: (data: Record<string, unknown>) => void,
  tokenWarningRatio?: number,
): void {
  const elapsedMs = Date.now() - (task.startedAt || task.createdAt);
  const timeRatio = elapsedMs / task.budget.maxSessionTimeMs;
  const tokenWarning = getTokenBudgetWarning({
    totalTokens: task.sessionMetrics.totalTokens,
    maxTotalTokens: task.budget.maxTotalTokens,
    warningRatio: tokenWarningRatio,
  });
  const costRatio =
    task.sessionMetrics.totalCost / task.budget.maxTotalCostUsd;
  if (timeRatio >= 0.8 && !warningsEmitted.has("time")) {
    warningsEmitted.add("time");
    emitTrace({
      metric: "time",
      ratio: timeRatio,
      totalTokens: task.sessionMetrics.totalTokens,
      totalCost: task.sessionMetrics.totalCost,
      elapsedMs,
    });
  }
  if (tokenWarning && !warningsEmitted.has("tokens")) {
    warningsEmitted.add("tokens");
    emitTrace({
      metric: "tokens",
      ratio: tokenWarning.ratio,
      threshold: tokenWarning.threshold,
      totalTokens: task.sessionMetrics.totalTokens,
      totalCost: task.sessionMetrics.totalCost,
      elapsedMs,
    });
    sendMessage({
      type: "AGENT_STEP",
      workspaceId: task.workspaceId,
      payload: {
        step: {
          id: crypto.randomUUID(),
          type: "warning",
          label: "Task token usage is approaching its limit",
          detail: `${task.sessionMetrics.totalTokens.toLocaleString()} of ${task.budget.maxTotalTokens.toLocaleString()} tokens used`,
          status: "done",
          timestamp: Date.now(),
        },
        update: false,
      },
    });
  }
  if (costRatio >= 0.8 && !warningsEmitted.has("cost")) {
    warningsEmitted.add("cost");
    emitTrace({
      metric: "cost",
      ratio: costRatio,
      totalTokens: task.sessionMetrics.totalTokens,
      totalCost: task.sessionMetrics.totalCost,
      elapsedMs,
    });
  }
}

export function applyBudgetTermination(
  task: OrchestratorTask,
  reason: string,
): void {
  task.terminationReason = reason;
  for (const pendingNode of task.nodes) {
    if (pendingNode.status !== "pending") continue;
    pendingNode.status = "failed";
    pendingNode.error = reason;
  }
  logger.warn("orchestrator", "Global budget exhausted; terminating task", {
    taskId: task.id,
    reason,
    totalTokens: task.sessionMetrics.totalTokens,
    totalCost: task.sessionMetrics.totalCost,
    elapsedMs: Date.now() - (task.startedAt || task.createdAt),
  });
  sendMessage({
    type: "AGENT_STEP",
    workspaceId: task.workspaceId,
    payload: {
      step: {
        id: crypto.randomUUID(),
        type: "warning",
        label: "Global execution budget exhausted",
        detail: reason,
        status: "done",
        timestamp: Date.now(),
      },
      update: false,
    },
  });
}
