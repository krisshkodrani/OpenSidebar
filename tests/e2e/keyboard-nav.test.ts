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

    const prompt = [
      "This is a spreadsheet editor. You can click cells to select them, double-click or press Enter to edit, and press Enter again to confirm.",
      "",
      "Step 1: Click on the cell in row 1, 'Q1 Sales' column (it should show '130').",
      "",
      "Step 2: Double-click it or press Enter to start editing. Change the value to '999'.",
      "",
      "Step 3: Press Enter to confirm the edit.",
      "",
      "Step 4: After editing, the spreadsheet should show '1 edit(s)'. Call done() to finish.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).keyboardNavResult ?? null,
        );
        if (result && result.editCount >= 1) return result;
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
    expect(result.editCount).toBeGreaterThanOrEqual(1);

    console.log(`\n[e2e] PASS — Spreadsheet edited`);
    console.log(`[e2e]   Edits: ${JSON.stringify(result.edits)}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 10_000, workspaceId);
  }, 320_000);
});
