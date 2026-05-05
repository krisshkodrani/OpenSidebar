/**
 * E2E: Structural Loading — regression test for the "loading" keyword loop.
 *
 * Validates that the agent does NOT get stuck when a page always has the word
 * "loading" in the DOM (like LinkedIn's lazy-load containers). Before the fix,
 * the async change detection treated structural "loading" text as a transient
 * loading indicator, causing done() to be rejected indefinitely.
 *
 * The fixture page has:
 * - A permanent "loading more items..." element (always in DOM)
 * - A "Compose Message" button that opens a composer panel
 * - The agent must click the button, verify the composer opened, and report done
 *
 * Run: npm run test:e2e
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
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { readTrace } from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 15, testLabel: "structural-loading" });

describe.skipIf(!h.apiKey)("E2E: Structural Loading", () => {
  beforeAll(async () => { await h.beforeAllHook(); }, 120_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("structural-loading"));
  afterAll(() => h.afterAllHook());

  it("completes task on a page with permanent 'loading' text in the DOM", async () => {
    await navigateAndWait(h.page, getFixtureUrl("structural-loading"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Open the message composer.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const ready = await h.page.evaluate(
          () => (window as any).__composerReady ?? false,
        );
        return ready ? true : null;
      },
      120_000,
      workspaceId,
    );

    const { traceFiles } = await h.printTraceSummary();

    if (!outcome.ok) {
      console.log(
        "[e2e] FAILURE:",
        JSON.stringify(
          { reason: outcome.reason, events: outcome.events.slice(-10) },
          null,
          2,
        ),
      );
    }
    expect(outcome.ok, outcome.reason).toBe(true);
    expect(outcome.result).toBe(true);

    // Verify the agent didn't burn excessive turns (the pre-fix loop would use 30+)
    const turns = traceFiles.flatMap((f) => readTrace(f));
    const doneRejections = turns.filter((t) =>
      t.events?.some((e: any) => e.type === "done_rejected"),
    );
    console.log(
      `[e2e] Turns: ${turns.length}, done rejections: ${doneRejections.length}`,
    );
    // With the fix, the agent should complete in ≤10 turns with 0 done rejections
    // from the structural loading keyword. Allow 1 rejection for other guards.
    expect(
      doneRejections.length,
      "Agent should not get stuck rejecting done() due to structural 'loading' text",
    ).toBeLessThanOrEqual(1);

    console.log("[e2e] PASS — Agent completed task despite permanent 'loading' in DOM");
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 180_000);
});
