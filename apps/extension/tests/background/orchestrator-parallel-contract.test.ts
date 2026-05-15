import { describe, expect, test } from "vitest";
import "../setup";
import {
  annotateParallelContracts,
  buildPlanTraceGraph,
  getNodeResourceConflicts,
} from "../../src/background/orchestrator/parallel-contract";
import type { TaskNode } from "../../src/background/orchestrator/types";
import { ToolName } from "../../src/types";

function node(
  id: string,
  description: string,
  dependencies: string[] = [],
): TaskNode {
  return {
    id,
    role: "executor",
    description,
    successCriteria: `${description} is visible in page or tool output.`,
    allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
    dependencies,
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status: "pending",
    retries: 0,
  };
}

describe("orchestrator parallel contracts", () => {
  test("marks distinct read-only URL targets as independent", () => {
    const nodes = annotateParallelContracts([
      node("n1", "Read prices from https://alpha.example/products"),
      node("n2", "Read inventory from https://beta.example/inventory"),
    ]);

    expect(nodes[0].parallelContract?.parallelism).toBe("independent");
    expect(nodes[1].parallelContract?.parallelism).toBe("independent");
    expect(nodes[1].dependencies).toEqual([]);
    expect(nodes[0].parallelContract?.resourceHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "url",
          access: "read",
          source: "repair",
        }),
      ]),
    );
  });

  test("serializes shared mutable form work with a repair dependency", () => {
    const nodes = annotateParallelContracts([
      node("n1", "Fill the checkout form with Alex Morgan"),
      node("n2", "Submit the checkout form"),
    ]);

    expect(nodes[1].dependencies).toEqual(["n1"]);
    expect(nodes[1].parallelContract).toMatchObject({
      parallelism: "serialized",
      siblingAwareness: "coordination_required",
    });
    expect(nodes[1].parallelContract?.dependencyReason).toContain(
      "Serialized with n1",
    );
  });

  test("treats ambiguous current-tab action nodes as serialized", () => {
    const nodes = annotateParallelContracts([
      node("n1", "Click the visible save button"),
      node("n2", "Click the visible submit button"),
    ]);

    expect(nodes[1].dependencies).toEqual(["n1"]);
    expect(nodes[1].parallelContract?.resourceHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tab",
          key: "root",
          access: "approval",
        }),
      ]),
    );
  });

  test("emits compact trace graph with dependency edges and contracts", () => {
    const nodes = annotateParallelContracts([
      node("n1", "Fill the checkout form with Alex Morgan"),
      node("n2", "Submit the checkout form"),
    ]);

    const graph = buildPlanTraceGraph(nodes);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[1]).toMatchObject({
      nodeId: "n2",
      dependencies: ["n1"],
      parallelContract: {
        parallelism: "serialized",
        resourceHints: expect.any(Array),
      },
    });
    expect(graph.edges).toEqual([
      expect.objectContaining({ from: "n1", to: "n2" }),
    ]);
  });

  test("detects resource conflicts against running sibling nodes", () => {
    const nodes = annotateParallelContracts([
      { ...node("n1", "Fill the checkout form"), status: "running" },
      node("n2", "Submit the checkout form"),
      node("n3", "Read prices from https://alpha.example/products"),
    ]);

    expect(getNodeResourceConflicts(nodes[1], [nodes[0]])).toEqual([nodes[0]]);
    expect(getNodeResourceConflicts(nodes[2], [nodes[0]])).toEqual([]);
  });

  test("uses tool profile concurrency metadata for scheduler access defaults", () => {
    const nodes = annotateParallelContracts([
      {
        ...node("n1", "Collect metrics from https://alpha.example/dashboard"),
        toolProfile: "read_only",
      },
      {
        ...node("n2", "Collect metrics from https://beta.example/dashboard"),
        toolProfile: "read_only",
      },
    ]);

    expect(nodes[0].parallelContract?.resourceHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "url", access: "read" }),
      ]),
    );
    expect(nodes[1].dependencies).toEqual([]);
    expect(nodes[1].parallelContract?.parallelism).toBe("independent");
  });

  test("treats navigate-to-read URL steps as independent read locks", () => {
    const nodes = annotateParallelContracts([
      {
        ...node("n1", "Open https://example.com/reports/alpha and read it"),
        toolProfile: "navigate",
      },
      {
        ...node("n2", "Open https://example.com/reports/beta and read it"),
        toolProfile: "navigate",
      },
    ]);

    expect(nodes[0].parallelContract?.resourceHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "url", access: "read" }),
      ]),
    );
    expect(nodes[1].dependencies).toEqual([]);
    expect(nodes[1].parallelContract?.parallelism).toBe("independent");
  });

  test("serializes profiles with never-concurrent tool audit entries", () => {
    const nodes = annotateParallelContracts([
      {
        ...node("n1", "Inspect hidden state on the current page"),
        toolProfile: "inspect_hidden_state",
      },
    ]);

    expect(nodes[0].parallelContract).toMatchObject({
      parallelism: "serialized",
      siblingAwareness: "coordination_required",
    });
    expect(nodes[0].parallelContract?.resourceHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tab",
          key: "root",
          access: "write",
        }),
      ]),
    );
  });
});
