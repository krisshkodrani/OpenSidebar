/**
 * E2E: auto perception selects vision for visual pages/tasks.
 */

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
  extractDoneSummary,
  findAllNewTraceFiles,
  filterTraceFilesByWorkspace,
  traceFilesContainText,
} from "./helpers/diagnostics";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  updateUserSettings,
  waitForTaskCompletion,
} from "./helpers/utils";

const h = createE2EHarness({ maxTurns: 4, testLabel: "perception-auto-vision" });

describe.skipIf(!h.apiKey)("E2E: perception auto vision", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("perception-auto-vision"));
  afterAll(() => h.afterAllHook());

  it("auto mode chooses unified VL for a canvas chart task", async () => {
    await updateUserSettings(h.ctx, {
      laneTopologyMode: "simple",
      perceptionMode: "auto",
    });
    await navigateAndWait(h.page, getFixtureUrl("visual-canvas"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const workspaceId = await sendUserChat(
      h.ctx,
      "Look at the chart on this page and tell me the highlighted Q4 score.",
      tabId,
    );

    const outcome = await waitForTaskCompletion(h.ctx, 120_000, workspaceId);
    expect(outcome.ok, JSON.stringify(outcome.events.slice(-10), null, 2)).toBe(
      true,
    );

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const traceFiles = filterTraceFilesByWorkspace(
      findAllNewTraceFiles(h.tracesBefore),
      workspaceId,
    );
    expect(traceFiles.length).toBeGreaterThan(0);

    expect(traceFilesContainText(traceFiles, '"tagName":"canvas"')).toBe(true);
    expect(
      traceFilesContainText(traceFiles, "[image]Current page screenshot."),
    ).toBe(true);

    const summary = extractDoneSummary(traceFiles);
    expect(summary).toMatch(/\b72\b/);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 180_000);
});
