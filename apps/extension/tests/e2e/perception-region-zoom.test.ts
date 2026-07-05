/**
 * E2E: inspect_region reads a value that exists only as canvas fine print
 * (RFC LP-13). The fixture's answer is absent from the DOM/aria tree and
 * illegible in the base screenshot, so a correct answer that used
 * inspect_region proves the magnification path end to end.
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

const h = createE2EHarness({ maxTurns: 6, testLabel: "perception-region-zoom" });

describe.skipIf(!h.apiKey)("E2E: inspect_region zoom", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("perception-region-zoom"));
  afterAll(() => h.afterAllHook());

  it("reads canvas fine print via inspect_region magnification", async () => {
    await updateUserSettings(h.ctx, {
      laneTopologyMode: "simple",
      perceptionMode: "auto",
    });
    await navigateAndWait(h.page, getFixtureUrl("visual-canvas-small"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const workspaceId = await sendUserChat(
      h.ctx,
      "Read the fine print under the chart and tell me the Q3 net margin.",
      tabId,
    );

    const outcome = await waitForTaskCompletion(h.ctx, 150_000, workspaceId);
    expect(outcome.ok, JSON.stringify(outcome.events.slice(-10), null, 2)).toBe(
      true,
    );

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const traceFiles = filterTraceFilesByWorkspace(
      findAllNewTraceFiles(h.tracesBefore),
      workspaceId,
    );
    expect(traceFiles.length).toBeGreaterThan(0);

    // The zoom actually happened (not a lucky hallucination)…
    expect(traceFilesContainText(traceFiles, '"type":"inspect_region"')).toBe(
      true,
    );
    // …and the answer is the value that exists only in the canvas pixels.
    const summary = extractDoneSummary(traceFiles);
    expect(summary).toMatch(/4\.7\s*%/);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 210_000);
});
