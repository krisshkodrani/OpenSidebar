import { describe, expect, test } from "bun:test";
import "../setup";
import { ToolName } from "../../src/types";
import {
  planSignature,
  shouldRunDeliberation,
  validatePlannerAssignments,
} from "../../src/background/orchestrator/planner";

describe("Orchestrator planner assignment validation", () => {
  test("accepts valid executor assignments", () => {
    const assignments = validatePlannerAssignments([
      {
        role: "executor",
        objective: "Open the checkout page",
        successCriteria: "Checkout page is visible",
        allowedTools: [ToolName.NAVIGATE, ToolName.READ_PAGE, ToolName.DONE],
      },
    ]);

    expect(assignments).toHaveLength(1);
    expect(assignments[0].role).toBe("executor");
    expect(assignments[0].allowedTools.includes(ToolName.DONE)).toBe(true);
    expect(assignments[0].dependencies || []).toEqual([]);
    expect(assignments[0].assumptions || []).toEqual([]);
  });

  test("rejects non-array planner output", () => {
    expect(() => validatePlannerAssignments(null)).toThrow();
  });

  test("rejects assignment with unknown tool", () => {
    expect(() =>
      validatePlannerAssignments([
        {
          role: "executor",
          objective: "Do something",
          successCriteria: "Done",
          allowedTools: ["unknown_tool"],
        },
      ]),
    ).toThrow();
  });

  test("adds done tool if planner omitted it", () => {
    const assignments = validatePlannerAssignments([
      {
        role: "executor",
        objective: "Read page state",
        successCriteria: "Page inspected",
        allowedTools: [ToolName.READ_PAGE],
      },
    ]);

    expect(assignments[0].allowedTools.includes(ToolName.DONE)).toBe(true);
  });

  test("shouldRunDeliberation returns true for complex structured plans", () => {
    expect(
      shouldRunDeliberation({
        subtasks: ["a", "b", "c"],
        steps: [
          {
            objective: "a",
            successCriteria: "a ok",
            dependencies: [],
            assumptions: [],
          },
          {
            objective: "b",
            successCriteria: "b ok",
            dependencies: [0],
            assumptions: [],
          },
          {
            objective: "c",
            successCriteria: "c ok",
            dependencies: [1],
            assumptions: ["state remains stable"],
          },
        ],
      }),
    ).toBe(true);
  });

  test("shouldRunDeliberation returns false for simple short plan", () => {
    expect(
      shouldRunDeliberation({
        subtasks: ["single step"],
      }),
    ).toBe(false);
  });

  test("planSignature is stable for equivalent dependency ordering", () => {
    const a = planSignature({
      subtasks: ["x", "y"],
      steps: [
        {
          objective: "x",
          successCriteria: "done",
          dependencies: [],
          assumptions: ["alpha", "beta"],
        },
        {
          objective: "y",
          successCriteria: "done",
          dependencies: [0],
          assumptions: ["gamma"],
        },
      ],
    });
    const b = planSignature({
      subtasks: ["x", "y"],
      steps: [
        {
          objective: "x",
          successCriteria: "done",
          dependencies: [],
          assumptions: ["beta", "alpha"],
        },
        {
          objective: "y",
          successCriteria: "done",
          dependencies: [0],
          assumptions: ["gamma"],
        },
      ],
    });
    expect(a).toBe(b);
  });
});
