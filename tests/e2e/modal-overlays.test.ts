/**
 * E2E: Modal Overlays — dismiss cookie banner, close newsletter popup,
 * fill form behind overlays, confirm deletion dialog.
 *
 * Tests: dismiss_overlays, hide_element, modal interaction
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

const h = createE2EHarness({ maxTurns: 25, testLabel: "modal-overlays" });

describe.skipIf(!h.apiKey)("E2E: Modal Overlays", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("modal-overlays"));
  afterAll(() => h.afterAllHook());

  it("agent dismisses overlays, fills form, and confirms deletion dialog", async () => {
    await navigateAndWait(h.page, getFixtureUrl("modal-overlays"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    // Wait for cookie banner + newsletter modal to appear
    await new Promise((r) => setTimeout(r, 3000));

    const prompt = [
      "This page has popup overlays blocking the content. Complete these steps:",
      "",
      "Step 1: Dismiss or close any cookie banners and newsletter popups that are covering the page.",
      "",
      "Step 2: In the Account Settings section, type 'user@test.com' into the Notification Email field.",
      "",
      "Step 3: Click the 'Delete Account' button.",
      "",
      "Step 4: When the confirmation dialog appears, click 'Confirm Delete'.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).modalResult ?? null,
        );
        if (result && result.deleteConfirmed && result.formFilled) return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        cookieBannerVisible: !!document.getElementById("cookie-banner"),
        newsletterVisible: !!document.getElementById("newsletter-backdrop"),
        confirmVisible: !!document.getElementById("confirm-backdrop"),
        emailValue:
          (document.getElementById("account-email") as HTMLInputElement)?.value || "",
        modalResult: (window as any).modalResult,
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
    expect(result.deleteConfirmed).toBe(true);
    expect(result.formFilled).toBe(true);

    console.log(`\n[e2e] PASS — Overlays dismissed, form filled, deletion confirmed`);

    await assertNoGhostSession(h.ctx.serviceWorker, 10_000, workspaceId);
  }, 320_000);
});
