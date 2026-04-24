/**
 * E2E: Continuation — Cross-Page Compose (read dashboard → draft email).
 *
 * Tests that the agent retains data read from one page and uses it
 * to fill a textarea on a different page.
 *
 * Turn 1: Read dashboard Overview metrics (users, revenue, top source)
 * Turn 2: Navigate to email-compose, draft a reply citing those metrics
 * Turn 3: Refine the draft — add a note about bounce rate
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/continuation-cross-page-compose.test.ts
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
  waitForOutcome,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { extractDoneSummary, findAllNewTraceFiles } from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 12, testLabel: "cross-page-compose" });

const TURN_TIMEOUT = 150_000;
const CONTEXT_KEYWORDS = [
  "dashboard",
  "metrics",
  "users",
  "revenue",
  "bounce",
  "q3",
  "strategy",
  "meeting",
];

/** Extract the done() message from trace files */
function extractDoneMessage(traceFiles: string[]): string {
  return extractDoneSummary(traceFiles);
}

function sharedContextKeywordCount(previous: string, next: string): number {
  const prev = previous.toLowerCase();
  const curr = next.toLowerCase();
  return CONTEXT_KEYWORDS.filter(
    (keyword) => prev.includes(keyword) && curr.includes(keyword),
  ).length;
}

describe.skipIf(!h.apiKey)("E2E: Continuation — Cross-Page Compose", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("cross-page-compose"));
  afterAll(() => h.afterAllHook());

  it("reads dashboard metrics and uses them to draft an email on another page", async () => {
    const workspaceId = `e2e-cross-page-compose-${crypto.randomUUID()}`;

    // =================================================================
    // TURN 1: Read dashboard Overview metrics
    // =================================================================
    console.log("\n[cross-page-compose] === TURN 1: Read dashboard metrics ===");

    await navigateAndWait(h.page, getFixtureUrl("dashboard"));
    await h.page.bringToFront();
    const tabId1 = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId1).toBeGreaterThan(0);

    await sendUserChat(
      h.ctx,
      "Read the Overview tab on this dashboard. Tell me the Total Users count, " +
        "the Revenue figure, and the Bounce Rate percentage.",
      tabId1,
      workspaceId,
    );

    const turn1 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
    expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);

    const turn1Traces = findAllNewTraceFiles(h.tracesBefore);
    const turn1Answer = extractDoneMessage(turn1Traces);
    console.log(`[cross-page-compose] Turn 1: ${turn1Answer.slice(0, 200)}`);

    // Should mention specific numbers from the dashboard
    expect(
      /\d/.test(turn1Answer),
      "Turn 1 should include numeric data from the dashboard",
    ).toBe(true);

    // =================================================================
    // TRANSITION: Navigate to email-compose page
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

    console.log("\n[cross-page-compose] === Navigating to email-compose ===");
    await navigateAndWait(h.page, getFixtureUrl("email-compose"));
    await h.page.bringToFront();
    const tabId2 = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId2).toBeGreaterThan(0);

    // =================================================================
    // TURN 2: Draft email using remembered dashboard data
    // =================================================================
    console.log("\n[cross-page-compose] === TURN 2: Draft email with dashboard data ===");

    await sendUserChat(
      h.ctx,
      "Draft a reply to David's email in the reply box. In the reply, mention " +
        "the dashboard numbers you just told me — total users, revenue, and bounce rate. " +
        "Say we should discuss these metrics at the Q3 strategy meeting. Don't click send.",
      tabId2,
      workspaceId,
    );

    const turn2 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const r = await h.page.evaluate(() => (window as any).emailResult ?? null);
        if (!r?.composed || r.sent) return null;
        const msg = (r.message as string).toLowerCase();
        if (r.messageLength < 30) return null;
        // Must reference at least two of the three dashboard metrics
        const hasUsers = msg.includes("12,847") || msg.includes("12847");
        const hasRevenue = msg.includes("48,392") || msg.includes("48392");
        const hasBounce = msg.includes("42.3") || msg.includes("42");
        const matchCount = [hasUsers, hasRevenue, hasBounce].filter(Boolean).length;
        if (matchCount < 2) return null;
        return r;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn2.ok) {
      const draft = await h.page.evaluate(() => {
        const el = document.getElementById("reply-editor") as HTMLTextAreaElement | null;
        return el?.value?.slice(0, 400) || "";
      });
      console.log("[cross-page-compose] TURN 2 FAIL:", { reason: turn2.reason, draft });
    }
    expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);
    expect(turn2.result!.sent, "Should not send").toBe(false);

    const turn2Text = turn2.result!.message as string;
    console.log(`[cross-page-compose] Turn 2 draft (${turn2Text.length} chars): ${turn2Text.slice(0, 150)}...`);

    // =================================================================
    // TRANSITION
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

    // =================================================================
    // TURN 3: Refine — add bounce rate concern
    // =================================================================
    console.log("\n[cross-page-compose] === TURN 3: Add bounce rate concern ===");

    await sendUserChat(
      h.ctx,
      "Add a line to the reply saying the bounce rate is concerning and we should " +
        "investigate which pages have the highest exit rates. Keep the rest of the email intact.",
      tabId2,
      workspaceId,
    );

    const turn3 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const r = await h.page.evaluate(() => (window as any).emailResult ?? null);
        if (!r?.composed || r.sent) return null;
        const msg = (r.message as string).toLowerCase();
        if (r.messageLength < 40) return null;
        // Must mention bounce rate concern and investigation
        const hasBounce =
          msg.includes("bounce") ||
          msg.includes("exit rate");
        const hasInvestigate =
          msg.includes("investigat") ||
          msg.includes("look into") ||
          msg.includes("analyz") ||
          msg.includes("examin");
        if (!hasBounce || !hasInvestigate) return null;
        // The refinement should preserve some prior dashboard/email context,
        // even if the agent rewrites the draft instead of appending verbatim.
        if (sharedContextKeywordCount(turn2Text, r.message as string) < 2) {
          return null;
        }
        return r;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn3.ok) {
      const draft = await h.page.evaluate(() => {
        const el = document.getElementById("reply-editor") as HTMLTextAreaElement | null;
        return el?.value?.slice(0, 400) || "";
      });
      console.log("[cross-page-compose] TURN 3 FAIL:", { reason: turn3.reason, draft });
    }
    expect(turn3.ok, `Turn 3 failed: ${turn3.reason}`).toBe(true);
    expect(turn3.result!.sent, "Should not send").toBe(false);

    const turn3Text = turn3.result!.message as string;
    console.log(`[cross-page-compose] Turn 3 draft (${turn3Text.length} chars): ${turn3Text.slice(0, 150)}...`);

    // Content should have changed from turn 2
    expect(turn3Text).not.toBe(turn2Text);

    // =================================================================
    // Final checks
    // =================================================================
    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

    console.log("\n[cross-page-compose] === ALL 3 TURNS PASSED ===");
    console.log("[cross-page-compose] Turn 1: Dashboard read");
    console.log("[cross-page-compose] Turn 2: Email draft →", turn2Text.slice(0, 80));
    console.log("[cross-page-compose] Turn 3: Refined →", turn3Text.slice(0, 80));
  }, 540_000);
});
