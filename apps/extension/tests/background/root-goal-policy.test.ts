import { describe, expect, test } from "vitest";
import { ToolName, type DomSnapshot } from "../../src/types";
import {
  assessRootGoal,
  assessRootGoalWithDiagnostics,
  shouldAssessRootGoal,
} from "../../src/background/orchestrator/root-goal-policy";
import type { TaskNode } from "../../src/background/orchestrator/types";

function node(
  id: string,
  description: string,
  status: TaskNode["status"],
  result = "",
): TaskNode {
  return {
    id,
    role: "executor",
    description,
    successCriteria: description,
    allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
    dependencies: [],
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status,
    retries: 0,
    result,
  };
}

function snapshot(title: string, visibleContent = title): DomSnapshot {
  return {
    title,
    url: "https://example.com/current",
    visibleContent,
    elements: [],
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0, maxY: 1000, viewportHeight: 800 },
  };
}

describe("root goal policy", () => {
  test("accepts a grounded navigation destination before other gates", () => {
    const nodes = [
      node("open", "Open Settings", "completed", "Settings opened"),
      node("check", "Check Settings", "pending"),
    ];
    expect(shouldAssessRootGoal(nodes)).toBe(true);
    expect(
      assessRootGoal({
        query: "Open Settings",
        nodes,
        snapshot: snapshot("Settings"),
      })?.gate,
    ).toBe("navigation");
  });

  test("accepts grounded prepare-only completion without suppressing a commit", () => {
    const query =
      "For Northstar FC, prepare the safest change for all 18 travelers, but do not purchase or confirm it. Report departure 06:10, arrival 10:42, buffer 1h 48m, and total fee EUR 216.";
    const prepared = node(
      "prepare",
      "Prepare the safest compliant replacement",
      "completed",
      "Northstar FC early train prepared for all 18 travelers: departure 06:10, arrival 10:42, buffer 1h 48m, EUR 216. No purchase or confirmation was made.",
    );
    const page = snapshot(
      "Itinerary",
      "Itinerary change prepared. 06:10 10:42 1h 48m EUR 216. No charge has been made.",
    );
    expect(
      assessRootGoal({
        query,
        nodes: [prepared, node("report", "Report the values", "pending")],
        snapshot: page,
      })?.gate,
    ).toBe("reconciliation");
    expect(
      assessRootGoal({
        query,
        nodes: [prepared, node("commit", "Confirm the purchase", "pending")],
        snapshot: page,
      }),
    ).toBeNull();
  });

  test("accepts a conservative final read-only criteria match", () => {
    const first = node(
      "read",
      "Read dashboard metrics",
      "completed",
      "Traffic is strongest: users up 12%, revenue up 8%, traffic up 15%.",
    );
    const final = node("report", "Report the strongest area", "pending");
    final.successCriteria =
      "Final answer identifies traffic as the strongest area based on both tabs.";
    expect(
      assessRootGoal({
        query:
          "Which area looks strongest based on both tabs? Give a brief answer referencing the data.",
        nodes: [first, final],
        snapshot: snapshot(
          "Dashboard",
          "Traffic is the strongest area based on both tabs: users up 12%, revenue up 8%, traffic up 15%.",
        ),
      })?.gate,
    ).toBe("criteria");
  });

  test("does not assess unresolved attempts or a round trip without return evidence", () => {
    const completed = node(
      "read",
      "Read Warehouse Gamma",
      "completed",
      "Gamma has 12 items",
    );
    const pending = node("report", "Report Gamma inventory", "pending");
    pending.retries = 1;
    expect(shouldAssessRootGoal([completed, pending])).toBe(false);
    expect(
      assessRootGoal({
        query: "Report Gamma inventory",
        nodes: [completed, pending],
        snapshot: snapshot("Gamma", "Gamma has 12 items"),
      }),
    ).toBeNull();
    pending.retries = 0;
    expect(
      assessRootGoal({
        query:
          "Go to Warehouse Gamma, then return to Warehouse Alpha and report both inventory counts.",
        nodes: [completed, pending],
        snapshot: snapshot("Gamma", "Gamma has 12 items"),
      }),
    ).toBeNull();
  });

  test("retains a rejected reconciliation reason for the trace", () => {
    const nodes = [
      node("read", "Read the dashboard", "completed", "Dashboard opened"),
      node("report", "Report the dashboard result", "pending"),
    ];
    expect(assessRootGoalWithDiagnostics({
      query: "Report the dashboard result",
      nodes,
      snapshot: snapshot("Unrelated page"),
    })).toMatchObject({
      decision: null,
      reconciliation: { decision: "continue", reason: "not_prepare_only" },
    });
  });
});
