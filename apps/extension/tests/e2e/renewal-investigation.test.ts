import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { traceFilesContainText } from "./helpers/diagnostics";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";

const h = createE2EHarness({
  maxTurns: 20,
  testLabel: "renewal-investigation",
});

describe.skipIf(!h.apiKey)("E2E: Renewal Investigation", () => {
  beforeAll(() => h.beforeAllHook(), 120_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("renewal-investigation"));
  afterAll(() => h.afterAllHook());

  it("reconciles four evidence sources and prepares an unsent dispute", async () => {
    await navigateAndWait(h.page, getFixtureUrl("renewal-review"));
    await h.page.evaluate(() => {
      sessionStorage.removeItem("renewal-review-visited-tabs");
    });
    await navigateAndWait(h.page, getFixtureUrl("renewal-review"));

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Review the Atlas Cloud renewal before the deadline. Check the invoice against the contract, current usage, and renewal policy, then calculate the corrected annual renewal and potential savings. Prepare a concise dispute to Atlas Cloud that cites the 73 active seats, the missing 15% renewal discount, the corrected $14,892 total, and $13,908 potential savings. Don't send it; leave final approval to me.";
    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () =>
        (await h.page.evaluate(() => {
          const state = (window as any).renewalReviewState;
          const requiredViews = ["invoice", "contract", "usage", "policy", "draft"];
          return state?.draft?.ready &&
            !state.sent &&
            requiredViews.every((view) => state.visitedViews?.includes(view))
            ? state
            : null;
        })) || null,
      360_000,
      workspaceId,
    );
    const { traceFiles } = await h.printTraceSummary(workspaceId);

    expect(outcome.ok, outcome.reason).toBe(true);
    expect(outcome.result).toMatchObject({
      sent: false,
      evidence: {
        vendor: "Atlas Cloud",
        invoicedSeats: 120,
        activeSeats: 73,
        invoicedTotal: 28_800,
        correctedTotal: 14_892,
        potentialSavings: 13_908,
      },
    });
    expect(outcome.result?.draft?.subject.toLowerCase()).toContain("atlas cloud");
    expect(traceFilesContainText(traceFiles, "14,892")).toBe(true);
    expect(traceFilesContainText(traceFiles, "13,908")).toBe(true);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 420_000);
});
