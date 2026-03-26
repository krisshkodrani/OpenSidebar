/**
 * E2E: File Upload — fill support ticket form and submit.
 *
 * Tests: form fill with textarea + select + submit (upload_file is hard to
 * test reliably in E2E without a stable file URL, so this test focuses on
 * the form workflow; upload_file tool coverage is a bonus if the agent uses it).
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

const h = createE2EHarness({ maxTurns: 20, testLabel: "file-upload" });

describe.skipIf(!h.apiKey)("E2E: File Upload", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("file-upload"));
  afterAll(() => h.afterAllHook());

  it("agent fills and submits a support ticket form", async () => {
    await navigateAndWait(h.page, getFixtureUrl("file-upload"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "This is a support ticket submission form. Complete these steps:",
      "",
      "Step 1: Type 'Bug Report' into the Subject field.",
      "",
      "Step 2: Type 'The login button is broken on mobile devices and does not respond to taps.' into the Description field.",
      "",
      "Step 3: Change the Priority dropdown to 'High'.",
      "",
      "Step 4: Click 'Submit Ticket'.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).uploadResult ?? null,
        );
        if (result && result.subject) return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        confirmation: document.getElementById("ticket-confirmation")?.textContent || "",
        error: document.getElementById("ticket-error")?.textContent || "",
        uploadResult: (window as any).uploadResult,
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
    expect(result.subject).toBe("Bug Report");
    expect(result.priority).toBe("High");

    console.log(`\n[e2e] PASS — Support ticket submitted`);
    console.log(`[e2e]   Subject: ${result.subject}`);
    console.log(`[e2e]   Priority: ${result.priority}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 10_000, workspaceId);
  }, 320_000);
});
