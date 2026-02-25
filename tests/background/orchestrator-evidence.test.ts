import { describe, expect, test } from "vitest";
import "../setup";
import {
  buildVerifierContext,
  formatEvidenceChain,
  formatPlannerReflexionContext,
} from "../../src/background/orchestrator/handoff";
import {
  PlannerReflexionEntry,
  StructuredEvidence,
  TaskNode,
} from "../../src/background/orchestrator/types";
import { ToolName } from "../../src/types";

function makeNode(
  overrides: Partial<TaskNode> = {},
): TaskNode {
  return {
    id: "node-1",
    role: "executor",
    description: "Fill checkout form",
    successCriteria: "Checkout form submitted",
    allowedTools: [ToolName.READ_PAGE, ToolName.TYPE_TEXT, ToolName.DONE],
    dependencies: [],
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status: "pending",
    retries: 0,
    ...overrides,
  };
}

describe("StructuredEvidence", () => {
  test("formatEvidenceChain formats a single evidence entry", () => {
    const evidence: StructuredEvidence[] = [
      {
        claim: "Checkout form was submitted successfully",
        basis: "tool_output",
        confidence: 1.0,
        sourceToolCall: "click_element",
      },
    ];
    const result = formatEvidenceChain(evidence);
    expect(result).toContain("[tool_output]");
    expect(result).toContain("Checkout form was submitted successfully");
    expect(result).toContain("confidence=1.00");
    expect(result).toContain("source: click_element");
  });

  test("formatEvidenceChain handles multiple entries", () => {
    const evidence: StructuredEvidence[] = [
      {
        claim: "Page loaded",
        basis: "observation",
        confidence: 0.9,
      },
      {
        claim: "Button clicked",
        basis: "tool_output",
        confidence: 1.0,
        sourceToolCall: "click_element",
        turnNumber: 3,
      },
    ];
    const result = formatEvidenceChain(evidence);
    expect(result).toContain("[observation]");
    expect(result).toContain("[tool_output]");
    expect(result.split("\n").length).toBeGreaterThanOrEqual(2);
  });

  test("formatEvidenceChain returns empty string for no evidence", () => {
    expect(formatEvidenceChain([])).toBe("");
  });

  test("buildVerifierContext includes evidence chain from handoff artifacts", () => {
    const node = makeNode({
      handoffArtifacts: [
        {
          role: "executor",
          phase: "executor_finished",
          note: "Executor completed task.",
          timestamp: 100,
          evidence: [
            {
              claim: "Form submitted",
              basis: "tool_output",
              confidence: 1.0,
            },
          ],
        },
      ],
    });
    const context = buildVerifierContext(
      node,
      "- [completed] Prior node :: Done",
    );
    expect(context).toContain("Structured evidence chain:");
    expect(context).toContain("[tool_output]");
    expect(context).toContain("Form submitted");
  });

  test("buildVerifierContext omits evidence section when no evidence", () => {
    const node = makeNode({
      handoffArtifacts: [
        {
          role: "planner",
          phase: "planned",
          note: "Planned.",
          timestamp: 1,
        },
      ],
    });
    const context = buildVerifierContext(node, "No sibling context.");
    expect(context).not.toContain("Structured evidence chain:");
  });
});

describe("PlannerReflexionContext", () => {
  test("formatPlannerReflexionContext formats entries", () => {
    const entries: PlannerReflexionEntry[] = [
      {
        nodeId: "abcdef12-3456-7890-abcd-ef1234567890",
        verifierDecision: "retry",
        failureType: "insufficient_evidence",
        executorSummary: "Clicked submit but no confirmation appeared.",
        plannerLesson: "Should verify page state before submit.",
        timestamp: Date.now(),
      },
    ];
    const result = formatPlannerReflexionContext(entries);
    expect(result).toContain("Node abcdef12");
    expect(result).toContain("verifier retry");
    expect(result).toContain("Failure type: insufficient_evidence");
    expect(result).toContain("Lesson: Should verify page state before submit.");
  });

  test("formatPlannerReflexionContext returns empty for no entries", () => {
    expect(formatPlannerReflexionContext([])).toBe("");
  });

  test("formatPlannerReflexionContext limits to 5 most recent", () => {
    const entries: PlannerReflexionEntry[] = Array.from({ length: 8 }, (_, i) => ({
      nodeId: `node-${i}-xxxx-xxxx-xxxx-xxxxxxxxxxxx`,
      verifierDecision: "retry" as const,
      executorSummary: `Attempt ${i} failed.`,
      plannerLesson: "",
      timestamp: Date.now() + i,
    }));
    const result = formatPlannerReflexionContext(entries);
    // Should only have entries 3-7 (last 5)
    expect(result).not.toContain("node-0-x");
    expect(result).not.toContain("node-2-x");
    expect(result).toContain("node-3-x");
    expect(result).toContain("node-7-x");
  });
});
