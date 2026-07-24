/**
 * Tool-batch policy — bounds on how much work a single LLM response can queue.
 *
 * Two guards (issue #117, session d52353c1: a repetition-looping executor
 * emitted 593 tool calls in one response; the loop executed 146 sequentially,
 * grounding rejected 447 more, and the resulting history spike triggered heavy
 * compaction that erased the failure evidence before the next turn):
 *
 * 1. `clampToolCallBatch` — hard cap on tool calls per response, applied
 *    BEFORE the assistant message is recorded, so dropped calls never enter
 *    history and need no per-call tool replies.
 * 2. `assessGroundingRejectionAbort` — sequential dispatch aborts the rest of
 *    a batch after N consecutive grounding rejections; the model is
 *    enumerating ids that do not exist and the remainder cannot succeed.
 *    (Parallel batches are covered by the clamp alone: they are independent
 *    read-only calls and each rejection already answers its own call.)
 */

import type { ToolCall } from "../../types";

export interface ClampedToolCallBatch {
  kept: ToolCall[];
  droppedCount: number;
}

/** Truncate a tool-call batch to `maxCalls`, preserving order. */
export function clampToolCallBatch(
  toolCalls: ToolCall[],
  maxCalls: number,
): ClampedToolCallBatch {
  if (toolCalls.length <= maxCalls) {
    return { kept: toolCalls, droppedCount: 0 };
  }
  return {
    kept: toolCalls.slice(0, maxCalls),
    droppedCount: toolCalls.length - maxCalls,
  };
}

/** Feedback injected when a batch was truncated, so the model knows the tail
 *  was not silently executed and re-issues only what still matters. */
export function buildBatchTruncationNotice(
  droppedCount: number,
  maxCalls: number,
): string {
  return (
    `TOOL BATCH TRUNCATED: your last response contained too many tool calls; ` +
    `only the first ${maxCalls} were considered and the remaining ${droppedCount} were discarded unexecuted. ` +
    `Emit a few targeted tool calls per turn. If you were enumerating elements, ` +
    `call read_page once instead — it returns the full visible element list.`
  );
}

/**
 * Track consecutive grounding rejections inside one batch. Call
 * `recordRejection()` when the element-id pre-dispatch check fails (returns
 * true once the threshold is reached — the dispatcher should stub out the
 * remaining calls and stop) and `recordPass()` when a call passes it.
 */
export class GroundingRejectionAbortTracker {
  private consecutive = 0;

  constructor(private readonly threshold: number) {}

  recordRejection(): boolean {
    this.consecutive += 1;
    return this.consecutive >= this.threshold;
  }

  recordPass(): void {
    this.consecutive = 0;
  }

  get consecutiveRejections(): number {
    return this.consecutive;
  }
}

/** Tool reply recorded for each call skipped by a grounding abort — every
 *  tool call already in the recorded assistant message must get a reply. */
export function buildGroundingAbortStub(threshold: number): string {
  return (
    `Not executed: batch aborted after ${threshold} consecutive invalid element ids. ` +
    `The ids you are using do not exist on the current page. ` +
    `Call read_page to re-ground, then act on ids from the fresh element list.`
  );
}
