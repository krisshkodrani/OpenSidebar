/**
 * E2E: Continuation — Act-Check-Act (interleaved perception).
 *
 * Tests the natural human cadence: do something, inspect the result,
 * then continue. Turn 2 is a perception-only checkpoint — no action,
 * just report what's visible.
 *
 * Turn 1: Dismiss any popups on the page
 * Turn 2: What's visible now? Is the form accessible?
 * Turn 3: Fill in the email and delete the account
 *
 * Run: pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/continuation-act-check-act.test.ts
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
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  settleWorkspaceBetweenTurns,
  waitForOutcome,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { extractDoneSummary, findAllNewTraceFiles } from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 15, testLabel: "act-check-act" });

const TURN_TIMEOUT = 180_000;

/** Extract the done() message from trace files */
function extractDoneMessage(traceFiles: string[]): string {
  return extractDoneSummary(traceFiles);
}

describe.skipIf(!h.apiKey)("E2E: Continuation — Act-Check-Act", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("act-check-act"));
  afterAll(() => h.afterAllHook());

  it("dismisses overlays, reports page state, then acts on the form", async () => {
    await navigateAndWait(h.page, getFixtureUrl("modal-overlays"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const workspaceId = `e2e-aca-${crypto.randomUUID()}`;

    // =================================================================
    // TURN 1: Dismiss popups
    // =================================================================
    console.log("\n[aca] === TURN 1: Dismiss popups ===");

    await sendUserChat(
      h.ctx,
      "Close the cookie banner at the bottom and the newsletter popup so I can see the page.",
      tabId,
      workspaceId,
    );

    const turn1 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const state = await h.page.evaluate(
          () => (window as any).modalResult ?? null,
        );
        if (!state) return null;
        // Both overlays should be dismissed
        return state.cookieDismissed && state.newsletterClosed ? state : null;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn1.ok) {
      const state = await h.page.evaluate(
        () => (window as any).modalResult ?? null,
      );
      console.log("[aca] TURN 1 FAIL:", { reason: turn1.reason, state });
    }
    expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);

    console.log("[aca] Turn 1 PASS — Overlays dismissed");

    // =================================================================
    // TRANSITION
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);
    const tracesAfterTurn1 = findAllNewTraceFiles(h.tracesBefore);

    // =================================================================
    // TURN 2: Perception checkpoint — observe only, no action
    // =================================================================
    console.log("\n[aca] === TURN 2: What's visible now? ===");

    await sendUserChat(
      h.ctx,
      "What's visible on the page now? Is there an email field I can use? Describe what you see.",
      tabId,
      workspaceId,
    );

    const turn2 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
    expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);

    const allTracesAfterTurn2 = findAllNewTraceFiles(h.tracesBefore);
    const turn2Traces = allTracesAfterTurn2.filter(
      (f) => !tracesAfterTurn1.includes(f),
    );
    const turn2Answer = extractDoneMessage(
      turn2Traces.length > 0 ? turn2Traces : allTracesAfterTurn2,
    );
    console.log(`[aca] Turn 2 answer: ${turn2Answer.slice(0, 200)}`);

    // The user asked specifically about the email field, so the answer must
    // address it AND ground itself in at least one other page concept.
    const t2Lower = turn2Answer.toLowerCase();
    expect(
      t2Lower.includes("email"),
      `Turn 2 should answer the email-field question. Got: ${turn2Answer.slice(0, 200)}`,
    ).toBe(true);
    expect(
      t2Lower.includes("account") ||
        t2Lower.includes("settings") ||
        t2Lower.includes("notification") ||
        t2Lower.includes("delete"),
      `Turn 2 should describe the page it observed. Got: ${turn2Answer.slice(0, 200)}`,
    ).toBe(true);

    // =================================================================
    // TRANSITION
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

    // =================================================================
    // TURN 3: Act on the form — fill email + delete account
    // =================================================================
    console.log("\n[aca] === TURN 3: Fill email and delete ===");

    await sendUserChat(
      h.ctx,
      "Fill in the email field with test@example.com, then click the delete account button and confirm the deletion.",
      tabId,
      workspaceId,
    );

    const turn3 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const state = await h.page.evaluate(
          () => (window as any).modalResult ?? null,
        );
        if (!state) return null;
        return state.deleteConfirmed && state.formFilled ? state : null;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn3.ok) {
      const state = await h.page.evaluate(
        () => (window as any).modalResult ?? null,
      );
      const emailVal = await h.page.evaluate(() => {
        const el = document.getElementById("account-email") as HTMLInputElement | null;
        return el?.value ?? "";
      });
      console.log("[aca] TURN 3 FAIL:", {
        reason: turn3.reason,
        state,
        emailVal,
      });
    }
    expect(turn3.ok, `Turn 3 failed: ${turn3.reason}`).toBe(true);

    // Verify email was filled
    const emailValue = await h.page.evaluate(() => {
      const el = document.getElementById("account-email") as HTMLInputElement | null;
      return el?.value ?? "";
    });
    expect(emailValue).toBe("test@example.com");

    // Verify deletion was confirmed
    const finalState = await h.page.evaluate(
      () => (window as any).modalResult ?? null,
    );
    expect(finalState.deleteConfirmed).toBe(true);

    console.log("[aca] Turn 3 PASS — Email filled, account deleted");

    // =================================================================
    // Final checks
    // =================================================================
    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

    console.log("\n[aca] === ALL 3 TURNS PASSED ===");
    console.log("[aca] Turn 1: Dismissed overlays");
    console.log("[aca] Turn 2: Described page (perception only)");
    console.log("[aca] Turn 3: Filled email + confirmed deletion");
  }, 600_000);
});
