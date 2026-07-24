import { describe, expect, test } from "vitest";
import { ToolName, type ToolCall } from "../../src/types";
import { TOOL_BATCH_LIMITS } from "../../src/background/agent/constants";
import {
  buildBatchTruncationNotice,
  buildGroundingAbortStub,
  clampToolCallBatch,
  GroundingRejectionAbortTracker,
} from "../../src/background/agent/tool-batch-policy";

function makeCalls(count: number): ToolCall[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `call_${i}`,
    type: "function" as const,
    function: {
      name: ToolName.READ_ELEMENT,
      arguments: JSON.stringify({ id: i }),
    },
  }));
}

describe("clampToolCallBatch", () => {
  test("passes small batches through untouched", () => {
    const calls = makeCalls(5);
    const clamped = clampToolCallBatch(calls, 25);
    expect(clamped.kept).toBe(calls);
    expect(clamped.droppedCount).toBe(0);
  });

  test("passes a batch exactly at the cap through untouched", () => {
    const calls = makeCalls(25);
    expect(clampToolCallBatch(calls, 25).droppedCount).toBe(0);
  });

  test("truncates an oversized batch in order (issue #117: 593-call turn)", () => {
    const calls = makeCalls(593);
    const clamped = clampToolCallBatch(calls, 25);
    expect(clamped.kept).toHaveLength(25);
    expect(clamped.droppedCount).toBe(568);
    expect(clamped.kept[0].id).toBe("call_0");
    expect(clamped.kept[24].id).toBe("call_24");
  });

  test("truncation notice states kept and dropped counts", () => {
    const notice = buildBatchTruncationNotice(568, 25);
    expect(notice).toContain("first 25");
    expect(notice).toContain("568");
  });
});

describe("GroundingRejectionAbortTracker", () => {
  test("counts consecutive rejections and aborts at the threshold", () => {
    const tracker = new GroundingRejectionAbortTracker(5);
    for (let i = 0; i < 4; i++) {
      expect(tracker.recordRejection()).toBe(false);
    }
    expect(tracker.recordRejection()).toBe(true);
    expect(tracker.consecutiveRejections).toBe(5);
  });

  test("a passing call resets the consecutive counter", () => {
    const tracker = new GroundingRejectionAbortTracker(5);
    tracker.recordRejection();
    tracker.recordRejection();
    tracker.recordRejection();
    tracker.recordRejection();
    tracker.recordPass();
    expect(tracker.consecutiveRejections).toBe(0);
    expect(tracker.recordRejection()).toBe(false);
  });

  test("interleaved passes keep the batch alive indefinitely", () => {
    const tracker = new GroundingRejectionAbortTracker(2);
    for (let i = 0; i < 10; i++) {
      expect(tracker.recordRejection()).toBe(false);
      tracker.recordPass();
    }
  });

  test("abort stub tells the model to re-ground", () => {
    const stub = buildGroundingAbortStub(5);
    expect(stub).toContain("Not executed");
    expect(stub).toContain("read_page");
  });
});

describe("TOOL_BATCH_LIMITS", () => {
  test("cap clears every legitimate batch size observed in traces (1-15)", () => {
    expect(TOOL_BATCH_LIMITS.MAX_CALLS_PER_TURN).toBeGreaterThanOrEqual(15);
  });

  test("grounding abort trips well inside one runaway batch", () => {
    expect(TOOL_BATCH_LIMITS.GROUNDING_ABORT_CONSECUTIVE).toBeLessThan(
      TOOL_BATCH_LIMITS.MAX_CALLS_PER_TURN,
    );
  });
});
