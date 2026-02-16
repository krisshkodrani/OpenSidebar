import { describe, expect, test } from "bun:test";
import "../setup";
import { getDependencyState, getRunnablePendingNodes } from "../../src/background/orchestrator/scheduling";
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

    const runnable = getRunnablePendingNodes(nodes).map((n) => n.id).sort();
    expect(runnable).toEqual(["b", "d"]);
  });

  test("marks failed dependency as not ready", () => {
    const nodes: TaskNode[] = [node("a", "failed"), node("b", "pending", ["a"])];
    const state = getDependencyState(nodes[1], new Map(nodes.map((n) => [n.id, n])));

    expect(state.ready).toBe(false);
    expect(state.failedDeps).toEqual(["a"]);
  });

  test("marks missing dependency as not ready", () => {
    const nodes: TaskNode[] = [node("b", "pending", ["missing-node"])];
    const state = getDependencyState(nodes[0], new Map(nodes.map((n) => [n.id, n])));

    expect(state.ready).toBe(false);
    expect(state.missingDeps).toEqual(["missing-node"]);
  });
});
