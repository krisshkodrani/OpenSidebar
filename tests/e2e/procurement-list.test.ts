/**
 * E2E: Procurement List — multi-tab purchase workflow.
 *
 * The agent starts on a "docs list" page showing items to buy and which
 * store to visit.  It must open each store in a new tab, add the correct
 * item to cart, place the order, then switch back to the list and check
 * the item off.  Exercises create_tab, switch_tab, click, type, checkbox,
 * and cross-tab coordination.
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

const h = createE2EHarness({ maxTurns: 40, testLabel: "procurement-list" });

/** Extract all tool names from trace files. */
function extractToolNames(traceFiles: string[]): string[] {
  return traceFiles.flatMap((f) =>
    readTrace(f).flatMap((turn) => turn.toolCalls.map((tc) => tc.name)),
  );
}

/** Extract done() summary from trace turns. */
function extractDoneSummary(traceFiles: string[]): string | null {
  for (const f of traceFiles) {
    const turns = readTrace(f);
    for (const turn of turns) {
      const doneCall = turn.toolCalls.find((tc) => tc.name === "done");
      if (doneCall?.args?.summary) return String(doneCall.args.summary);
    }
  }
  return null;
}

describe.skipIf(!h.apiKey)("E2E: Procurement List", () => {
  beforeAll(async () => {
    await h.beforeAllHook();
    // Enable navigation so the agent can create/manage tabs
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
  afterEach(() => h.afterEachHook("procurement-list"));
  afterAll(() => h.afterAllHook());

  it("processes procurement list across multiple tabs", async () => {
    const listUrl = getFixtureUrl("procurement");
    await navigateAndWait(h.page, listUrl);
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "BUY items from the Procurement List on this page. Do NOT just read the list — you must actually purchase each item.",
      "",
      "For the first two items in the table, perform these steps:",
      "  1. Open the store link in a NEW tab (use create_tab with the store URL from the link).",
      "  2. In that store tab, find the matching product and click 'Add to Cart'.",
      "  3. Click 'Place Order' to complete the purchase.",
      "  4. Close the store tab (close_tab) and switch back to the procurement list tab.",
      "  5. Check the checkbox next to that item to mark it as done.",
      "",
      "You MUST complete at least two purchases. Reading the list is NOT enough — items must be bought and checked off.",
      "IMPORTANT: You must use create_tab to open stores and close_tab when finished with each store.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);
    const outcome = await waitForTaskCompletion(h.ctx, 480_000, workspaceId);

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

    // Must have used tab management tools
    const hasCreateTab = toolNames.includes("create_tab");
    expect(hasCreateTab, "Agent must use create_tab to open store pages").toBe(true);

    // Must have clicked elements (adding to cart, placing order, checking off)
    const hasClick = toolNames.includes("click_element");
    expect(hasClick, "Agent must click elements in store pages").toBe(true);

    // Must have called done()
    const summary = extractDoneSummary(traceFiles);
    console.log("[e2e] Done summary:", summary?.slice(0, 300));
    expect(summary, "Agent must call done() with a summary").toBeTruthy();

    console.log(`\n[e2e] PASS — Procurement list processed (${toolNames.length} tool calls)`);
    await assertNoGhostSession(h.ctx.serviceWorker, 10_000, workspaceId);
  }, 540_000);
});
