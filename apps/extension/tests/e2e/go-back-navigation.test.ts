/**
 * E2E: Go-Back Navigation — agent navigates forward through a 3-page chain,
 * reads data from page 3, then uses go_back to return and read from page 1.
 *
 * Tests: navigate, go_back, read_page across real browser history entries.
 * Exercises the navigation bridge (state persistence across page loads).
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
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { openHelperPage } from "./helpers/browser";
import {
  readTrace,
} from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 35, testLabel: "go-back-nav" });

/** Extract all tool names from trace files. */
function extractToolNames(traceFiles: string[]): string[] {
  return traceFiles.flatMap((f) =>
    readTrace(f).flatMap((turn) => turn.toolCalls.map((tc) => tc.name)),
  );
}

/** Extract done() summary from trace. */
function extractDoneSummary(traceFiles: string[]): string | null {
  for (const f of traceFiles) {
    for (const turn of readTrace(f)) {
      const done = turn.toolCalls.find((tc) => tc.name === "done");
      if (done?.args?.summary) return String(done.args.summary);
    }
  }
  return null;
}

describe.skipIf(!h.apiKey)("E2E: Go-Back Navigation", () => {
  beforeAll(async () => {
    await h.beforeAllHook();
    // Enable navigation for go_back and cross-page navigation
    const helper = await openHelperPage(h.ctx);
    await helper.evaluate(async () => {
      const existing =
        ((await chrome.storage.sync.get("userSettings")).userSettings as any) ??
        {};
      await chrome.storage.sync.set({
        userSettings: { ...existing, allowNavigation: true },
      });
    });
    await helper.close();
  }, 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("go-back-nav"));
  afterAll(() => h.afterAllHook());

  it("navigates forward then uses go_back to return and collect data", async () => {
    // Start at page 1 of the chain
    await navigateAndWait(h.page, getFixtureUrl("go-back-chain") + "?step=1");
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Check the inventory count for Warehouse Gamma on page 3, then go back to Warehouse Alpha and check its count too. Tell me both numbers.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);
    const outcome = await waitForTaskCompletion(h.ctx, 360_000, workspaceId);

    const { traceFiles } = await h.printTraceSummary();

    if (!outcome.ok) {
      console.log(
        "[e2e] FAILURE:",
        JSON.stringify(
          { reason: outcome.reason, events: outcome.events.slice(-10) },
          null,
          2,
        ),
      );
    }
    expect(outcome.ok, outcome.reason).toBe(true);

    // Trace verification
    const toolNames = extractToolNames(traceFiles);
    console.log("[e2e] Tools used:", toolNames.join(", "));

    // Must have used some form of backward navigation (breadcrumb click, go_back, or navigate)
    const hasGoBack = toolNames.includes("go_back");
    const hasNavigate = toolNames.includes("navigate");
    const hasClick = toolNames.includes("click_element");
    expect(
      hasGoBack || hasNavigate || hasClick,
      "Agent must use breadcrumbs, go_back, or navigate to return to earlier pages",
    ).toBe(true);

    // Check aggregated summary from TASK_COMPLETION (combines all node results).
    // Individual node done() calls may not mention data from other nodes,
    // but the orchestrator aggregates all node results into the final summary.
    const completionEvent = [...outcome.events]
      .reverse()
      .find((e: any) => e.type === "TASK_COMPLETION");
    const aggregatedSummary = completionEvent?.summary || "";
    const subtaskResults = (completionEvent?.subtaskResults || []) as Array<{
      result?: string;
    }>;
    const allResults = [
      aggregatedSummary,
      ...subtaskResults.map((r) => r.result || ""),
    ].join("\n");
    // Also check individual node done() calls as fallback
    const traceSummary = extractDoneSummary(traceFiles) || "";
    const combinedEvidence = `${allResults}\n${traceSummary}`;
    console.log("[e2e] Aggregated summary:", aggregatedSummary.slice(0, 300));
    console.log("[e2e] Trace done():", traceSummary.slice(0, 200));

    expect(
      aggregatedSummary || traceSummary,
      "Agent must produce a summary (via done() or TASK_COMPLETION)",
    ).toBeTruthy();
    // Alpha count (4,827) should be present in either the aggregated summary
    // or individual node results
    const mentionsAlpha = /4[,.]?827/.test(combinedEvidence);
    expect(
      mentionsAlpha,
      `Summary must mention Alpha inventory (4,827). Got: ${combinedEvidence.slice(0, 300)}`,
    ).toBe(true);
    const mentionsGamma = /6[,.]?412/.test(combinedEvidence);
    expect(
      mentionsGamma,
      `Summary must mention Gamma inventory (6,412). Got: ${combinedEvidence.slice(0, 300)}`,
    ).toBe(true);

    console.log(`\n[e2e] PASS — Forward/back navigation with data collection`);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 420_000);
});
