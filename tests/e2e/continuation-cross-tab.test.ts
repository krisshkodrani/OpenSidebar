/**
 * E2E: Continuation — Cross-Tab Synthesis (dashboard tab comparison).
 *
 * Tests that the agent retains data from one dashboard tab when
 * asked to compare it with another tab's data.
 *
 * Turn 1: Read Sales/Overview tab numbers
 * Turn 2: Switch to Reports tab and describe the reports
 * Turn 3: Compare — which area looks strongest based on both tabs?
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/continuation-cross-tab.test.ts
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
  clearMonitoredEvents,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { findAllNewTraceFiles, readTrace } from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 10, testLabel: "cross-tab" });

const TURN_TIMEOUT = 150_000;

/** Extract the done() message from trace files */
function extractDoneMessage(traceFiles: string[]): string {
  for (const f of traceFiles) {
    const turns = readTrace(f);
    for (const t of turns) {
      for (const tc of (t as any).toolCalls ?? []) {
        if (tc.name === "done" && tc.args?.message) {
          return tc.args.message;
        }
      }
    }
  }
  return "";
}

describe.skipIf(!h.apiKey)("E2E: Continuation — Cross-Tab Synthesis", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("cross-tab"));
  afterAll(() => h.afterAllHook());

  it("reads two dashboard tabs and synthesizes a comparison", async () => {
    await navigateAndWait(h.page, getFixtureUrl("dashboard"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const workspaceId = `e2e-cross-tab-${crypto.randomUUID()}`;

    // =================================================================
    // TURN 1: Read Overview tab
    // =================================================================
    console.log("\n[cross-tab] === TURN 1: Read Overview tab ===");

    await sendUserChat(
      h.ctx,
      "Look at the Overview tab on this dashboard. " +
        "Tell me the Total Users count, the Revenue figure, and the top traffic source.",
      tabId,
      workspaceId,
    );

    const turn1 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
    expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);

    const turn1Traces = findAllNewTraceFiles(h.tracesBefore);
    const turn1Answer = extractDoneMessage(turn1Traces);
    console.log(`[cross-tab] Turn 1: ${turn1Answer.slice(0, 150)}`);

    // Should mention numbers from the Overview
    expect(
      /\d/.test(turn1Answer),
      "Turn 1 should include numeric data",
    ).toBe(true);

    // =================================================================
    // TRANSITION
    // =================================================================
    await new Promise((r) => setTimeout(r, 4_000));
    await clearMonitoredEvents(h.ctx.serviceWorker);
    const tracesAfterTurn1 = new Set([...h.tracesBefore, ...turn1Traces]);

    // =================================================================
    // TURN 2: Switch to Reports tab
    // =================================================================
    console.log("\n[cross-tab] === TURN 2: Read Reports tab ===");

    await sendUserChat(
      h.ctx,
      "Now switch to the Reports tab and tell me what reports are available.",
      tabId,
      workspaceId,
    );

    const turn2 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
    expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);

    const turn2Traces = findAllNewTraceFiles(tracesAfterTurn1);
    const turn2Answer = extractDoneMessage(turn2Traces);
    console.log(`[cross-tab] Turn 2: ${turn2Answer.slice(0, 150)}`);

    // Should mention report names
    const t2Lower = turn2Answer.toLowerCase();
    expect(
      t2Lower.includes("performance") ||
        t2Lower.includes("engagement") ||
        t2Lower.includes("conversion") ||
        t2Lower.includes("traffic") ||
        t2Lower.includes("report"),
      "Turn 2 should describe the available reports",
    ).toBe(true);

    // =================================================================
    // TRANSITION
    // =================================================================
    await new Promise((r) => setTimeout(r, 4_000));
    await clearMonitoredEvents(h.ctx.serviceWorker);
    const tracesAfterTurn2 = new Set([...tracesAfterTurn1, ...turn2Traces]);

    // =================================================================
    // TURN 3: Synthesize from memory
    // =================================================================
    console.log("\n[cross-tab] === TURN 3: Compare both tabs ===");

    await sendUserChat(
      h.ctx,
      "Based on what you saw in both tabs, which area of the business looks strongest — " +
        "user growth, revenue, or traffic? Give a brief answer referencing the data.",
      tabId,
      workspaceId,
    );

    const turn3 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
    expect(turn3.ok, `Turn 3 failed: ${turn3.reason}`).toBe(true);

    const turn3Traces = findAllNewTraceFiles(tracesAfterTurn2);
    const turn3Answer = extractDoneMessage(turn3Traces);
    console.log(`[cross-tab] Turn 3: ${turn3Answer.slice(0, 200)}`);

    // The synthesis should reference data — not just generic advice
    expect(
      /\d/.test(turn3Answer) ||
        turn3Answer.toLowerCase().includes("revenue") ||
        turn3Answer.toLowerCase().includes("users") ||
        turn3Answer.toLowerCase().includes("traffic"),
      "Turn 3 should reference specific data from earlier turns",
    ).toBe(true);

    // =================================================================
    // Final checks
    // =================================================================
    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

    console.log("\n[cross-tab] === ALL 3 TURNS PASSED ===");
  }, 540_000);
});
