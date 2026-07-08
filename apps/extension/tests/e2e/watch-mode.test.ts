import { describe, expect, test } from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  armPassiveSuggestionCollector,
  getActiveTabId,
  navigateAndWait,
  startPassiveMonitor,
  stopPassiveMonitor,
  waitForPassiveSuggestion,
} from "./helpers/utils";
import { installLocalMockProviderInterceptor } from "./helpers/local-mock-provider";

// Deterministic, token-free: the passive-monitor LLM call is intercepted by the
// local mock provider, which posts a suggestion only once the fixture has
// flipped to in-stock. Requires E2E_LOCAL_MOCK_PROVIDER=1 (like the other
// mock-provider e2e); the video profile records the fixture tab with the
// in-page overlay panel so the suggestion is visible on camera.
const enabled = process.env.E2E_LOCAL_MOCK_PROVIDER === "1";

if (enabled) {
  process.env.E2E_PROFILE = process.env.E2E_PROFILE || "video";
  process.env.E2E_PROVIDER = "fireworks";
  process.env.FIREWORKS_API_KEY = process.env.FIREWORKS_API_KEY || "local-mock";
}

describe.skipIf(!enabled)("watch mode (passive monitor)", () => {
  test(
    "posts a suggestion when a watched page comes back in stock",
    async () => {
      const h = createE2EHarness({ maxTurns: 1, testLabel: "watch-restock" });
      let passed = false;
      let cdp: { detach: () => Promise<void> } | null = null;
      let workspaceId: string | null = null;

      try {
        await h.beforeAllHook();
        cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
        await installLocalMockProviderInterceptor(cdp, "watch-restock");
        await h.beforeEachHook();

        // Load the product page while it is still out of stock.
        await navigateAndWait(
          h.page,
          getFixtureUrl("watch/restock.html?delayMs=4000"),
        );
        await h.page.bringToFront();
        const tabId = await getActiveTabId(h.ctx.serviceWorker);
        workspaceId = `e2e-watch-${Date.now()}`;

        // Arm the collector BEFORE the page flips so no broadcast is missed.
        await armPassiveSuggestionCollector(h.ctx);
        await startPassiveMonitor(h.ctx, tabId, workspaceId, {
          instructions:
            "Tell me when the Nimbus Running Shoe is back in stock.",
          inputSources: ["page"],
          minIntervalMs: 1500,
        });

        let suggestion;
        try {
          suggestion = await waitForPassiveSuggestion(h.ctx, 40_000);
        } catch (err) {
          const helper = await h.ctx.helperPage;
          const statuses = helper
            ? await helper.evaluate(() => (window as any).__passiveStatuses ?? [])
            : [];
          console.log("[watch-diag] statuses:", JSON.stringify(statuses));
          throw err;
        }
        expect(suggestion.answer.toLowerCase()).toContain("back in stock");
        expect(suggestion.confidence).toBe("high");

        // Let the in-page panel render the suggestion on camera before we stop.
        await new Promise((r) => setTimeout(r, 3_000));
        passed = true;
      } finally {
        if (workspaceId) {
          await stopPassiveMonitor(h.ctx, workspaceId).catch(() => {});
        }
        await h.afterEachHook("watch-restock", passed);
        if (cdp) await cdp.detach().catch(() => {});
        await h.afterAllHook().catch(() => {});
      }
    },
    120_000,
  );
});
