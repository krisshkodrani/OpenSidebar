import { describe, expect, test, vi } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { tryHorizonExpansion } from "../../src/background/orchestrator/horizon-expansion";
import type { OrchestratorPlanner } from "../../src/background/orchestrator/planner";
import type { OrchestratorTask, TaskNode } from "../../src/background/orchestrator/types";

function node(id: string, status: TaskNode["status"]): TaskNode {
  return {
    id,
    role: "executor",
    description: `Do ${id}`,
    successCriteria: `${id} done`,
    allowedTools: [ToolName.DONE],
    dependencies: [],
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status,
    retries: 0,
  };
}

function task(): OrchestratorTask {
  return {
    id: "task-1",
    query: "Finish the workflow",
    createdAt: Date.now(),
    rootTabId: 101,
    nodes: [node("done", "completed"), node("blocked", "pending")],
    horizonExpansions: 0,
    currentIndex: 1,
    budget: {
      maxSessionTimeMs: 1_000_000,
      maxTotalTokens: 1_000_000,
      maxTotalCostUsd: 100,
    },
    sessionMetrics: { totalTokens: 10, totalCost: 0 },
  } as OrchestratorTask;
}

describe("horizon expansion", () => {
  test("adds planner nodes after completed work and records progress", async () => {
    const currentTask = task();
    const next = node("next", "pending");
    const planNextHorizon = vi.fn(async () => [next]);
    const sendProgress = vi.fn();
    const persistTaskCheckpoint = vi.fn(async () => {});
    const emitHorizonTrace = vi.fn();
    const expanded = await tryHorizonExpansion({
      task: currentTask,
      replanner: { planNextHorizon } as unknown as Pick<OrchestratorPlanner, "planNextHorizon">,
      getBudgetExhaustionReason: () => null,
      getRootTab: async () => ({ title: "Current page", url: "https://example.test" }),
      runPlanner: (operation) => operation(),
      sendProgress,
      persistTaskCheckpoint,
      emitHorizonTrace,
    });

    expect(expanded).toBe(true);
    expect(planNextHorizon).toHaveBeenCalledWith(
      "Finish the workflow",
      expect.stringContaining("Do done"),
      "Current page",
      "https://example.test",
      { enabledSkillPackIds: undefined },
    );
    expect(next.dependencies).toEqual(["done"]);
    expect(currentTask.nodes.at(-1)).toBe(next);
    expect(currentTask.horizonExpansions).toBe(1);
    expect(sendProgress).toHaveBeenCalledOnce();
    expect(persistTaskCheckpoint).toHaveBeenCalledOnce();
    expect(emitHorizonTrace).toHaveBeenCalledWith(
      expect.objectContaining({ newNodeCount: 1, expansionNumber: 1 }),
    );
  });

  test("does not call the planner near the token budget", async () => {
    const currentTask = task();
    currentTask.sessionMetrics.totalTokens = 900_000;
    const planNextHorizon = vi.fn(async () => [node("next", "pending")]);
    const expanded = await tryHorizonExpansion({
      task: currentTask,
      replanner: { planNextHorizon } as unknown as Pick<OrchestratorPlanner, "planNextHorizon">,
      getBudgetExhaustionReason: () => null,
      getRootTab: async () => ({ title: "Current page" }),
      runPlanner: (operation) => operation(),
      sendProgress: vi.fn(),
      persistTaskCheckpoint: vi.fn(async () => {}),
      emitHorizonTrace: vi.fn(),
    });

    expect(expanded).toBe(false);
    expect(planNextHorizon).not.toHaveBeenCalled();
  });
});
