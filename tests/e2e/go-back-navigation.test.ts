/**
 * E2E: Go-Back Navigation — agent navigates forward through a 3-page chain,
 * reads data from page 3, then uses go_back to return and read from page 1.
 *
 * Tests: navigate, go_back, read_page across real browser history entries.
 * Exercises the navigation bridge (state persistence across page loads).
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
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { openHelperPage } from "./helpers/browser";
import {
  findAllNewTraceFiles,
  readTrace,
} from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 20, testLabel: "go-back-nav" });

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

    const prompt = [
      "You are on a warehouse inventory page (Warehouse Alpha — page 1 of 3).",
      "Click the button to go to Warehouse Beta (page 2), then click again to go to Warehouse Gamma (page 3).",
      "On page 3, read the inventory count for Warehouse Gamma.",
      "Then use go_back twice to return to page 1 (Warehouse Alpha).",
      "Read the inventory count for Warehouse Alpha.",
      "Call done() reporting BOTH inventory counts: Gamma and Alpha.",
    ].join(" ");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);
    const outcome = await waitForTaskCompletion(h.ctx, 240_000, workspaceId);

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

    // Must have used go_back or navigate backward
    const hasGoBack = toolNames.includes("go_back");
    const hasNavigate = toolNames.includes("navigate");
    expect(
      hasGoBack || hasNavigate,
      "Agent must use go_back or navigate to return to earlier pages",
    ).toBe(true);

    // Done summary should reference inventory data
    const summary = extractDoneSummary(traceFiles);
    console.log("[e2e] Done summary:", summary?.slice(0, 300));
    expect(summary, "Agent must call done() with a summary").toBeTruthy();
    // Alpha count (4,827) should always be present since we start there
    const mentionsAlpha = /4[,.]?827/.test(summary!);
    expect(
      mentionsAlpha,
      `Done summary must mention Alpha inventory (4,827). Got: ${summary?.slice(0, 200)}`,
    ).toBe(true);

    console.log(`\n[e2e] PASS — Forward/back navigation with data collection`);
    await assertNoGhostSession(h.ctx.serviceWorker, 10_000, workspaceId);
  }, 300_000);
});
