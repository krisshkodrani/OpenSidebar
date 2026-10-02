import { logger } from "../../utils";
import type { OrchestratorTask, TaskNode } from "./types";
import type { OrchestratorPlanner } from "./planner";
import { buildCompletedStepsSummary } from "./handoff";
import { MAX_HORIZON_EXPANSIONS } from "./runtime-policy";
import { currentIndex } from "./utils";

export async function tryHorizonExpansion(input: {
  task: OrchestratorTask;
  replanner: Pick<OrchestratorPlanner, "planNextHorizon">;
  getBudgetExhaustionReason: () => string | null;
  getRootTab: () => Promise<{ title?: string; url?: string }>;
  runPlanner: (operation: () => Promise<TaskNode[] | null>) => Promise<TaskNode[] | null>;
  sendProgress: () => void;
  persistTaskCheckpoint: () => Promise<void>;
  emitHorizonTrace: (data: Record<string, unknown>) => void;
}): Promise<boolean> {
  const {
    task, replanner, getBudgetExhaustionReason, getRootTab, runPlanner,
    sendProgress, persistTaskCheckpoint, emitHorizonTrace,
  } = input;
  if (task.planClassification?.isSingleNode) return false;
  if (task.horizonExpansions >= MAX_HORIZON_EXPANSIONS) return false;

  const completedNodes = task.nodes.filter((n) => n.status === "completed");
  if (completedNodes.length === 0) return false;

  // All nodes completed — goal achieved, no expansion needed.
  if (task.nodes.every((n) => n.status === "completed")) return false;

  // Check budget near exhaustion (>90%).
  const elapsedMs = Date.now() - (task.startedAt || task.createdAt);
  const timeRatio = elapsedMs / task.budget.maxSessionTimeMs;
  const tokenRatio = task.sessionMetrics.totalTokens / task.budget.maxTotalTokens;
  const costRatio = task.sessionMetrics.totalCost / task.budget.maxTotalCostUsd;
  if (timeRatio >= 0.9 || tokenRatio >= 0.9 || costRatio >= 0.9) return false;

  if (getBudgetExhaustionReason()) return false;

  let pageTitle = "Untitled";
  let pageUrl = "";
  try {
    const tab = await getRootTab();
    pageTitle = tab.title || "Untitled";
    pageUrl = tab.url || "";
  } catch {
    // Tab may have been closed.
    return false;
  }

  const summary = buildCompletedStepsSummary(task.nodes);

  let newNodes: TaskNode[] | null = null;
  try {
    newNodes = await runPlanner(() =>
      replanner.planNextHorizon(task.query, summary, pageTitle, pageUrl, {
        enabledSkillPackIds: task.enabledSkillPackIds,
      }),
    );
  } catch (error: any) {
    logger.warn("orchestrator", "Horizon expansion planner call failed", {
      taskId: task.id,
      error: error?.message,
    });
    return false;
  }

  if (!newNodes || newNodes.length === 0) return false;

  // Set first new node's dependency on the last completed node.
  const lastCompletedId = completedNodes[completedNodes.length - 1].id;
  if (newNodes[0].dependencies.length === 0) {
    newNodes[0].dependencies = [lastCompletedId];
  }

  task.nodes.push(...newNodes);
  task.horizonExpansions++;
  task.currentIndex = currentIndex(task.nodes);
  sendProgress();
  await persistTaskCheckpoint();

  emitHorizonTrace({
    taskId: task.id,
    expansionNumber: task.horizonExpansions,
    newNodeCount: newNodes.length,
    totalNodes: task.nodes.length,
  });

  logger.info("orchestrator", "Horizon expansion added new nodes", {
    taskId: task.id,
    expansionNumber: task.horizonExpansions,
    newNodeCount: newNodes.length,
    totalNodes: task.nodes.length,
  });

  return true;
}
