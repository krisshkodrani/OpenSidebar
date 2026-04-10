/**
 * E2E: Scroll-to-Find — agent scrolls a long catalog, finds a product
 * below the fold, clicks "View Details" to reveal its hidden spec.
 *
 * Tests: scroll_page, find_element, click_element, read_page.
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

const h = createE2EHarness({ maxTurns: 15, testLabel: "scroll-find" });

describe.skipIf(!h.apiKey)("E2E: Scroll-to-Find", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("scroll-find"));
  afterAll(() => h.afterAllHook());

  it("scrolls to find a product below the fold and reveals its spec", async () => {
    await navigateAndWait(h.page, getFixtureUrl("scroll-catalog"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Find the Thunderbolt Dock Pro product on this page and show me its specs.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        return h.page.evaluate(() => (window as any).targetRevealed ?? null);
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        scrollY: window.scrollY,
        docHeight: document.documentElement.scrollHeight,
        targetVisible: !!document.getElementById("spec-target"),
      }));
      console.log(
        "[e2e] FAILURE:",
        JSON.stringify(
          { reason: outcome.reason, ui, events: outcome.events.slice(-10) },
          null,
          2,
        ),
      );
    }
    expect(outcome.ok, outcome.reason).toBe(true);

    const result = outcome.result as any;
    expect(result).toBeTruthy();
    expect(result.productId).toBe("target");
    expect(result.spec).toContain("TB4-DOCK-2026");

    console.log(`\n[e2e] PASS — Found Thunderbolt Dock Pro and revealed spec`);
    console.log(`[e2e]   Spec: ${result.spec}`);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 300_000);
});
