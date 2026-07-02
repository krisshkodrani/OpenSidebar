import { describe, expect, test } from "vitest";
import {
  Orchestrator,
  buildOrchestratorProgrammaticSummary,
} from "../../src/background/orchestrator";
import type { TaskCompletionMessage } from "../../src/types/messages";
import { ToolName } from "../../src/types";

function makeCompletionPayload(): TaskCompletionMessage["payload"] {
  return {
    taskId: "task-1",
    status: "completed",
    totalTurnsUsed: 3,
    totalTimeMs: 1_500,
    summary: "Completed successfully",
    subtaskResults: [],
    urlHistory: [],
  };
}

describe("Orchestrator.waitForTaskCompletion", () => {
  test("resolves when a completion payload is cached", async () => {
    const orchestrator = new Orchestrator();
    const payload = makeCompletionPayload();

    (orchestrator as any).tasksByWorkspace.set("ws-1", { status: "running" });
    const waiter = orchestrator.waitForTaskCompletion("ws-1", 5_000);

    (orchestrator as any).cacheAndPersistCompletion("ws-1", payload);

    await expect(waiter).resolves.toEqual(payload);
  });

  test("returns cached completion immediately", async () => {
    const orchestrator = new Orchestrator();
    const payload = makeCompletionPayload();

    (orchestrator as any).cacheAndPersistCompletion("ws-2", payload);

    await expect(orchestrator.waitForTaskCompletion("ws-2")).resolves.toEqual(
      payload,
    );
  });
});

describe("buildOrchestratorProgrammaticSummary", () => {
  test("prefers unresolved multi-node failure over completed setup progress", () => {
    const summary = buildOrchestratorProgrammaticSummary({
      planClassification: { isSingleNode: false, difficulty: "moderate" },
      nodes: [
        {
          id: "node-setup",
          role: "executor",
          description: "Open the search page",
          successCriteria: "Search page is loaded",
          allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
          dependencies: [],
          assumptions: [],
          handoffArtifacts: [],
          reflexionLog: [],
          handoffDepth: 0,
          status: "completed",
          retries: 0,
          result: "Search page loaded successfully.",
        },
        {
          id: "node-answer",
          role: "executor",
          description: "Extract the requested answer from the results",
          successCriteria: "The requested answer is reported",
          allowedTools: [ToolName.READ_PAGE, ToolName.DONE],
          dependencies: ["node-setup"],
          assumptions: [],
          handoffArtifacts: [],
          reflexionLog: [],
          handoffDepth: 0,
          status: "failed",
          retries: 0,
          error: "Could not find the requested answer.",
        },
      ],
    });

    expect(summary).toContain("Task incomplete.");
    expect(summary).toContain(
      "Unresolved step: Extract the requested answer from the results",
    );
    expect(summary).toContain("Could not find the requested answer.");
    expect(summary).toContain("Completed progress:");
    expect(summary).toContain("Search page loaded successfully.");
  });
});
