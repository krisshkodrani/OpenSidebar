/**
 * E2E: Continuation — Verify After Action (self-check).
 *
 * Tests the "did it work?" pattern that ends almost every real session.
 * The agent performs an action, then the user asks it to verify
 * the result by reading back what happened.
 *
 * Turn 1: Set ticket to In Progress + add a comment
 * Turn 2: Did the comment post? What does the activity feed show?
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/continuation-verify.test.ts
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { createE2EHarness } from "./helpers/harness";
import {
  assertNoGhostSession,
  clearMonitoredEvents,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { findAllNewTraceFiles, readTrace } from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 12, testLabel: "verify" });

const TURN_TIMEOUT = 180_000;

/** Extract the done() message from trace files */
function extractDoneMessage(traceFiles: string[]): string {
  for (const f of traceFiles) {
    const turns = readTrace(f);
    for (const t of turns) {
      for (const tc of (t as any).toolCalls ?? []) {
        if (tc.name === "done" && tc.args?.message) {
          return tc.args.message;
        }
      }
    }
  }
  return "";
}

describe.skipIf(!h.apiKey)("E2E: Continuation — Verify After Action", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("verify"));
  afterAll(() => h.afterAllHook());

  it("performs an action then verifies the result on request", async () => {
    await navigateAndWait(h.page, getFixtureUrl("support-ticket"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const workspaceId = `e2e-verify-${crypto.randomUUID()}`;

    const COMMENT_TEXT =
      "Investigating the reported login timeout. Will update by EOD.";

    // =================================================================
    // TURN 1: Change status + add comment
    // =================================================================
    console.log("\n[verify] === TURN 1: Update ticket ===");

    await sendUserChat(
      h.ctx,
      `Set the ticket status to "In Progress" and add this comment: "${COMMENT_TEXT}"`,
      tabId,
      workspaceId,
    );

    const turn1 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).ticketResult ?? null,
        );
        if (!result) return null;
        if (!result.statusChanged) return null;
        if (result.currentStatus !== "In Progress") return null;
        if (result.commentsAdded < 1) return null;
        return result;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn1.ok) {
      const result = await h.page.evaluate(
        () => (window as any).ticketResult ?? null,
      );
      console.log("[verify] TURN 1 FAIL:", { reason: turn1.reason, result });
    }
    expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);

    const ticketState = turn1.result as any;
    expect(ticketState.currentStatus).toBe("In Progress");
    expect(ticketState.commentsAdded).toBeGreaterThanOrEqual(1);

    console.log("[verify] Turn 1 PASS — Status changed, comment added");
    console.log(`[verify]   Status: ${ticketState.currentStatus}`);
    console.log(`[verify]   Comments: ${ticketState.commentsAdded}`);
    console.log(`[verify]   Last comment: ${ticketState.lastComment?.slice(0, 80)}`);

    // =================================================================
    // TRANSITION
    // =================================================================
    await new Promise((r) => setTimeout(r, 4_000));
    await clearMonitoredEvents(h.ctx.serviceWorker);
    const tracesAfterTurn1 = findAllNewTraceFiles(h.tracesBefore);

    // =================================================================
    // TURN 2: Verify — "did it work?"
    // =================================================================
    console.log("\n[verify] === TURN 2: Did it work? ===");

    await sendUserChat(
      h.ctx,
      "Did the comment post? What's the current ticket status and what does the activity feed show?",
      tabId,
      workspaceId,
    );

    const turn2 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
    expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);

    const allTraces = findAllNewTraceFiles(h.tracesBefore);
    const turn2Traces = allTraces.filter(
      (f) => !tracesAfterTurn1.includes(f),
    );
    const turn2Answer = extractDoneMessage(
      turn2Traces.length > 0 ? turn2Traces : allTraces,
    );
    console.log(`[verify] Turn 2 answer: ${turn2Answer.slice(0, 250)}`);

    // The verification answer should confirm what happened
    const t2Lower = turn2Answer.toLowerCase();

    // Must confirm the status
    expect(
      t2Lower.includes("in progress"),
      "Turn 2 should confirm the 'In Progress' status",
    ).toBe(true);

    // Must reference the comment content or confirm it posted
    expect(
      t2Lower.includes("investigating") ||
        t2Lower.includes("login timeout") ||
        t2Lower.includes("comment") ||
        t2Lower.includes("posted") ||
        t2Lower.includes("added"),
      "Turn 2 should confirm the comment was posted",
    ).toBe(true);

    // =================================================================
    // Final checks
    // =================================================================
    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

    console.log("\n[verify] === BOTH TURNS PASSED ===");
    console.log("[verify] Turn 1: Updated ticket (action)");
    console.log("[verify] Turn 2: Verified result (perception)");
  }, 420_000);
});
