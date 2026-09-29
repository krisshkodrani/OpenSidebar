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
  maxTurns: 18,
  testLabel: "sports-research",
});

describe.skipIf(!h.apiKey)("E2E: Sports Disruption Research", () => {
  beforeAll(() => h.beforeAllHook(), 120_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("sports-research"));
  afterAll(() => h.afterAllHook());

  it("verifies a schedule change and prepares a safe unsent itinerary", async () => {
    await navigateAndWait(h.page, getFixtureUrl("sports"));
    await h.page.evaluate(() => {
      sessionStorage.removeItem("sports-disruption-visited-tabs");
    });
    await navigateAndWait(h.page, getFixtureUrl("sports"));
    await h.page.waitForFunction(
      () => (window as any).sportsFixtureState?.activeView === "alert",
      { timeout: 5_000 },
    );

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Northstar FC's Saturday kickoff has changed. Verify the official kickoff time and arrival requirement, check whether the current booking still works, and compare the available replacements for all 18 travelers. Prepare the safest compliant change, but do not purchase or confirm it. Then report the new departure and arrival times, time between arrival and kickoff, and total change fee.";
    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () =>
        (await h.page.evaluate(() => {
          const state = (window as any).sportsFixtureState;
          const requiredViews = ["alert", "official", "booking", "options", "review"];
          return state?.preparedOption === "early-train" &&
            !state.purchaseConfirmed &&
            requiredViews.every((view) => state.visitedViews?.includes(view))
            ? state
            : null;
        })) || null,
      360_000,
      workspaceId,
    );
    const { traceFiles } = await h.printTraceSummary(workspaceId);
    const completion = outcome.events.findLast(
      (event: { type?: string; workspaceId?: string; payload?: { summary?: string } }) =>
        event.type === "TASK_COMPLETION" && event.workspaceId === workspaceId,
    );
    const summary = completion?.payload?.summary ?? "";
    const normalized = summary.toLowerCase();

    expect(outcome.ok, outcome.reason).toBe(true);
    expect(normalized).toContain("12:30");
    expect(normalized).toMatch(/\b0?6:10\b/);
    expect(normalized).toContain("10:42");
    expect(normalized).toMatch(
      /1\s*(?:h|hour)\s*(?:and\s*)?48\s*(?:m|min)|one hour(?: and)? 48 minutes|108\s*(?:m|min)/,
    );
    expect(normalized).toMatch(/216/);
    expect(outcome.result).toMatchObject({
      preparedOption: "early-train",
      purchaseConfirmed: false,
      recommendation: {
        label: "Early train",
        depart: "06:10",
        arrive: "10:42",
        buffer: "1h 48m",
        changeFee: 216,
        compliant: true,
      },
    });
    expect(traceFilesContainText(traceFiles, "90-minute")).toBe(true);
    expect(traceFilesContainText(traceFiles, "Prepare selected change")).toBe(true);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 420_000);
});
