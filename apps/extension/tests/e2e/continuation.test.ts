/**
 * E2E: Continuation — same-workspace follow-ups editing a textarea.
 *
 * Tests that the agent correctly handles multi-turn conversations where
 * the user repeatedly asks to change the content of a textarea, reusing
 * the same workspace ID so conversation history carries over.
 *
 * Turn 1: Draft a reply accepting Thursday 2 PM
 * Turn 2: Change it to decline, suggest Monday
 * Turn 3: Make it casual, mention Q3 slides
 *
 * Run: pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/continuation.test.ts
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
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 15, testLabel: "continuation" });

const TURN_TIMEOUT = 180_000;

describe.skipIf(!h.apiKey)("E2E: Continuation", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("continuation"));
  afterAll(() => h.afterAllHook());

  it("rewrites the same textarea across 3 follow-up messages", async () => {
    await navigateAndWait(h.page, getFixtureUrl("email-compose"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    // Use a single workspace for all 3 turns so conversation history carries over
    const workspaceId = `e2e-continuation-${crypto.randomUUID()}`;

    // =================================================================
    // TURN 1: Accept Thursday 2 PM
    // =================================================================
    console.log("\n[continuation] === TURN 1: Accept Thursday ===");

    await sendUserChat(
      h.ctx,
      "Read the email from David Park and draft a short reply in the reply box accepting the Thursday 2 PM slot. " +
        "Keep it to 2-3 sentences. Don't click send.",
      tabId,
      workspaceId,
    );

    const turn1 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const r = await h.page.evaluate(() => (window as any).emailResult ?? null);
        if (!r?.composed || r.sent) return null;
        const msg = (r.message as string).toLowerCase();
        if (r.messageLength < 20) return null;
        // Must reference Thursday or 2 PM and sound like acceptance
        if (!(msg.includes("thursday") || msg.includes("2 pm") || msg.includes("2pm"))) return null;
        return r;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn1.ok) {
      const draft = await h.page.evaluate(() => {
        const el = document.getElementById("reply-editor") as HTMLTextAreaElement | null;
        return el?.value?.slice(0, 300) || "";
      });
      console.log("[continuation] TURN 1 FAIL:", { reason: turn1.reason, draft });
    }
    expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);
    expect(turn1.result.sent, "Should not send").toBe(false);

    const turn1Text = (turn1.result.message as string);
    console.log(`[continuation] Turn 1 draft (${turn1Text.length} chars): ${turn1Text.slice(0, 120)}...`);

    // =================================================================
    // TRANSITION: Clear events, keep same workspace
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

    // =================================================================
    // TURN 2: Decline both times, suggest Monday
    // =================================================================
    console.log("\n[continuation] === TURN 2: Change to decline ===");

    await sendUserChat(
      h.ctx,
      "Actually, change the reply. Decline both proposed times — say you have conflicts. " +
        "Suggest meeting on Monday at 11 AM instead.",
      tabId,
      workspaceId,
    );

    const turn2 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const r = await h.page.evaluate(() => (window as any).emailResult ?? null);
        if (!r?.composed || r.sent) return null;
        const msg = (r.message as string).toLowerCase();
        if (r.messageLength < 20) return null;
        // Must mention Monday and some form of declining
        const hasMonday = msg.includes("monday") || msg.includes("11 am") || msg.includes("11am");
        const hasDecline =
          msg.includes("conflict") ||
          msg.includes("unable") ||
          msg.includes("unfortunately") ||
          msg.includes("can't") ||
          msg.includes("cannot") ||
          msg.includes("won't be able") ||
          msg.includes("decline");
        if (!hasMonday || !hasDecline) return null;
        return r;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn2.ok) {
      const draft = await h.page.evaluate(() => {
        const el = document.getElementById("reply-editor") as HTMLTextAreaElement | null;
        return el?.value?.slice(0, 300) || "";
      });
      console.log("[continuation] TURN 2 FAIL:", { reason: turn2.reason, draft });
    }
    expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);
    expect(turn2.result.sent, "Should not send").toBe(false);

    const turn2Text = (turn2.result.message as string);
    console.log(`[continuation] Turn 2 draft (${turn2Text.length} chars): ${turn2Text.slice(0, 120)}...`);

    // Content should have meaningfully changed from turn 1
    expect(turn2Text).not.toBe(turn1Text);

    // =================================================================
    // TRANSITION
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

    // =================================================================
    // TURN 3: Make it casual, mention Q3 slides
    // =================================================================
    console.log("\n[continuation] === TURN 3: Casual + Q3 slides ===");

    await sendUserChat(
      h.ctx,
      "One more change — make the tone more casual and add that you'll send over the Q3 budget numbers before the meeting.",
      tabId,
      workspaceId,
    );

    const turn3 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const r = await h.page.evaluate(() => (window as any).emailResult ?? null);
        if (!r?.composed || r.sent) return null;
        const msg = (r.message as string).toLowerCase();
        if (r.messageLength < 20) return null;
        // Must mention budget/Q3/numbers
        const hasBudget =
          msg.includes("budget") || msg.includes("q3") || msg.includes("numbers");
        if (!hasBudget) return null;
        return r;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn3.ok) {
      const draft = await h.page.evaluate(() => {
        const el = document.getElementById("reply-editor") as HTMLTextAreaElement | null;
        return el?.value?.slice(0, 300) || "";
      });
      console.log("[continuation] TURN 3 FAIL:", { reason: turn3.reason, draft });
    }
    expect(turn3.ok, `Turn 3 failed: ${turn3.reason}`).toBe(true);
    expect(turn3.result.sent, "Should not send").toBe(false);

    const turn3Text = (turn3.result.message as string);
    console.log(`[continuation] Turn 3 draft (${turn3Text.length} chars): ${turn3Text.slice(0, 120)}...`);

    // Content should have changed from turn 2
    expect(turn3Text).not.toBe(turn2Text);

    // Should still mention Monday (carried over from turn 2)
    const t3Lower = turn3Text.toLowerCase();
    expect(
      t3Lower.includes("monday") || t3Lower.includes("11"),
      "Turn 3 should preserve Monday suggestion from turn 2",
    ).toBe(true);

    // =================================================================
    // Final checks
    // =================================================================
    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

    console.log("\n[continuation] === ALL 3 TURNS PASSED ===");
    console.log("[continuation] Turn 1: Accept Thursday →", turn1Text.slice(0, 60));
    console.log("[continuation] Turn 2: Decline + Monday →", turn2Text.slice(0, 60));
    console.log("[continuation] Turn 3: Casual + Q3 →", turn3Text.slice(0, 60));
  }, 600_000);
});
