/**
 * E2E: Data Table — paginated employee directory. Agent must navigate
 * through pages to find a specific employee and extract data.
 *
 * Tests: pagination interaction, multi-page data extraction
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

const h = createE2EHarness({ maxTurns: 30, testLabel: "data-table" });

describe.skipIf(!h.apiKey)("E2E: Data Table", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("data-table"));
  afterAll(() => h.afterAllHook());

  it("agent navigates paginated table to find employee and extract salary", async () => {
    await navigateAndWait(h.page, getFixtureUrl("data-table"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Search for Diana in the employee directory and tell me her salary.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).tableResult ?? null,
        );
        if (result && result.dianaFound) return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        currentPage: (window as any).tableResult?.currentPage,
        tableResult: (window as any).tableResult,
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
    expect(result.dianaFound).toBe(true);
    expect(result.dianaSalary).toBeTruthy();

    console.log(`\n[e2e] PASS — Diana Chen found`);
    console.log(`[e2e]   Salary: ${result.dianaSalary}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
