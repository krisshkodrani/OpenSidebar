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

    const prompt = "Activate the Notification Settings and Privacy Settings actions, then turn on dark mode.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        // Check both React state and direct shadow DOM window flags
        const result = await h.page.evaluate(() => {
          const react = (window as any).webComponentResult ?? null;
          const shadowActions = (window as any).__shadowActions ?? [];
          const toggleDirect = (window as any).__toggleEnabled ?? false;
          const actionsCount = Math.max(react?.actionsCompleted ?? 0, shadowActions.length);
          const toggleOn = react?.toggleEnabled ?? toggleDirect;
          if (actionsCount >= 2 && toggleOn) {
            return { actionsCompleted: actionsCount, actions: shadowActions, toggleEnabled: toggleOn };
          }
          return null;
        });
        return result;
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

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
