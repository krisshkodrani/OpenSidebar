import { describe, expect, test, vi } from "vitest";
import { ToolName } from "../../src/types";
import { finalizeStartResult } from "../../src/background/agent/start-finalization";
import type { LoopResult } from "../../src/background/agent/loop-types";

function makeDeps(result: LoopResult, overrides = {}) {
  return {
    result,
    tabId: 7,
    initialScrollY: null,
    taskId: null,
    planSubtasks: [],
    mutationLedger: {
      sideEffects: [
        {
          id: "side-effect-1",
          turn: 1,
          planIndex: 0,
          toolName: ToolName.CLICK_ELEMENT,
          args: { id: 1 },
          result: "clicked",
          timestamp: 1000,
          snapshotFingerprint: "snapshot-1",
        },
      ],
    },
    evidenceAccumulator: {
      toArray: () => [
        {
          type: "navigation_completed",
          source: "tool",
          detail: { url: "https://example.test" },
        },
      ],
    },
    context: {
      getMessages: () => [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: ToolName.CLICK_ELEMENT,
                arguments: JSON.stringify({ id: 1 }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          content: "Clicked submit",
        },
      ],
    },
    traceRecorder: {
      recordEvent: vi.fn(),
      finalize: vi.fn(async () => {}),
    },
    toolCache: {
      getStats: () => ({ hits: 2, misses: 1 }),
    },
    clearTurnCheckpoint: vi.fn(async () => {}),
    broadcastPlanTermination: vi.fn(),
    scrollContentScript: vi.fn(async () => undefined),
    setRunning: vi.fn(),
    clearTraceRecorder: vi.fn(),
    ...overrides,
  };
}

describe("finalizeStartResult", () => {
  test("attaches terminal artifacts, clears checkpoint, and finalizes trace", async () => {
    const result: LoopResult = {
      outcome: "completed",
      turnCount: 3,
      summary: "Done",
      metrics: { turns: 3 },
    };
    const deps = makeDeps(result);

    await finalizeStartResult(deps);

    expect(result.sideEffectsLog).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.trajectory).toHaveLength(1);
    expect(result.trajectory?.[0]).toContain("click_element [1]");
    expect(result.trajectory?.[0]).toContain("Clicked submit");
    expect(deps.clearTurnCheckpoint).toHaveBeenCalled();
    expect(deps.setRunning).toHaveBeenCalledWith(false);
    expect(deps.traceRecorder.recordEvent).toHaveBeenCalledWith(
      "tool_cache_stats",
      { hits: 2, misses: 1 },
    );
    expect(deps.traceRecorder.finalize).toHaveBeenCalledWith(
      "completed",
      "Done",
      3,
      null,
      { turns: 3 },
    );
    expect(deps.clearTraceRecorder).toHaveBeenCalled();
  });

  test("omits Chrome-specific tool args from replay trajectory summaries", async () => {
    const result: LoopResult = {
      outcome: "completed",
      turnCount: 1,
      summary: "Switched tabs",
    };
    const deps = makeDeps(result, {
      context: {
        getMessages: () => [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: ToolName.SWITCH_TAB,
                  arguments: JSON.stringify({
                    tabId: 123,
                    chromeTabId: 456,
                    storageKey: "chrome.storage.local",
                  }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call-1",
            content: "Switched to project page",
          },
        ],
      },
    });

    await finalizeStartResult(deps);

    const trajectory = result.trajectory?.join("\n") ?? "";
    expect(trajectory).toContain("switch_tab");
    expect(trajectory).toContain("Switched to project page");
    expect(trajectory).not.toContain("tabId");
    expect(trajectory).not.toContain("chromeTabId");
    expect(trajectory).not.toContain("chrome.storage");
    expect(trajectory).not.toContain("123");
    expect(trajectory).not.toContain("456");
  });

  test("preserves pending interaction checkpoints and does not finalize as plan failure", async () => {
    const result: LoopResult = {
      outcome: "awaiting_approval",
      turnCount: 1,
      summary: "Awaiting approval",
      pendingInteraction: {
        kind: "approval",
        nodeId: "node-1",
        requestedAt: 1000,
        approvalId: "approval-1",
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 1 },
        context: "Click submit",
        timeoutMs: 1000,
      },
    };
    const deps = makeDeps(result, {
      taskId: "task-1",
      planSubtasks: [{ id: "step-1", title: "Submit", status: "running" }],
    });

    await finalizeStartResult(deps);

    expect(deps.clearTurnCheckpoint).not.toHaveBeenCalled();
    expect(deps.broadcastPlanTermination).not.toHaveBeenCalled();
    expect(deps.setRunning).toHaveBeenCalledWith(false);
  });

  test("broadcasts active plan termination for non-completed terminal outcomes", async () => {
    const result: LoopResult = {
      outcome: "error",
      turnCount: 2,
      summary: "boom",
      failure: { category: "runtime", code: "runtime_error" },
    };
    const deps = makeDeps(result, {
      taskId: "task-1",
      planSubtasks: [{ id: "step-1", title: "Submit", status: "running" }],
    });

    await finalizeStartResult(deps);

    expect(deps.broadcastPlanTermination).toHaveBeenCalledWith(
      "error",
      "boom",
    );
  });
});
