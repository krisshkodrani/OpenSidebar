/**
 * E2E: Continuation — Paginated Memory (cross-page data retention).
 *
 * Tests that the agent retains data from a previous page when asked
 * to compare across paginated views. Turn 3 requires answering from
 * conversation history — the page 1 data is no longer in the DOM.
 *
 * Turn 1: What's the highest salary on page 1?
 * Turn 2: Navigate to the last page and check there too
 * Turn 3: Which page had the higher max salary, and by how much?
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/continuation-paginated-memory.test.ts
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
  settleWorkspaceBetweenTurns,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { extractDoneSummary, findAllNewTraceFiles } from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 12, testLabel: "paginated-memory" });

const TURN_TIMEOUT = 150_000;

describe.skipIf(!h.apiKey)("E2E: Continuation — Paginated Memory", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("paginated-memory"));
  afterAll(() => h.afterAllHook());

  it("compares data across paginated table pages from memory", async () => {
    await navigateAndWait(h.page, getFixtureUrl("data-table"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const workspaceId = `e2e-pag-mem-${crypto.randomUUID()}`;

    // =================================================================
    // TURN 1: Read page 1 salaries
    // =================================================================
    console.log("\n[pag-mem] === TURN 1: Highest salary on page 1 ===");

    await sendUserChat(
      h.ctx,
      "Look at the employee table. What is the highest salary on the first page?",
      tabId,
      workspaceId,
    );

    const turn1 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);

    if (!turn1.ok) {
      console.log("[pag-mem] TURN 1 FAIL:", { reason: turn1.reason });
    }
    expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);

    // Extract the agent's answer from traces (done() message)
    const turn1Traces = findAllNewTraceFiles(h.tracesBefore);
    const turn1Answer = extractDoneSummary(turn1Traces);
    console.log(`[pag-mem] Turn 1 answer: ${turn1Answer.slice(0, 150)}`);

    // The agent should have mentioned a salary figure
    expect(
      /\$?\d[\d,]+/.test(turn1Answer),
      "Turn 1 should report a salary number",
    ).toBe(true);

    // =================================================================
    // TRANSITION
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);
    const tracesAfterTurn1 = new Set([...h.tracesBefore, ...turn1Traces]);

    // =================================================================
    // TURN 2: Navigate to last page
    // =================================================================
    console.log("\n[pag-mem] === TURN 2: Check last page ===");

    await sendUserChat(
      h.ctx,
      "Now navigate to the last page of the table and tell me the highest salary there.",
      tabId,
      workspaceId,
    );

    const turn2 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);

    if (!turn2.ok) {
      const tableState = await h.page.evaluate(
        () => (window as any).tableResult ?? null,
      );
      console.log("[pag-mem] TURN 2 FAIL:", {
        reason: turn2.reason,
        currentPage: tableState?.currentPage,
      });
    }
    expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);

    // Verify the agent actually navigated away from page 1
    const tableState = await h.page.evaluate(
      () => (window as any).tableResult ?? null,
    );
    expect(
      tableState?.currentPage,
      "Agent should have navigated past page 1",
    ).toBeGreaterThan(1);

    const turn2Traces = findAllNewTraceFiles(tracesAfterTurn1);
    const turn2Answer = extractDoneSummary(turn2Traces);
    console.log(`[pag-mem] Turn 2 answer: ${turn2Answer.slice(0, 150)}`);

    expect(
      /\$?\d[\d,]+/.test(turn2Answer),
      "Turn 2 should report a salary number",
    ).toBe(true);

    // =================================================================
    // TRANSITION
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);
    const tracesAfterTurn2 = new Set([...tracesAfterTurn1, ...turn2Traces]);

    // =================================================================
    // TURN 3: Compare from memory
    // =================================================================
    console.log("\n[pag-mem] === TURN 3: Compare pages from memory ===");

    await sendUserChat(
      h.ctx,
      "Which page had the higher maximum salary, and by how much?",
      tabId,
      workspaceId,
    );

    const turn3 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);

    if (!turn3.ok) {
      console.log("[pag-mem] TURN 3 FAIL:", { reason: turn3.reason });
    }
    expect(turn3.ok, `Turn 3 failed: ${turn3.reason}`).toBe(true);

    const turn3Traces = findAllNewTraceFiles(tracesAfterTurn2);
    const turn3Answer = extractDoneSummary(turn3Traces);
    console.log(`[pag-mem] Turn 3 answer: ${turn3Answer.slice(0, 200)}`);

    // The comparison answer should reference both pages and a difference
    const t3Lower = turn3Answer.toLowerCase();
    expect(
      t3Lower.includes("page") || t3Lower.includes("first") || t3Lower.includes("last"),
      "Turn 3 should reference which page",
    ).toBe(true);
    expect(
      /\$?\d[\d,]+/.test(turn3Answer),
      "Turn 3 should include salary figures",
    ).toBe(true);

    // =================================================================
    // Final checks
    // =================================================================
    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

    console.log("\n[pag-mem] === ALL 3 TURNS PASSED ===");
    console.log("[pag-mem] Turn 1 (page 1):", turn1Answer.slice(0, 80));
    console.log("[pag-mem] Turn 2 (last page):", turn2Answer.slice(0, 80));
    console.log("[pag-mem] Turn 3 (comparison):", turn3Answer.slice(0, 80));
  }, 540_000);
});
