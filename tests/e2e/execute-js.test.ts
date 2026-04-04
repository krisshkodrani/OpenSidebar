/**
 * E2E: Dynamic Compute — agent configures a product by selecting options
 * and toggling a checkbox, then reads the dynamically computed price.
 *
 * Tests: select_option, set_checkbox, read_page (dynamic content).
 * Validates the agent can interact with form controls and observe
 * the computed result change in real time.
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

const h = createE2EHarness({ maxTurns: 15, testLabel: "dynamic-compute" });

describe.skipIf(!h.apiKey)("E2E: Dynamic Compute", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("dynamic-compute"));
  afterAll(() => h.afterAllHook());

  it("configures a product and reads the computed price", async () => {
    await navigateAndWait(h.page, getFixtureUrl("dynamic-compute"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    // Large (1.3x) + engraving ($15) = 75 * 1.3 + 15 = $112.50
    const prompt = [
      "You are on a product configurator page. Complete these steps in order:",
      "Step 1: Use select_option to select 'Large (32 oz)' from the Size dropdown.",
      "Step 2: Use set_checkbox to check the 'Add custom engraving' checkbox.",
      "Step 3: Read the updated price shown on the page and call done() reporting the total.",
    ].join(" ");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const config = await h.page.evaluate(
          () => (window as any).productConfig ?? null,
        );
        if (!config) return null;
        // Success: large size + engraving enabled
        if (config.size === "large" && config.engraving === true) return config;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        size: (document.getElementById("size-select") as HTMLSelectElement)
          ?.value,
        engraving: (
          document.getElementById("engraving-checkbox") as HTMLInputElement
        )?.checked,
        price: document.getElementById("price-text")?.textContent?.trim(),
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

    const config = outcome.result as any;
    expect(config.size).toBe("large");
    expect(config.engraving).toBe(true);
    // 75 * 1.3 + 15 = 112.5
    expect(config.total).toBe(112.5);

    console.log(`\n[e2e] PASS — Configured product`);
    console.log(`[e2e]   Size: ${config.size}, Engraving: ${config.engraving}`);
    console.log(`[e2e]   Computed price: $${config.total}`);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 300_000);
});
