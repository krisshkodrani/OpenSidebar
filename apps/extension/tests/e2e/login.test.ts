/**
 * E2E: Login — authenticate with email/password, check remember-me,
 * wait for redirect to dashboard.
 *
 * Tests: password field interaction, auth flow, post-login redirect
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

const h = createE2EHarness({ maxTurns: 20, testLabel: "login" });

describe.skipIf(!h.apiKey)("E2E: Login", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("login"));
  afterAll(() => h.afterAllHook());

  it("agent logs in with credentials and reaches authenticated dashboard", async () => {
    await navigateAndWait(h.page, getFixtureUrl("login"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Log in with email admin@example.com and password secret123. Check the Remember me box too.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).loginResult ?? null,
        );
        if (result && result.authenticated) return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        welcomeMessage: document.getElementById("welcome-message")?.textContent || "",
        loginError: document.getElementById("login-error")?.textContent || "",
        emailValue:
          (document.getElementById("login-email") as HTMLInputElement)?.value || "",
        passwordValue:
          (document.getElementById("login-password") as HTMLInputElement)?.value || "",
        loginResult: (window as any).loginResult,
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
    expect(result.authenticated).toBe(true);
    expect(result.email).toBe("admin@example.com");

    console.log(`\n[e2e] PASS — Login successful`);
    console.log(`[e2e]   Email: ${result.email}`);
    console.log(`[e2e]   Remember me: ${result.rememberMe}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
