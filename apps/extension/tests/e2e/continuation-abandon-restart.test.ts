/**
 * E2E: Continuation — Abandon and Restart (full reset).
 *
 * Tests that the agent can completely wipe a partially-filled form
 * and start over with new data when the user changes their mind.
 *
 * Turn 1: Fill name, email, phone
 * Turn 2: Scrap everything, start over with different data
 * Turn 3: Select category and submit
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/continuation-abandon-restart.test.ts
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
  settleWorkspaceBetweenTurns,
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 15, testLabel: "abandon-restart" });

const TURN_TIMEOUT = 180_000;

/** Read the current form field values from the DOM */
function readFormFields(page: any) {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input, textarea"));
    const fields: Record<string, string> = {};
    for (const el of inputs) {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const key =
        input.placeholder?.toLowerCase().replace(/[^a-z]/g, "_") ||
        input.name ||
        input.id ||
        "unknown";
      fields[key] = input.value;
    }
    return fields;
  });
}

describe.skipIf(!h.apiKey)("E2E: Continuation — Abandon & Restart", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("abandon-restart"));
  afterAll(() => h.afterAllHook());

  it("clears a partially-filled form and restarts with new data", async () => {
    await navigateAndWait(h.page, getFixtureUrl("form"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const workspaceId = `e2e-abandon-${crypto.randomUUID()}`;

    // =================================================================
    // TURN 1: Fill with Alice's data
    // =================================================================
    console.log("\n[abandon] === TURN 1: Fill as Alice ===");

    await sendUserChat(
      h.ctx,
      "Fill only the personal information fields with: name Alice Johnson, email alice@test.com, phone 555-0100. Stop after those fields; do not click Next or submit.",
      tabId,
      workspaceId,
    );

    const turn1 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const fields = await readFormFields(h.page);
        const values = Object.values(fields).join(" ").toLowerCase();
        if (values.includes("alice") && values.includes("555-0100")) {
          return fields;
        }
        return null;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn1.ok) {
      const fields = await readFormFields(h.page);
      console.log("[abandon] TURN 1 FAIL:", { reason: turn1.reason, fields });
    }
    expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);

    console.log("[abandon] Turn 1 PASS — Form filled with Alice's data");

    // =================================================================
    // TRANSITION
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

    // =================================================================
    // TURN 2: Scrap and restart with Bob
    // =================================================================
    console.log("\n[abandon] === TURN 2: Scrap and restart as Bob ===");

    await sendUserChat(
      h.ctx,
      "Actually, scrap all of that. Clear everything and start over with: " +
        "name Bob Martinez, email bob@company.com, phone 555-0200. Stop after those personal information fields; do not click Next or submit.",
      tabId,
      workspaceId,
    );

    const turn2 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const fields = await readFormFields(h.page);
        const values = Object.values(fields).join(" ").toLowerCase();
        // Bob's data must be present
        const hasBob = values.includes("bob") && values.includes("555-0200");
        // Alice's data must be gone
        const hasAlice = values.includes("alice") || values.includes("555-0100");
        return hasBob && !hasAlice ? fields : null;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn2.ok) {
      const fields = await readFormFields(h.page);
      console.log("[abandon] TURN 2 FAIL:", { reason: turn2.reason, fields });
    }
    expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);

    // Verify ALL of Alice's data was cleared
    const fieldsAfterReset = await readFormFields(h.page);
    const allValues = Object.values(fieldsAfterReset).join(" ").toLowerCase();
    expect(allValues).not.toContain("alice");
    expect(allValues).not.toContain("alice@test.com");
    expect(allValues).not.toContain("555-0100");
    // Bob's data should be there
    expect(allValues).toContain("bob");
    expect(allValues).toContain("bob@company.com");

    console.log("[abandon] Turn 2 PASS — Form reset with Bob's data");
    console.log("[abandon]   Fields:", JSON.stringify(fieldsAfterReset));

    // =================================================================
    // TRANSITION
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

    // =================================================================
    // TURN 3: Select category and submit
    // =================================================================
    console.log("\n[abandon] === TURN 3: Select category and submit ===");

    await sendUserChat(
      h.ctx,
      "Select Business for the category, pick the Standard budget, and submit the form.",
      tabId,
      workspaceId,
    );

    const turn3 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).formResult ?? null,
        );
        return result;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn3.ok) {
      console.log("[abandon] TURN 3 FAIL:", { reason: turn3.reason });
    }
    expect(turn3.ok, `Turn 3 failed: ${turn3.reason}`).toBe(true);

    const result = turn3.result as any;

    // Final form should have Bob's data, not Alice's
    expect(result.name).toBe("Bob Martinez");
    expect(result.email).toBe("bob@company.com");
    expect(result.phone).toBe("555-0200");
    expect(result.category.toLowerCase()).toContain("business");
    expect(result.refNumber).toBeTruthy();

    console.log(`[abandon] Turn 3 PASS — Submitted as ${result.name}`);
    console.log(`[abandon]   Ref: ${result.refNumber}, Category: ${result.category}`);

    // =================================================================
    // Final checks
    // =================================================================
    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

    console.log("\n[abandon] === ALL 3 TURNS PASSED ===");
  }, 600_000);
});
