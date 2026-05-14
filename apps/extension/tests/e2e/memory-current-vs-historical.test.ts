/**
 * E2E: Memory freshness.
 *
 * A previously observed value must not be treated as current truth when the
 * user asks whether the live page changed.
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
import { extractDoneSummary } from "./helpers/diagnostics";
import {
  collectNewWorkspaceTraceFiles,
  missingExpectedFacts,
  snapshotTraceBaseline,
} from "./helpers/memory";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  settleWorkspaceBetweenTurns,
  waitForTaskCompletion,
} from "./helpers/utils";

const h = createE2EHarness({ maxTurns: 12, testLabel: "memory-freshness" });
const TURN_TIMEOUT = 160_000;

describe.skipIf(!h.apiKey)("E2E: Memory current value beats historical value", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("memory-current-vs-historical"));
  afterAll(() => h.afterAllHook());

  it("re-checks a changed live value instead of reusing stale memory", async () => {
    const workspaceId = `e2e-memory-freshness-${crypto.randomUUID()}`;

    await navigateAndWait(h.page, getFixtureUrl("memory-lab"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    await sendUserChat(
      h.ctx,
      "Read the Live Operating Status on this page and tell me the dashboard version and SLA breach count.",
      tabId,
      workspaceId,
    );

    const turn1 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
    expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);

    const turn1Traces = collectNewWorkspaceTraceFiles(h.tracesBefore, workspaceId);
    const turn1Answer = extractDoneSummary(turn1Traces);
    const turn1Missing = missingExpectedFacts(turn1Answer, [
      { label: "initial version", patterns: [/Beacon-17/i] },
      { label: "initial SLA breaches", patterns: [/\bSLA\b[\s\S]{0,60}\b4\b/i, /\b4\b[\s\S]{0,60}\bSLA\b/i] },
    ]);
    expect(
      turn1Missing,
      `Turn 1 did not report the initial live status. Answer: ${turn1Answer}`,
    ).toEqual([]);

    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);
    await h.page.click("#memory-lab-refresh-status");
    await h.page.waitForFunction(
      () => (window as any).__memoryLab?.status?.version === "Beacon-18",
      { timeout: 5_000 },
    );

    const turn2Baseline = snapshotTraceBaseline();
    await sendUserChat(
      h.ctx,
      "The status may have changed. Check the live page now and tell me the current dashboard version and SLA breach count.",
      tabId,
      workspaceId,
    );

    const turn2 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
    expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);

    const turn2Traces = collectNewWorkspaceTraceFiles(turn2Baseline, workspaceId);
    const turn2Answer = extractDoneSummary(turn2Traces);
    const turn2Missing = missingExpectedFacts(turn2Answer, [
      { label: "updated version", patterns: [/Beacon-18/i] },
      { label: "updated SLA breaches", patterns: [/\bSLA\b[\s\S]{0,60}\b9\b/i, /\b9\b[\s\S]{0,60}\bSLA\b/i] },
    ]);
    expect(
      turn2Missing,
      `Turn 2 did not report the updated live status. Answer: ${turn2Answer}`,
    ).toEqual([]);

    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 420_000);
});
