import { describe, expect, test } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import {
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
});
