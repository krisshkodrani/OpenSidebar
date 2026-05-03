import { describe, expect, test } from "vitest";
import { buildConsequentialActionTaskText } from "../../src/background/agent/consequential-action-context";

describe("consequential action context", () => {
  test("uses the active plan status index first", () => {
    expect(
      buildConsequentialActionTaskText({
        planStatus: { currentIndex: 1 },
        planSubtasks: [
          { description: "Old task", status: "done" },
          { description: "Fill the job application", status: "pending" },
        ],
        planSteps: [
          { objective: "Old objective", successCriteria: "Old success" },
          {
            objective: "Prepare the application",
            successCriteria: "Wait for final approval",
          },
        ],
        lastPlanIndex: 0,
        originalQuery: "",
      }),
    ).toBe(
      "fill the job application\nprepare the application\nwait for final approval",
    );
  });

  test("falls back to the running subtask when plan status has no index", () => {
    expect(
      buildConsequentialActionTaskText({
        planStatus: null,
        planSubtasks: [
          { description: "Search docs", status: "done" },
          { description: "Review job application", status: "running" },
        ],
        planSteps: [
          { objective: "Search", successCriteria: "Found docs" },
          { objective: "Verify values", successCriteria: "Ready to submit" },
        ],
        lastPlanIndex: 0,
        originalQuery: "",
      }),
    ).toBe("review job application\nverify values\nready to submit");
  });

  test("includes current objective and original request from planner text", () => {
    expect(
      buildConsequentialActionTaskText({
        planStatus: null,
        planSubtasks: [],
        planSteps: [],
        lastPlanIndex: 0,
        originalQuery:
          "Original user request:\nFill the job application but wait for approval.\n\n## Current Task\nObjective: Prepare the form",
      }),
    ).toBe(
      "prepare the form\nfill the job application but wait for approval.",
    );
  });
});
