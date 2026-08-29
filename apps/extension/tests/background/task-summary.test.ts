import { describe, expect, test } from "vitest";
import "../setup";
import { buildProgrammaticSummary } from "../../src/background/orchestrator/task-summary";
import { emptySessionMetrics } from "../../src/background/orchestrator/sanitizers";
import type {
  OrchestratorTask,
  TaskNode,
} from "../../src/background/orchestrator/types";
import { ToolName } from "../../src/types";

function node(
  id: string,
  result: string,
  description = `Complete ${id}`,
): TaskNode {
  return {
    id,
    role: "executor",
    description,
    successCriteria: `${id} is verified`,
    allowedTools: [ToolName.DONE],
    dependencies: [],
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status: "completed",
    retries: 0,
    result,
    userFacingResult: result,
  };
}

function task(query: string, nodes: TaskNode[]): OrchestratorTask {
  return {
    id: "task-1",
    workspaceId: "workspace-1",
    rootTabId: 1,
    query,
    status: "completed",
    createdAt: 1,
    nodes,
    plannerReflexionLog: [],
    maxWorkers: 3,
    maxReplans: 2,
    replansUsed: 0,
    horizonExpansions: 0,
    currentIndex: nodes.length,
    sessionMetrics: emptySessionMetrics(),
    budget: {
      maxSessionTimeMs: 60_000,
      maxTotalTokens: 100_000,
      maxTotalCostUsd: 1,
    },
    tabCoordination: {
      primaryTabId: 1,
      ownedTabs: [],
      nodeBindings: {},
    },
  };
}

describe("programmatic task summary", () => {
  test("does not concatenate intermediate narration on a restricted-disclosure task", () => {
    const summary = buildProgrammaticSummary(
      task("Export the overdue IDs and do not disclose unrelated records.", [
        node(
          "open",
          "Opened the workflow. Unrelated records were REC-0991 and REC-1204.",
        ),
        node(
          "finish",
          "Root-answer evidence: REC-1042, REC-1077, REC-1113, REC-1148. Export completed.",
        ),
      ]),
    );

    expect(summary).toContain("REC-1042");
    expect(summary).not.toContain("REC-0991");
    expect(summary).not.toContain("Opened the workflow");
  });

  test("recovers safe requested identifiers when the final workflow summary omits them", () => {
    const summary = buildProgrammaticSummary(
      task(
        "Export the overdue record IDs and do not disclose unrelated records.",
        [
          node(
            "identify",
            "Overdue IDs: REC-1042, REC-1077, REC-1113, REC-1148.\nCurrent IDs: REC-0991, REC-1204.",
          ),
          node(
            "finish",
            "The safe export workflow completed successfully with status complete.",
          ),
        ],
      ),
    );

    expect(summary).toContain(
      "Requested identifiers: REC-1042, REC-1077, REC-1113, REC-1148",
    );
    expect(summary).toContain("workflow completed successfully");
    expect(summary).not.toContain("REC-0991");
    expect(summary).not.toContain("REC-1204");
  });

  test("synthesizes replanned nodes even when the initial plan was classified as single-node", () => {
    const replannedTask = task(
      "Export the overdue record IDs and do not disclose unrelated records.",
      [
        node(
          "identify",
          "Overdue IDs: REC-1042, REC-1077, REC-1113, REC-1148.",
        ),
        node("finish", "The safe export workflow completed successfully."),
      ],
    );
    replannedTask.planClassification = {
      isSingleNode: true,
      difficulty: "simple",
    };

    const summary = buildProgrammaticSummary(replannedTask);

    expect(summary).toContain(
      "Requested identifiers: REC-1042, REC-1077, REC-1113, REC-1148",
    );
    expect(summary).toContain("workflow completed successfully");
  });

  test("preserves verifier-accepted evidence after replanning replaces its node", () => {
    const replannedTask = task(
      "Export the overdue record IDs and do not disclose unrelated records.",
      [node("finish", "The safe export workflow completed successfully.")],
    );
    replannedTask.verifierAcceptedResults = [
      {
        nodeId: "replaced-identify-node",
        result:
          "Overdue IDs: REC-1042, REC-1077, REC-1113, REC-1148. Current IDs: REC-0991, REC-1204.",
        acceptedAt: 1,
      },
      {
        nodeId: "finish",
        result: "The safe export workflow completed successfully.",
        acceptedAt: 2,
      },
    ];

    const summary = buildProgrammaticSummary(replannedTask);

    expect(summary).toContain(
      "Requested identifiers: REC-1042, REC-1077, REC-1113, REC-1148",
    );
    expect(summary).toContain("workflow completed successfully");
    expect(summary).not.toContain("REC-0991");
    expect(summary).not.toContain("REC-1204");
  });

  test("replaces a truncated final identifier with complete verified evidence", () => {
    const summary = buildProgrammaticSummary(
      task("Export the overdue record IDs without showing unrelated records.", [
        node(
          "identify",
          "Overdue IDs: REC-1042, REC-1077, REC-1113, REC-1148.",
        ),
        node(
          "finish",
          "Exported REC-1042, REC-1077, REC-1113, REC-114. Workflow complete.",
        ),
      ]),
    );

    expect(summary).toContain("REC-1148");
    expect(summary).not.toMatch(/REC-114(?:\D|$)/);
  });

  test("adds only verified prior results that close a root coverage gap", () => {
    const summary = buildProgrammaticSummary(
      task("Tell me both inventory numbers for Gamma and Alpha.", [
        node("alpha", "Alpha inventory is 12 units."),
        node("noise", "Opened the comparison page."),
        node("gamma", "Gamma inventory is 18 units."),
      ]),
    );

    expect(summary).toContain("Gamma inventory is 18 units.");
    expect(summary).toContain("Verified supporting evidence:");
    expect(summary).toContain("Alpha inventory is 12 units.");
    expect(summary).not.toContain("Opened the comparison page.");
  });
});
