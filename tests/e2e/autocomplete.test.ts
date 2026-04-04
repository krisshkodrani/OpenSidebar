/**
 * E2E: Autocomplete — type partial text, wait for suggestion dropdown,
 * select correct suggestion.
 *
 * Tests: type → wait → click-suggestion sequence, debounced dropdowns
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

const h = createE2EHarness({ maxTurns: 25, testLabel: "autocomplete" });

describe.skipIf(!h.apiKey)("E2E: Autocomplete", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("autocomplete"));
  afterAll(() => h.afterAllHook());

  it("agent types partial text and selects suggestions from dropdowns", async () => {
    await navigateAndWait(h.page, getFixtureUrl("autocomplete"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "This page has two autocomplete fields that show suggestion dropdowns after you type.",
      "",
      "Step 1: Click the Address input field and type '123 Main'. Wait for the suggestion dropdown to appear (it takes about half a second). Then click on '123 Main Street, Springfield, IL 62704' from the suggestions.",
      "",
      "Step 2: Click the Product Search input field and type 'lap'. Wait for the suggestion dropdown to appear. Then click on 'Laptop Stand' from the suggestions.",
      "",
      "Both fields should show a green 'Selected:' confirmation below them when done correctly.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).autocompleteResult ?? null,
        );
        if (
          result &&
          result.address?.includes("Springfield") &&
          result.product === "Laptop Stand"
        )
          return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        addressConfirmed: document.getElementById("address-confirmed")?.textContent || "",
        productConfirmed: document.getElementById("product-confirmed")?.textContent || "",
        addressInput: (document.getElementById("address-input") as HTMLInputElement)?.value || "",
        productInput: (document.getElementById("product-input") as HTMLInputElement)?.value || "",
        autocompleteResult: (window as any).autocompleteResult,
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
    expect(result.address).toContain("Springfield");
    expect(result.product).toBe("Laptop Stand");

    console.log(`\n[e2e] PASS — Both autocomplete selections made`);
    console.log(`[e2e]   Address: ${result.address}`);
    console.log(`[e2e]   Product: ${result.product}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
