import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForTaskCompletion,
} from "./helpers/utils";
import {
  installLocalMockProviderInterceptor,
  localMockProviderScenarios,
} from "./helpers/local-mock-provider";

const enabled = process.env.E2E_LOCAL_MOCK_PROVIDER === "1";
if (enabled) {
  process.env.E2E_PROVIDER = "fireworks";
  process.env.FIREWORKS_API_KEY ||= "local-mock";
}

const scenario = localMockProviderScenarios["requested-fact-after-navigation"];
const h = createE2EHarness({
  maxTurns: scenario.maxTurns,
  testLabel: scenario.label,
  videoStart: "manual",
});

describe.skipIf(!enabled)("E2E: requested facts across navigation", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook(scenario.label));
  afterAll(() => h.afterAllHook());

  test("returns an observed value after two real page transitions", async () => {
    const cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
    try {
      await installLocalMockProviderInterceptor(
        cdp,
        "requested-fact-after-navigation",
      );
      await navigateAndWait(h.page, getFixtureUrl(scenario.fixture));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      const workspaceId = await sendUserChat(h.ctx, scenario.prompt, tabId);
      const outcome = await waitForTaskCompletion(
        h.ctx,
        scenario.timeoutMs,
        workspaceId,
      );
      expect(outcome.ok, outcome.reason).toBe(true);

      const completion = outcome.events.findLast(
        (event: { type?: string; workspaceId?: string; payload?: { summary?: string } }) =>
          event.type === "TASK_COMPLETION" && event.workspaceId === workspaceId,
      );
      expect(completion?.payload.summary).toContain("3,156 units");
      expect(h.page.url()).toContain("step=3");
    } finally {
      await cdp.detach().catch(() => {});
    }
  }, 240_000);
});
