import { describe, expect, test, vi } from "vitest";
import { AgentStatus, ToolName } from "../../src/types";
import {
  PendingInteractionYield,
  runStartExecution,
} from "../../src/background/agent/start-result";
import type { PendingApprovalInteraction } from "../../src/background/agent/loop-types";

function makeDeps(overrides = {}) {
  const broadcasts: unknown[] = [];
  const statuses: unknown[] = [];
  return {
    run: vi.fn(),
    getTurnCount: vi.fn(() => 4),
    nodeId: "node-1",
    log: { info: vi.fn(), error: vi.fn() },
    getMetrics: vi.fn(() => ({ turns: 4 })),
    broadcast: (message: unknown) => broadcasts.push(message),
    finishStream: vi.fn(),
    statusHandler: (status: AgentStatus, detail: string) =>
      statuses.push({ status, detail }),
    broadcasts,
    statuses,
    ...overrides,
  };
}

describe("runStartExecution", () => {
  test("maps pending approval yields into awaiting approval results", async () => {
    const interaction: PendingApprovalInteraction = {
      kind: "approval",
      nodeId: "node-1",
      requestedAt: 100,
      approvalId: "approval-1",
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 1 },
      context: "Click submit",
      timeoutMs: 1000,
    };
    const deps = makeDeps({
      run: vi.fn(async () => {
        throw new PendingInteractionYield(interaction);
      }),
    });

    const result = await runStartExecution(deps);

    expect(result.outcome).toBe("awaiting_approval");
    expect(result.summary).toBe("Awaiting approval");
    expect(result.pendingInteraction).toBe(interaction);
    expect(deps.log.info).toHaveBeenCalledWith(
      "agent",
      "Loop yielded for user interaction",
      expect.objectContaining({ outcome: "awaiting_approval" }),
    );
  });

  test("maps abort errors into stopped results", async () => {
    const getCompletedResult = vi.fn(() => ({
      summary: "Stale terminal completion",
    }));
    const deps = makeDeps({
      getCompletedResult,
      run: vi.fn(async () => {
        throw new DOMException("Stop requested", "AbortError");
      }),
    });

    const result = await runStartExecution(deps);

    expect(result.outcome).toBe("stopped");
    expect(result.failure?.code).toBe("user_stopped");
    expect(deps.statuses).toEqual([
      { status: AgentStatus.IDLE, detail: "Stopped" },
    ]);
    expect(getCompletedResult).not.toHaveBeenCalled();
  });

  test("preserves terminal completion when cleanup throws after done", async () => {
    const completionEnvelope = {
      status: "completed" as const,
      resultId: "completion-after-done-error",
      source: "model_done" as const,
      contractKind: "workflow_confirmation",
      decisionReason: "done accepted before cleanup error",
      evidenceKeys: ["workflow:confirmation:done"],
      evidenceEpoch: "turn:4",
    };
    const deps = makeDeps({
      getCompletedResult: vi.fn(() => ({
        summary: "Accepted before cleanup failed.",
        completionEnvelope,
      })),
      run: vi.fn(async () => {
        throw new Error("trace flush failed");
      }),
    });

    const result = await runStartExecution(deps);

    expect(result).toMatchObject({
      outcome: "completed",
      turnCount: 4,
      summary: "Accepted before cleanup failed.",
      failure: { category: "none", code: "none" },
      completionEnvelope,
    });
    expect(deps.log.error).not.toHaveBeenCalled();
    expect(deps.broadcasts).toEqual([]);
  });

  test("maps runtime errors into streamed error results", async () => {
    let turnCount = 0;
    const deps = makeDeps({
      getTurnCount: vi.fn(() => turnCount),
      run: vi.fn(async () => {
        turnCount = 2;
        throw new Error("boom");
      }),
    });

    const result = await runStartExecution(deps);

    expect(result.outcome).toBe("error");
    expect(result.turnCount).toBe(2);
    expect(result.summary).toBe("boom");
    expect(deps.broadcasts).toEqual([
      {
        type: "STREAM_CHUNK",
        payload: {
          delta: "",
          done: false,
          replaceContent:
            "Agent stopped: boom. Send a follow-up message to retry.",
        },
      },
    ]);
    expect(deps.finishStream).toHaveBeenCalled();
  });
});
