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
import {
  assertNoGhostSession,
  getActiveTabId,
  getUserTabUrls,
  navigateAndWait,
  restartExtensionAndMonitor,
  sendUserChat,
  updateUserSettings,
  waitForTabCount,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { readTrace } from "./helpers/diagnostics";

const h = createE2EHarness({
  maxTurns: 24,
  testLabel: "mutation-dedupe-recovery",
});

function countToolCalls(traceFiles: string[], toolName: string): number {
  return traceFiles.reduce(
    (count, filePath) =>
      count +
      readTrace(filePath).reduce(
        (sum, turn) =>
          sum +
          turn.toolCalls.filter((toolCall) => toolCall.name === toolName)
            .length,
        0,
      ),
    0,
  );
}

function countOpeningMutations(traceFiles: string[]): number {
  return (
    countToolCalls(traceFiles, "create_tab") +
    countToolCalls(traceFiles, "click_element")
  );
}

describe.skipIf(!h.apiKey)("E2E: Mutation Dedupe Recovery", () => {
  beforeAll(async () => {
    await h.beforeAllHook();
    await updateUserSettings(h.ctx, {
      allowNavigation: true,
      requireApprovals: false,
    });
  }, 120_000);

  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("mutation-dedupe-recovery"));
  afterAll(() => h.afterAllHook());

  it("does not replay create_tab after a restart that happens immediately after the tab opens", async () => {
    await navigateAndWait(h.page, getFixtureUrl("procurement"));
    await h.page.bringToFront();

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Open the TechDirect store in a new tab for me. Just get it open — I'll take it from there.";
    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    await waitForTabCount(h.ctx.serviceWorker, 2, 120_000, workspaceId);

    await restartExtensionAndMonitor(h.ctx);

    const outcome = await waitForTaskCompletion(h.ctx, 300_000, workspaceId);
    const { traceFiles } = await h.printTraceSummary(workspaceId);

    if (!outcome.ok) {
      console.log(
        "[mutation-dedupe-recovery] FAILURE:",
        JSON.stringify(
          { reason: outcome.reason, events: outcome.events.slice(-12) },
          null,
          2,
        ),
      );
    }

    const finalUserTabUrls = await getUserTabUrls(h.ctx.serviceWorker);
    expect(outcome.ok, outcome.reason).toBe(true);
    expect(finalUserTabUrls.length).toBe(2);
    expect(
      finalUserTabUrls.filter((url) => url.includes("?store=techdirect"))
        .length,
    ).toBe(1);
    expect(countOpeningMutations(traceFiles)).toBe(1);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 420_000);
});
