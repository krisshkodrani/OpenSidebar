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
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  stopAgent,
  waitForMonitoredEvent,
  waitForTabCount,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({
  maxTurns: 40,
  testLabel: "stop-drain-recovery",
});

describe.skipIf(!h.apiKey)("E2E: Safe Stop Drain", () => {
  beforeAll(async () => {
    await h.beforeAllHook();
    await h.page.bringToFront();
    const helper = await h.ctx.browser.newPage();
    try {
      await helper.goto(
        `chrome-extension://${h.ctx.extensionId}/e2e-helper.html`,
        {
          waitUntil: "domcontentloaded",
        },
      );
      await helper.evaluate(async () => {
        const existing =
          ((await chrome.storage.sync.get("userSettings")).userSettings as
            | Record<string, unknown>
            | undefined) ?? {};
        await chrome.storage.sync.set({
          userSettings: {
            ...existing,
            allowNavigation: true,
            requireApprovals: false,
          },
        });
      });
    } finally {
      await helper.close().catch(() => {});
    }
  }, 60_000);

  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("stop-drain-recovery"));
  afterAll(() => h.afterAllHook());

  it("stops a live procurement workflow at the next safe point without spawning a ghost session", async () => {
    await navigateAndWait(h.page, getFixtureUrl("procurement"));
    await h.page.bringToFront();

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Buy the first two items from the procurement list. Open each store in a new tab, purchase the item, then come back and check it off.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    await waitForTabCount(h.ctx.serviceWorker, 2, 120_000, workspaceId);
    await waitForMonitoredEvent(
      h.ctx.serviceWorker,
      (event) => event.type === "AGENT_STATUS" && event.status === "ACTING",
      30_000,
      workspaceId,
    );

    await stopAgent(h.ctx, workspaceId);

    const outcome = await waitForTaskCompletion(h.ctx, 180_000, workspaceId);
    await h.printTraceSummary(workspaceId);
    const checkedItems = await h.page.evaluate(
      () =>
        ((window as any).__procurementChecked as string[] | undefined) ?? [],
    );
    const completion = [...outcome.events]
      .reverse()
      .find((event) => event.type === "TASK_COMPLETION");
    const sawStoppingStatus = outcome.events.some(
      (event) =>
        event.type === "AGENT_STATUS" &&
        String(event.detail ?? "").includes("Stopping at next safe point"),
    );

    expect(outcome.ok).toBe(false);
    expect(String(completion?.payload?.summary ?? "")).toContain(
      "Stopped by user",
    );
    expect(["partial", "failed"]).toContain(String(completion?.status ?? ""));
    expect(checkedItems.length).toBeLessThan(2);
    expect(
      sawStoppingStatus,
      "Workspace should publish a stopping status before final completion",
    ).toBe(true);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 300_000);
});
