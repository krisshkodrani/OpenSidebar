import { describe, expect, test } from "vitest";
import "../setup";
import { buildCompletedStepsSummary } from "../../src/background/orchestrator/handoff";
import { TaskNode } from "../../src/background/orchestrator/types";
import { ToolName } from "../../src/types";

function makeCompletedNode(
  id: string,
  description: string,
  result?: string,
): TaskNode {
  return {
    id,
    role: "executor",
    description,
    successCriteria: `${description} verified`,
    allowedTools: [ToolName.READ_PAGE, ToolName.CLICK_ELEMENT, ToolName.DONE],
    dependencies: [],
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status: "completed",
    retries: 0,
    result,
  };
}

function makePendingNode(id: string, description: string): TaskNode {
  return {
    id,
    role: "executor",
    description,
    successCriteria: `${description} verified`,
    allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
    dependencies: [],
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status: "pending",
    retries: 0,
  };
}

describe("buildCompletedStepsSummary", () => {
  test("returns empty string when no completed nodes", () => {
    const nodes = [makePendingNode("n1", "Do something")];
    expect(buildCompletedStepsSummary(nodes)).toBe("");
  });

  test("returns empty string for empty node list", () => {
    expect(buildCompletedStepsSummary([])).toBe("");
  });

  test("formats single completed node", () => {
    const nodes = [
      makeCompletedNode("n1", "Find the hidden code", "Found code ABC123"),
    ];
    const summary = buildCompletedStepsSummary(nodes);
    expect(summary).toContain("Steps completed (1 total):");
    expect(summary).toContain('1. "Find the hidden code"');
    expect(summary).toContain("Found code ABC123");
  });

  test("formats multiple completed nodes in order", () => {
    const nodes = [
      makeCompletedNode("n1", "Step one", "Done step 1"),
      makeCompletedNode("n2", "Step two", "Done step 2"),
      makePendingNode("n3", "Step three"),
    ];
    const summary = buildCompletedStepsSummary(nodes);
    expect(summary).toContain("Steps completed (2 total):");
    expect(summary).toContain('1. "Step one"');
    expect(summary).toContain('2. "Step two"');
    expect(summary).not.toContain("Step three");
  });

  test("truncates long results to 100 chars", () => {
    const longResult = "A".repeat(200);
    const nodes = [makeCompletedNode("n1", "Long result step", longResult)];
    const summary = buildCompletedStepsSummary(nodes);
    // The result portion should be at most 100 chars
    const resultPart = summary.split("→")[1].trim();
    expect(resultPart.length).toBeLessThanOrEqual(100);
  });

  test("caps at last 10 completed nodes with omission note", () => {
    const nodes: TaskNode[] = [];
    for (let i = 0; i < 15; i++) {
      nodes.push(makeCompletedNode(`n${i}`, `Step ${i}`, `Result ${i}`));
    }
    const summary = buildCompletedStepsSummary(nodes);
    expect(summary).toContain("Steps completed (15 total):");
    expect(summary).toContain("[5 earlier steps omitted]");
    // Should show nodes 6-15 (indices 5-14), numbered 6 through 15
    expect(summary).toContain('6. "Step 5"');
    expect(summary).toContain('15. "Step 14"');
    // Should NOT show the first 5
    expect(summary).not.toContain('1. "Step 0"');
  });

  test("uses fallback text when result is undefined", () => {
    const nodes = [makeCompletedNode("n1", "No result step")];
    const summary = buildCompletedStepsSummary(nodes);
    expect(summary).toContain("No detail");
  });

  test("shows error when result is absent but error exists", () => {
    const node = makeCompletedNode("n1", "Failed step");
    node.result = undefined;
    node.error = "Something went wrong";
    const nodes = [node];
    const summary = buildCompletedStepsSummary(nodes);
    expect(summary).toContain("Something went wrong");
  });
});
