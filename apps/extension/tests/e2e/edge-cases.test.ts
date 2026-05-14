/**
 * E2E: Edge cases and error handling.
 *
 * Tests: form validation recovery, impossible task graceful stop.
 *
 * Run: pnpm run test:e2e
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
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { extractDoneSummary } from "./helpers/diagnostics";

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

    const prompt = "Generate a report and submit it. If that is not possible on this page, tell me why.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForTaskCompletion(h.ctx, 120_000, workspaceId);

    const { traceFiles } = await h.printTraceSummary(workspaceId);

    const reportStatusHidden = await h.page.evaluate(() => {
      const el = document.getElementById("report-status");
      return el?.classList.contains("hidden") ?? true;
    });
    const completion = [...outcome.events]
      .reverse()
      .find((event: any) => event.type === "TASK_COMPLETION");
    const summary = String(
      completion?.payload?.summary || extractDoneSummary(traceFiles),
    );

    console.log(
      `[e2e] Impossible task outcome: ${outcome.reason} (report-status hidden: ${reportStatusHidden})`,
    );
    expect(outcome.ok, outcome.reason).toBe(true);
    expect(
      reportStatusHidden,
      "Impossible report task must not create a report side effect",
    ).toBe(true);
    const unavailablePattern =
      /(cannot|can't|couldn't|unable|not possible|not available|unavailable|does not (?:exist|include)|doesn't (?:exist|include)|no .*button|no .*control|missing)/i;
    expect(
      unavailablePattern.test(summary),
      `Agent must explicitly report that the report action is unavailable. Got: ${summary}`,
    ).toBe(true);
  }, 180_000);
});
