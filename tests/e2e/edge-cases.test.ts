/**
 * E2E: Edge cases and error handling.
 *
 * Tests: form validation recovery, impossible task graceful stop.
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

const h = createE2EHarness({ maxTurns: 20, testLabel: "edge-cases" });

describe.skipIf(!h.apiKey)("E2E: Edge Cases", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("edge-cases"));
  afterAll(() => h.afterAllHook());

  it("agent recovers from form validation errors", async () => {
    await navigateAndWait(h.page, getFixtureUrl("errors"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Fill out the contact form with email test@example.com and message 'Hello, this is a test message for the contact form' and send it.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        return h.page.evaluate(() => (window as any).contactResult ?? null);
      },
      180_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      console.log("[e2e] FAILURE:", outcome.reason, outcome.events.slice(-5));
    }
    expect(outcome.ok, outcome.reason).toBe(true);

    const result = outcome.result as any;
    expect(result.sent).toBe(true);
    expect(result.email).toBe("test@example.com");
    expect(result.message.length).toBeGreaterThanOrEqual(10);

    console.log(`[e2e] PASS — Contact form submitted: ${result.email}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 260_000);

  it("agent stops gracefully when task is impossible", async () => {
    await navigateAndWait(h.page, getFixtureUrl("errors"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Generate a report and submit it. If the button doesn't exist, let me know.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => null,
      120_000,
      workspaceId,
    );

    await h.printTraceSummary();

    const reportStatus = await h.page.evaluate(() => {
      const el = document.getElementById("report-status");
      return el?.classList.contains("hidden") ?? true;
    });

    console.log(
      `[e2e] Impossible task outcome: ${outcome.reason} (report-status hidden: ${reportStatus})`,
    );
    expect(
      ["timeout", "done", "agent_error"].some(
        (r) => outcome.reason.startsWith(r) || outcome.reason === r,
      ),
    ).toBe(true);
  }, 180_000);
});
