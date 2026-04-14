/**
 * E2E: FAQ Accordion — expand collapsible sections, find hidden promo code.
 *
 * Tests: accordion interaction, inspect_hidden (hidden content detection)
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

const h = createE2EHarness({ maxTurns: 25, testLabel: "faq-accordion" });

describe.skipIf(!h.apiKey)("E2E: FAQ Accordion", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("faq-accordion"));
  afterAll(() => h.afterAllHook());

  it("agent expands FAQ section and finds hidden promo code", async () => {
    await navigateAndWait(h.page, getFixtureUrl("faq-accordion"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Find the FAQ about promo codes and tell me the actual code.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).faqResult ?? null,
        );
        if (result && result.hiddenCodeFound) return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        expandedSections: (window as any).faqResult?.expandedSections || [],
        revealedCode: document.getElementById("revealed-code")?.textContent || "",
        faqResult: (window as any).faqResult,
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
    expect(result.hiddenCodeFound).toBe(true);
    expect(result.codeValue).toBe("SAVE20");

    console.log(`\n[e2e] PASS — Promo code found`);
    console.log(`[e2e]   Code: ${result.codeValue}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
