import { describe, expect, test } from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";
import {
  installLocalMockProviderInterceptor,
  localMockProviderScenarios,
  type LocalMockProviderScenarioName,
} from "./helpers/local-mock-provider";

const enabled = process.env.E2E_LOCAL_MOCK_PROVIDER === "1";

if (enabled) {
  process.env.E2E_PROFILE = "video";
  process.env.E2E_PROVIDER = "fireworks";
  process.env.FIREWORKS_API_KEY =
    process.env.FIREWORKS_API_KEY || "local-mock";
}

async function runLocalScenario(name: LocalMockProviderScenarioName) {
  const scenario = localMockProviderScenarios[name];
  const h = createE2EHarness({
    maxTurns: scenario.maxTurns,
    testLabel: scenario.label,
  });
  let passed = false;
  let cdp: { detach: () => Promise<void> } | null = null;

  try {
    await h.beforeAllHook();
    cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
    await installLocalMockProviderInterceptor(cdp, name);
    await h.beforeEachHook();
    await navigateAndWait(h.page, getFixtureUrl(scenario.fixture));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    const workspaceId = await sendUserChat(h.ctx, scenario.prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        if (name === "login") {
          const result = await h.page.evaluate(
            () => (window as any).loginResult ?? null,
          );
          return result?.authenticated ? result : null;
        }
        return h.page.evaluate(() => (window as any).challengeResult ?? null);
      },
      scenario.timeoutMs,
      workspaceId,
    );

    passed = outcome.ok;
    if (!outcome.ok) {
      console.log(JSON.stringify({ outcome }, null, 2));
    }
    expect(outcome.ok, outcome.reason).toBe(true);
    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  } finally {
    await h.afterEachHook(scenario.label, passed);
    if (cdp) await cdp.detach().catch(() => {});
    await h.afterAllHook().catch(() => {});
  }
}

describe.skipIf(!enabled)("local mock provider video UX RFC validation", () => {
  test(
    "login flow completes with local provider interception",
    async () => {
      await runLocalScenario("login");
    },
    240_000,
  );

  test(
    "navigation challenge completes with local provider interception",
    async () => {
      await runLocalScenario("navigation");
    },
    240_000,
  );
});
