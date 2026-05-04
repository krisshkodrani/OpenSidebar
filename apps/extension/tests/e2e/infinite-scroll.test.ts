/**
 * E2E: Infinite Scroll — scroll through lazy-loaded feed to find target post.
 *
 * Tests: repeated scroll + wait cycles, lazy content loading
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
import { extractDoneSummary } from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 35, testLabel: "infinite-scroll" });

describe.skipIf(!h.apiKey)("E2E: Infinite Scroll", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("infinite-scroll"));
  afterAll(() => h.afterAllHook());

  it("agent scrolls through feed to find a specific post", async () => {
    await navigateAndWait(h.page, getFixtureUrl("infinite-scroll"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Find Post #35 'The Secret Formula for Productivity' in the feed and tell me the secret code mentioned in it.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).infiniteScrollResult ?? null,
        );
        if (result && result.targetFound) return result;
        return null;
      },
      300_000,
      workspaceId,
    );

    const { traceFiles } = await h.printTraceSummary(workspaceId);

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        postsLoaded: (window as any).infiniteScrollResult?.postsLoaded || 0,
        infiniteScrollResult: (window as any).infiniteScrollResult,
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
    expect(result.targetFound).toBe(true);
    expect(result.postsLoaded).toBeGreaterThanOrEqual(35);
    const summary = extractDoneSummary(traceFiles);
    expect(
      /CODE-OMEGA-42|OMEGA-42/i.test(summary),
      `Agent must report the secret code from the target post. Got: ${summary}`,
    ).toBe(true);

    console.log(`\n[e2e] PASS — Target post found`);
    console.log(`[e2e]   Posts loaded: ${result.postsLoaded}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 360_000);
});
