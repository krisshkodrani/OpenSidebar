/**
 * E2E: Keyboard Navigation — navigate spreadsheet with arrow keys,
 * edit cells, save with Ctrl+S.
 *
 * Tests: press_key with modifiers, keyboard-driven workflows
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

const h = createE2EHarness({ maxTurns: 25, testLabel: "keyboard-nav" });
const EXPECTED_FINAL_DATA = [
  ["Widget A", "999", "160", "190"],
  ["Widget B", "180", "210", "240"],
  ["Gadget C", "230", "260", "290"],
  ["Service D", "280", "310", "340"],
  ["Bundle E", "330", "360", "390"],
];
const EXPECTED_ONLY_EDIT = {
  row: 0,
  col: 1,
  oldVal: "130",
  newVal: "999",
};

describe.skipIf(!h.apiKey)("E2E: Keyboard Navigation", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("keyboard-nav"));
  afterAll(() => h.afterAllHook());

  it("agent edits a spreadsheet cell and saves", async () => {
    await navigateAndWait(h.page, getFixtureUrl("keyboard-nav"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "In the spreadsheet, change the Q1 Sales value in the first row to 999.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).keyboardNavResult ?? null,
        );
        if (result && result.currentData?.[0]?.[1] === "999") return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        keyboardNavResult: (window as any).keyboardNavResult,
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
    expect(result.currentData).toEqual(EXPECTED_FINAL_DATA);
    expect(result.edits).toEqual([EXPECTED_ONLY_EDIT]);
    expect(result.editCount).toBe(1);

    console.log(`\n[e2e] PASS — Spreadsheet edited`);
    console.log(`[e2e]   Edits: ${JSON.stringify(result.edits)}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
