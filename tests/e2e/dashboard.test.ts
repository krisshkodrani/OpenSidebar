/**
 * E2E: Dashboard — switch to Settings tab, enter email, save settings.
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

const h = createE2EHarness({ maxTurns: 20, testLabel: "dashboard" });

describe.skipIf(!h.apiKey)("E2E: Dashboard", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("dashboard"));
  afterAll(() => h.afterAllHook());

  it("agent reads table data, switches to Settings tab, and saves settings", async () => {
    await navigateAndWait(h.page, getFixtureUrl("dashboard"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Go to the Settings tab, change the notification email to admin@test.com, and save it.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const settings = await h.page.evaluate(
          () => (window as any).dashboardSettings ?? null,
        );
        return settings || null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        activeTab:
          document.querySelector(".tab-btn.active")?.textContent?.trim() || "",
        toastVisible: !document
          .getElementById("settings-toast")
          ?.classList.contains("hidden"),
        settingsEmail:
          (document.getElementById("settings-email") as HTMLInputElement)
            ?.value || "",
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

    const settings = outcome.result as any;
    expect(settings).toBeTruthy();
    expect(settings.email).toBe("admin@test.com");
    expect(settings.savedAt).toBeTruthy();

    console.log(`\n[e2e] PASS — Settings saved`);
    console.log(`[e2e]   Email: ${settings.email}`);
    console.log(`[e2e]   Timezone: ${settings.timezone}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
