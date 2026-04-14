import { describe, expect, test } from "vitest";
import { Orchestrator } from "../../src/background/orchestrator";
import type { TaskCompletionMessage } from "../../src/types/messages";

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
