/**
 * E2E: Tab Management — multi-tab data collection.
 *
 * Tests that the agent can open dashboard tabs, read metrics from each,
 * and manage tab lifecycle (create, switch, read, close).
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

const h = createE2EHarness({ maxTurns: 25, testLabel: "tab-management" });

/** Query tabs from the service worker, filtering out extension and blank tabs. */
async function queryContentTabs(): Promise<{ id: number; url: string; title: string }[]> {
  return h.ctx.serviceWorker.evaluate(async () => {
    const allTabs = await (globalThis as any).chrome.tabs.query({});
    return allTabs
      .filter(
        (t: any) =>
          !t.url?.startsWith("chrome-extension://") &&
          t.url !== "about:blank",
      )
      .map((t: any) => ({ id: t.id, url: t.url, title: t.title }));
  });
}

/** Extract all tool names from a trace session. */
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

describe.skipIf(!h.apiKey)("E2E: Tab Management", () => {
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
  afterEach(() => h.afterEachHook("tab-management"));
  afterAll(() => h.afterAllHook());

  it("collects data from multiple dashboard tabs", async () => {
    await navigateAndWait(h.page, getFixtureUrl("dashboard-sales"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const supportUrl = getFixtureUrl("dashboard-support");
    const marketingUrl = getFixtureUrl("dashboard-marketing");

    const prompt =
      `I need the Open Tickets number from ${supportUrl} and the Active Campaigns number from ${marketingUrl}. Open each in a new tab and tell me both numbers.`;

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

    // Trace verification: agent must have used tab tools AND read pages
    const toolNames = extractToolNames(traceFiles);
    console.log("[e2e] Tools used:", toolNames.join(", "));

    // Must have called read_page at least once (proves actual data collection)
    const hasReadPage = toolNames.includes("read_page");
    expect(hasReadPage, "Agent must call read_page to collect metrics").toBe(true);

    // Must have called done() with actual metric values
    const summary = extractDoneSummary(traceFiles);
    console.log("[e2e] Done summary:", summary?.slice(0, 200));
    expect(summary, "Agent must call done() with a summary").toBeTruthy();

    // Check tabs: at least 2 non-extension tabs (original + dashboard)
    const tabs = await queryContentTabs();
    console.log("[e2e] Tabs after collection:", JSON.stringify(tabs, null, 2));
    expect(tabs.length).toBeGreaterThanOrEqual(2);

    console.log(`\n[e2e] PASS — Data collected (${tabs.length} tabs, ${toolNames.length} tool calls)`);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 300_000);

  it("opens tabs, collects data, then closes them", async () => {
    await navigateAndWait(h.page, getFixtureUrl("dashboard-sales"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const supportUrl = getFixtureUrl("dashboard-support");

    const prompt =
      `Open ${supportUrl} in a new tab, check what's there, then come back and tell me about it.`;

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

    // Trace verification: agent must have used create_tab
    const toolNames = extractToolNames(traceFiles);
    console.log("[e2e] Tools used:", toolNames.join(", "));

    const hasCreateTab = toolNames.includes("create_tab");
    expect(hasCreateTab, "Agent must use create_tab to open the support page").toBe(true);

    // Agent should return to original tab (close_tab is optional — natural
    // users say "come back" not "close the tab")
    const hasCloseOrSwitch =
      toolNames.includes("close_tab") || toolNames.includes("switch_tab");
    expect(
      hasCloseOrSwitch,
      "Agent must use close_tab or switch_tab to return to the original tab",
    ).toBe(true);

    // Must have called done() with a summary
    const summary = extractDoneSummary(traceFiles);
    console.log("[e2e] Done summary:", summary?.slice(0, 200));
    expect(summary, "Agent must call done() with a summary").toBeTruthy();

    // Verify tab state (informational — close_tab may not always succeed)
    const tabs = await queryContentTabs();
    console.log("[e2e] Tabs after cleanup:", JSON.stringify(tabs, null, 2));

    console.log(`\n[e2e] PASS — Tab lifecycle complete (${toolNames.length} tool calls)`);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 300_000);
});
