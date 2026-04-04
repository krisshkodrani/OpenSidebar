/**
 * E2E: Navigation Challenge — click button 3 times, enter revealed code, submit.
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

const h = createE2EHarness({ maxTurns: 30, testLabel: "navigation-challenge" });

describe.skipIf(!h.apiKey)("E2E: Navigation Challenge", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("navigation-challenge"));
  afterAll(() => h.afterAllHook());

  it("agent clicks Advance 3 times, reads code, enters it, and submits", async () => {
    await navigateAndWait(h.page, getFixtureUrl("navigation"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "You are on a Navigation Challenge page. Complete these steps:",
      "",
      "1. Click the 'Advance' button 3 times. Each click increments the step counter.",
      "2. After the 3rd click, a secret code will be revealed on the page. Read it carefully.",
      "3. Type that exact code into the input field (placeholder 'Enter the secret code').",
      "4. Click the 'Submit Code' button.",
      "5. Verify the page shows 'Challenge Complete!' to confirm success.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        return h.page.evaluate(() => (window as any).challengeResult ?? null);
      },
      300_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      console.log(
        "[e2e] FAILURE DIAGNOSTICS:",
        JSON.stringify(
          {
            reason: outcome.reason,
            result: outcome.result,
            events: outcome.events,
          },
          null,
          2,
        ),
      );
    }
    expect(outcome.ok, outcome.reason).toBe(true);

    const result = outcome.result as any;
    expect(result.completed).toBe(true);
    expect(result.code).toBe("ALPHA-7492");

    const banner = await h.page.evaluate(() => {
      const el = document.getElementById("success-banner");
      return el ? el.textContent?.trim() : null;
    });
    expect(banner).toContain("Challenge Complete");

    console.log(`\n[e2e] PASS — Navigation Challenge completed`);
    console.log(`[e2e]   Code: ${result.code}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 380_000);
});
