/**
 * E2E: Multi-Step Form — complete a 3-step wizard with conditional fields.
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
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 30, testLabel: "multi-step-form" });

describe.skipIf(!h.apiKey)("E2E: Multi-Step Form", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("multi-step-form"));
  afterAll(() => h.afterAllHook());

  it("agent completes a 3-step wizard with conditional fields", async () => {
    await navigateAndWait(h.page, getFixtureUrl("form"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "Complete this 3-step form. Do NOT navigate away from this page.",
      "",
      "Step 1: Fill Personal Info — type_text Name: Jane Smith, Email: jane@example.com, Phone: 555-0123. Click Next.",
      "Step 2: Fill Preferences — use select_option to set Category to Enterprise. This reveals a Company Name field — type Acme Corp. Use set_checkbox to select Budget: Premium ($2,000+). Type Special Requirements: Priority support needed. Click Next.",
      "Step 3: Review & Submit — use set_checkbox to check the confirmation checkbox, then click Submit.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).formResult ?? null,
        );
        return result || null;
      },
      300_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        step1Visible:
          (document.getElementById("step-1") as HTMLElement)?.style.display !==
          "none",
        step2Visible:
          (document.getElementById("step-2") as HTMLElement)?.style.display !==
          "none",
        step3Visible:
          (document.getElementById("step-3") as HTMLElement)?.style.display !==
          "none",
        confirmVisible: !document
          .getElementById("confirmation-panel")
          ?.classList.contains("hidden"),
        errors: Array.from(document.querySelectorAll("[id^=error-]"))
          .filter((el) => el.textContent?.trim())
          .map((el) => `${el.id}: ${el.textContent?.trim()}`),
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
    expect(result).toBeTruthy();
    expect(result.name).toBe("Jane Smith");
    expect(result.email).toBe("jane@example.com");
    expect(result.category).toBe("Enterprise");
    expect(result.company).toBe("Acme Corp");
    expect(result.budget).toMatch(/premium/i);
    expect(result.refNumber).toMatch(/^REF-/);

    const confirmVisible = await h.page.evaluate(
      () =>
        !document
          .getElementById("confirmation-panel")
          ?.classList.contains("hidden"),
    );
    expect(confirmVisible).toBe(true);

    console.log(`\n[e2e] PASS — Form submitted: ${result.refNumber}`);
    console.log(`[e2e]   Name: ${result.name}, Email: ${result.email}`);
    console.log(
      `[e2e]   Category: ${result.category}, Company: ${result.company}`,
    );
    console.log(`[e2e]   Budget: ${result.budget}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 380_000);
});
