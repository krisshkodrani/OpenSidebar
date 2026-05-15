import { describe, expect, test } from "vitest";
import "../setup";
import {
  getDependencyState,
  getResourceBlockedPendingNodes,
  getRunnablePendingNodes,
} from "../../src/background/orchestrator/scheduling";
import { annotateParallelContracts } from "../../src/background/orchestrator/parallel-contract";
import { TaskNode } from "../../src/background/orchestrator/types";
import { ToolName } from "../../src/types";

function node(
  id: string,
  status: TaskNode["status"],
  dependencies: string[] = [],
): TaskNode {
  return {
    id,
    role: "executor",
    description: `Task ${id}`,
    successCriteria: `Task ${id} done`,
    allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
    dependencies,
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status,
    retries: 0,
  };
}

describe("Orchestrator dependency scheduling", () => {
  test("returns only pending nodes with satisfied dependencies", () => {
    const nodes: TaskNode[] = [
      node("a", "completed"),
      node("b", "pending", ["a"]),
      node("c", "pending", ["b"]),
      node("d", "pending"),
    ];

    const runnable = getRunnablePendingNodes(nodes)
      .map((n) => n.id)
      .sort();
    expect(runnable).toEqual(["b", "d"]);
  });

  test("marks failed dependency as not ready", () => {
    const nodes: TaskNode[] = [
      node("a", "failed"),
      node("b", "pending", ["a"]),
    ];
    const state = getDependencyState(
      nodes[1],
      new Map(nodes.map((n) => [n.id, n])),
    );

    expect(state.ready).toBe(false);
    expect(state.failedDeps).toEqual(["a"]);
  });

  test("marks missing dependency as not ready", () => {
    const nodes: TaskNode[] = [node("b", "pending", ["missing-node"])];
    const state = getDependencyState(
      nodes[0],
      new Map(nodes.map((n) => [n.id, n])),
    );

    expect(state.ready).toBe(false);
    expect(state.missingDeps).toEqual(["missing-node"]);
  });

  test("filters runnable nodes blocked by running resource conflicts", () => {
    const nodes = annotateParallelContracts([
      {
        ...node("a", "running"),
        description: "Fill the checkout form",
        successCriteria: "Checkout form contains requested values",
      },
      {
        ...node("b", "pending"),
        description: "Submit the checkout form",
        successCriteria: "Order confirmation page is visible",
      },
      {
        ...node("c", "pending"),
        description: "Read prices from https://alpha.example/products",
        successCriteria:
          "Prices from https://alpha.example/products are reported",
      },
    ]);
    nodes[1].dependencies = [];

    const runningNodes = nodes.filter((entry) => entry.status === "running");
    const runnable = getRunnablePendingNodes(nodes, { runningNodes }).map(
      (entry) => entry.id,
    );
    const blocked = getResourceBlockedPendingNodes(nodes, runningNodes).map(
      (entry) => entry.node.id,
    );

    expect(runnable).toEqual(["c"]);
    expect(blocked).toEqual(["b"]);
  });
});
