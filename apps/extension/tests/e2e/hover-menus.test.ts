/**
 * E2E: Hover Menus — hover to reveal dropdown menu, read tooltip SKU,
 * search by SKU.
 *
 * Tests: hover_element, read_element
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

const h = createE2EHarness({ maxTurns: 25, testLabel: "hover-menus" });

describe.skipIf(!h.apiKey)("E2E: Hover Menus", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("hover-menus"));
  afterAll(() => h.afterAllHook());

  it("agent hovers to reveal menu, selects category, reads tooltip SKU, and searches", async () => {
    await navigateAndWait(h.page, getFixtureUrl("hover-menus"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Go to Electronics under the Products menu, find the SKU number for Widget X, and search for it.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).hoverResult ?? null,
        );
        if (result && result.searchCompleted && result.categorySelected === "Electronics")
          return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        categoryBanner: document.getElementById("category-banner")?.textContent || "",
        searchResult: document.getElementById("search-result")?.textContent || "",
        hoverResult: (window as any).hoverResult,
      }));
      console.log(
        "[e2e] FAILURE DIAGNOSTICS:",
        JSON.stringify(
          { reason: outcome.reason, ui, events: outcome.events.slice(-10) },
          null,
          2,
        ),
      );
    }
    expect(outcome.ok, outcome.reason).toBe(true);

    const result = outcome.result as any;
    expect(result.categorySelected).toBe("Electronics");
    expect(result.searchCompleted).toBe(true);

    console.log(`\n[e2e] PASS — Hover menu opened, category selected, SKU searched`);
    console.log(`[e2e]   Category: ${result.categorySelected}`);
    console.log(`[e2e]   Search query: ${result.searchQuery}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
