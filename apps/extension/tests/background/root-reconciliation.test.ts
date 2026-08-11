import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import { reconcileRootCompletion } from "../../src/background/orchestrator/root-reconciliation";
import type { TaskNode } from "../../src/background/orchestrator/types";

function node(
  id: string,
  description: string,
  result: string,
  status: TaskNode["status"] = "completed",
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

describe("root completion reconciliation", () => {
  const query =
    "For Northstar FC, prepare the safest change for all 18 travelers, but do not purchase or confirm it. Report departure 06:10, arrival 10:42, buffer 1h 48m, and total fee EUR 216.";

  test("settles a redundant final report from grounded prepared-state evidence", () => {
    const completed = node(
      "prepare",
      "Prepare the safest compliant replacement",
      "Northstar FC early train prepared for all 18 travelers: departure 06:10, arrival 10:42, buffer 1h 48m, EUR 216. No purchase or confirmation was made.",
    );
    const report = node(
      "report",
      "Report departure, arrival, buffer, and total fee",
      "",
      "pending",
    );

    expect(
      reconcileRootCompletion({
        query,
        completedNodes: [completed],
        remainingNodes: [report],
        snapshotText:
          "Itinerary change prepared. 06:10 10:42 1h 48m EUR 216. No charge has been made.",
        hasUnresolvedAttempt: false,
      }).decision,
    ).toBe("complete");
  });

  test("does not suppress remaining consequential work", () => {
    const commit = node(
      "commit",
      "Confirm the ticket purchase",
      "",
      "pending",
    );
    expect(
      reconcileRootCompletion({
        query,
        completedNodes: [node("prepare", "Prepare the change", "Prepared")],
        remainingNodes: [commit],
        snapshotText: "Ready for approval",
        hasUnresolvedAttempt: false,
      }).decision,
    ).toBe("continue");
  });

  test("suppresses overlapping preparatory work only after the root contract is grounded", () => {
    const remainingPreparation = node(
      "select-again",
      "Select and prepare the safest compliant replacement",
      "",
      "pending",
    );
    const completeEvidence = {
      query,
      completedNodes: [
        node(
          "prepare",
          "Prepare the safest compliant replacement",
          "Northstar FC early train prepared for all 18 travelers: departure 06:10, arrival 10:42, buffer 1h 48m, EUR 216. No purchase or confirmation was made.",
        ),
      ],
      remainingNodes: [remainingPreparation],
      snapshotText:
        "Itinerary change prepared. 06:10 10:42 1h 48m EUR 216. No charge has been made.",
      hasUnresolvedAttempt: false,
    };

    expect(reconcileRootCompletion(completeEvidence).decision).toBe("complete");
    expect(
      reconcileRootCompletion({
        ...completeEvidence,
        snapshotText: "Itinerary change prepared. No charge has been made.",
        completedNodes: [node("prepare", "Prepare the change", "Prepared")],
      }).decision,
    ).toBe("continue");
  });

  test("does not settle incomplete or contradicted evidence", () => {
    const report = node("report", "Report all requested values", "", "pending");
    expect(
      reconcileRootCompletion({
        query,
        completedNodes: [node("prepare", "Prepare the change", "Ticket purchase confirmed")],
        remainingNodes: [report],
        snapshotText: "Purchase complete",
        hasUnresolvedAttempt: false,
      }).decision,
    ).toBe("continue");

    expect(
      reconcileRootCompletion({
        query,
        completedNodes: [
          node("prepare", "Prepare the change", "Ticket change confirmed"),
        ],
        remainingNodes: [report],
        snapshotText: "Ready for travel",
        hasUnresolvedAttempt: false,
      }).decision,
    ).toBe("continue");
  });
});
