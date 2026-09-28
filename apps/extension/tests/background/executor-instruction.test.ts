import { describe, expect, test, vi } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { prepareExecutorInstruction } from "../../src/background/orchestrator/executor-instruction";
import type { OrchestratorTask, TaskNode } from "../../src/background/orchestrator/types";

function node(id: string, status: TaskNode["status"]): TaskNode {
  return {
    id,
    role: "executor",
    description: `Do ${id}`,
    successCriteria: `${id} done`,
    allowedTools: [ToolName.DONE],
    dependencies: [],
    assumptions: [],
    handoffArtifacts: [],
    reflexionLog: [],
    handoffDepth: 0,
    status,
    retries: 0,
  };
}

describe("executor instruction", () => {
  test("includes same-tab predecessor history and verifier advice", async () => {
    const predecessor = node("first", "completed");
    predecessor.trajectory = ["Clicked the cart button"];
    const current = node("second", "pending");
    current.dependencies = ["first"];
    current.retries = 1;
    const task = {
      id: "task-1",
      query: "Finish checkout",
      nodes: [predecessor, current],
      conversationContextBrief: "The user chose standard shipping.",
    } as OrchestratorTask;
    const runAdvisory = vi.fn(async () => "Verify the cart before continuing.");
    const emitAdvisoryTrace = vi.fn();

    const instruction = await prepareExecutorInstruction({
      task,
      node: current,
      taskStateBrief: "First step complete.",
      driftSignal: "No drift signal recorded.",
      verificationTurnMode: false,
      workerIndex: 1,
      nodeTabMap: new Map([["first", 101]]),
      tabId: 101,
      runAdvisory,
      emitAdvisoryTrace,
    });

    expect(instruction).toContain("Recent workspace conversation:");
    expect(instruction).toContain("Clicked the cart button");
    expect(instruction).toContain("Pre-execution advisory:\nVerify the cart before continuing.");
    expect(runAdvisory).toHaveBeenCalledOnce();
    expect(current.handoffArtifacts.at(-1)?.phase).toBe("verifier_advisory");
    expect(emitAdvisoryTrace).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "second", retries: 1 }),
    );
  });

  test("excludes history from another tab", async () => {
    const predecessor = node("first", "completed");
    predecessor.trajectory = ["Edited another tab"];
    const current = node("second", "pending");
    current.dependencies = ["first"];
    const task = {
      id: "task-2",
      query: "Continue",
      nodes: [predecessor, current],
    } as OrchestratorTask;

    const instruction = await prepareExecutorInstruction({
      task,
      node: current,
      taskStateBrief: "",
      driftSignal: "",
      verificationTurnMode: false,
      workerIndex: 1,
      nodeTabMap: new Map([["first", 202]]),
      tabId: 101,
      emitAdvisoryTrace: vi.fn(),
    });

    expect(instruction).not.toContain("Edited another tab");
  });
});
