/**
 * E2E: Web Components — interact with Shadow DOM custom elements.
 *
 * Tests: tagging/snapshot penetration of shadow roots, clicking inside shadow DOM
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

const h = createE2EHarness({ maxTurns: 25, testLabel: "web-components" });

describe.skipIf(!h.apiKey)("E2E: Web Components", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("web-components"));
  afterAll(() => h.afterAllHook());

  it("agent interacts with custom elements inside Shadow DOM", async () => {
    await navigateAndWait(h.page, getFixtureUrl("web-components"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "This page uses web components with Shadow DOM. There are custom cards, an input, and a toggle switch.",
      "",
      "Step 1: Click the 'Take Action' button inside the 'Notification Settings' card.",
      "",
      "Step 2: Click the 'Take Action' button inside the 'Privacy Settings' card.",
      "",
      "Step 3: Click on the dark mode toggle switch to enable it.",
      "",
      "The interaction status section at the bottom should update to show your actions.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).webComponentResult ?? null,
        );
        if (result && result.actionsCompleted >= 2 && result.toggleEnabled) return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        status: document.getElementById("component-status")?.textContent || "",
        webComponentResult: (window as any).webComponentResult,
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
    expect(result.actionsCompleted).toBeGreaterThanOrEqual(2);
    expect(result.toggleEnabled).toBe(true);

    console.log(`\n[e2e] PASS — Shadow DOM interactions complete`);
    console.log(`[e2e]   Actions: ${result.actions.join(", ")}`);
    console.log(`[e2e]   Toggle: ${result.toggleEnabled}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 10_000, workspaceId);
  }, 320_000);
});
