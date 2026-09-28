import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  assertNoGhostSession,
  getActiveTabId,
  getMonitoredEventsWithControlLane,
  navigateAndWait,
  resyncWorkspace,
  seedPendingInteraction,
  sendApprovalResponse,
  sendUserChat,
  stopAgent,
  waitForMonitoredEvent,
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

const h = createE2EHarness({ maxTurns: 12, testLabel: "terminal-lifecycle", videoStart: "manual" });

async function completions(workspaceId: string) {
  return (await getMonitoredEventsWithControlLane(h.ctx.serviceWorker, 400))
    .filter((event) => event.type === "TASK_COMPLETION" &&
      event.channel === "runtime" && event.workspaceId === workspaceId);
}

describe.skipIf(!enabled)("E2E: terminal lifecycle", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("terminal-lifecycle"));
  afterAll(() => h.afterAllHook());

  it("replays the exact completed payload on workspace resync", async () => {
    const scenario = localMockProviderScenarios["done-summary-incomplete-recovery"];
    const cdp = await h.ctx.serviceWorkerTarget.createCDPSession();
    try {
      await installLocalMockProviderInterceptor(cdp, "done-summary-incomplete-recovery");
      await navigateAndWait(h.page, getFixtureUrl(scenario.fixture));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      const workspaceId = await sendUserChat(h.ctx, scenario.prompt, tabId);
      const outcome = await waitForTaskCompletion(h.ctx, scenario.timeoutMs, workspaceId);
      expect(outcome.ok, outcome.reason).toBe(true);

      const initial = await completions(workspaceId);
      expect(initial).toHaveLength(1);
      expect(initial[0].payload.taskId).toBeTruthy();

      await resyncWorkspace(h.ctx, workspaceId);
      await waitForMonitoredEvent(h.ctx.serviceWorker,
        (event) => event.type === "TASK_COMPLETION" &&
          event.channel === "runtime" && event.seq !== initial[0].seq,
        10_000, workspaceId);
      await resyncWorkspace(h.ctx, workspaceId);
      await expect.poll(async () => (await completions(workspaceId)).length).toBe(3);

      const replayed = await completions(workspaceId);
      expect(replayed.map((event) => event.payload)).toEqual([
        initial[0].payload, initial[0].payload, initial[0].payload,
      ]);
      await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
    } finally {
      await cdp.detach().catch(() => {});
    }
  }, 240_000);

  it("ignores a late approval after stopping a pending task", async () => {
    await navigateAndWait(h.page, getFixtureUrl("article"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    const seeded = await seedPendingInteraction(h.ctx, {
      tabId,
      interaction: {
        kind: "approval",
        toolName: "create_tab",
        args: { url: "https://example.test/" },
        context: "Open a new tab.",
      },
    });
    await waitForMonitoredEvent(h.ctx.serviceWorker,
      (event) => event.type === "APPROVAL_REQUEST" && event.approvalId === seeded.interactionId,
      10_000, seeded.workspaceId);

    await stopAgent(h.ctx, seeded.workspaceId);
    await expect.poll(async () => (await completions(seeded.workspaceId)).length).toBe(1);
    const [completion] = await completions(seeded.workspaceId);
    expect(completion.status).toBe("stopped");
    expect(completion.payload.taskId).toBe(seeded.taskId);

    await sendApprovalResponse(h.ctx, seeded.interactionId, true, seeded.workspaceId);
    expect(await completions(seeded.workspaceId)).toHaveLength(1);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, seeded.workspaceId);
    expect(await completions(seeded.workspaceId)).toHaveLength(0);
  }, 60_000);
});
