/**
 * E2E: Date Picker — navigate calendar widget to select a specific date.
 *
 * Tests: multi-step widget interaction, precise click targeting
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

const h = createE2EHarness({ maxTurns: 25, testLabel: "date-picker" });

describe.skipIf(!h.apiKey)("E2E: Date Picker", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("date-picker"));
  afterAll(() => h.afterAllHook());

  it("agent fills name, navigates calendar to June 15 2026, and books appointment", async () => {
    await navigateAndWait(h.page, getFixtureUrl("date-picker"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "This is a booking form with a custom calendar date picker.",
      "",
      "Step 1: Type 'John Smith' into the Full Name field.",
      "",
      "Step 2: Click the date field ('Click to select a date...') to open the calendar.",
      "",
      "Step 3: The calendar starts on March 2026. Navigate forward to June 2026 by clicking the '>' (next month) button 3 times.",
      "",
      "Step 4: Once you see 'June 2026', click on day 15.",
      "",
      "Step 5: Click 'Book Appointment'.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).datePickerResult ?? null,
        );
        if (result && result.date) return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        booking: document.getElementById("booking-confirmation")?.textContent || "",
        datePickerResult: (window as any).datePickerResult,
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
    expect(result.name).toBe("John Smith");
    expect(result.date).toBe("2026-06-15");
    expect(result.correct).toBe(true);

    console.log(`\n[e2e] PASS — Appointment booked`);
    console.log(`[e2e]   Name: ${result.name}`);
    console.log(`[e2e]   Date: ${result.date}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 10_000, workspaceId);
  }, 320_000);
});
