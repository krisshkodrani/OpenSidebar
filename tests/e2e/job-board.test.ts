/**
 * E2E: Job Board Research — long single-turn task.
 *
 * The agent receives a user profile and must click into each of 10 job
 * listings on a job board, read the full details, click back, and repeat.
 * After reviewing all jobs, it summarizes the best matches.
 *
 * Tests: deep navigation (click→read→back ×10), cross-turn memory,
 * and relevance judgment.
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/job-board.test.ts
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
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { extractDoneSummary, findAllNewTraceFiles, readTrace } from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 45, testLabel: "job-board" });

const TASK_TIMEOUT = 660_000; // 11 min for the agent to work through all jobs

/** Extract the done() message from trace files */
function extractDoneMessage(traceFiles: string[]): string {
  return extractDoneSummary(traceFiles);
}

/** Count occurrences of a specific tool name across traces */
function countToolCalls(traceFiles: string[], toolName: string): number {
  let count = 0;
  for (const f of traceFiles) {
    const turns = readTrace(f);
    for (const t of turns) {
      for (const tc of (t as any).toolCalls ?? []) {
        if (tc.name === toolName) count++;
      }
    }
  }
  return count;
}

describe.skipIf(!h.apiKey)("E2E: Job Board Research", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("job-board"));
  afterAll(() => h.afterAllHook());

  it("reviews all job listings and recommends best matches for profile", async () => {
    await navigateAndWait(h.page, getFixtureUrl("job-board"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const workspaceId = `e2e-job-board-${crypto.randomUUID()}`;

    // Single long prompt with user profile
    console.log("\n[job-board] === Sending research prompt ===");

    await sendUserChat(
      h.ctx,
      "I'm a senior frontend engineer with 5 years of experience specializing in " +
        "React and TypeScript. I also have strong experience with Node.js and GraphQL. " +
        "I'm looking for a fully remote position in the $120K–$160K salary range.\n\n" +
        "Please review ALL 10 job listings on this page — click into each one to read " +
        "the full details, then come back to the listings page. After reviewing every " +
        "job, tell me which ones are the best matches for my profile and why.",
      tabId,
      workspaceId,
    );

    const outcome = await waitForTaskCompletion(h.ctx, TASK_TIMEOUT, workspaceId);

    if (!outcome.ok) {
      console.log("[job-board] FAILURE:", outcome.reason);
    }
    expect(outcome.ok, `Task failed: ${outcome.reason}`).toBe(true);

    // =================================================================
    // Assertion 1: Verify jobs visited via window state
    // =================================================================
    const jobBoardState = await h.page.evaluate(
      () => (window as any).__jobBoardState ?? null,
    );
    const viewedJobs: string[] = jobBoardState?.viewedJobs ?? [];
    console.log(`[job-board] Jobs visited: ${viewedJobs.length}/10 — ${viewedJobs.join(", ")}`);

    expect(
      viewedJobs.length,
      `Agent should visit at least 8 of 10 jobs (visited ${viewedJobs.length})`,
    ).toBeGreaterThanOrEqual(8);

    // =================================================================
    // Assertion 2: Verify done() summary recommends relevant jobs
    // =================================================================
    const { traceFiles } = await h.printTraceSummary(workspaceId);
    const doneSummary = extractDoneMessage(traceFiles);
    console.log(`[job-board] Done summary (${doneSummary.length} chars): ${doneSummary.slice(0, 300)}`);

    expect(doneSummary.length, "Agent must call done() with a summary").toBeGreaterThan(0);

    const summaryLower = doneSummary.toLowerCase();

    // Check that at least 3 of the 4 clearly-relevant jobs are mentioned
    const relevantSignals = [
      { id: "sr-fe-1", signals: ["nextera", "senior frontend engineer"] },
      { id: "fe-lead-2", signals: ["cloudscale", "frontend tech lead"] },
      { id: "fullstack-3", signals: ["datapulse", "full stack"] },
      { id: "sr-ui-4", signals: ["designflow", "senior ui"] },
    ];

    const matchedJobs: string[] = [];
    for (const job of relevantSignals) {
      if (job.signals.some((s) => summaryLower.includes(s))) {
        matchedJobs.push(job.id);
      }
    }

    console.log(`[job-board] Relevant jobs in summary: ${matchedJobs.length}/4 — ${matchedJobs.join(", ")}`);
    expect(
      matchedJobs.length,
      `Should recommend at least 3 of 4 relevant jobs (found ${matchedJobs.length}: ${matchedJobs.join(", ")})`,
    ).toBeGreaterThanOrEqual(3);

    // =================================================================
    // Assertion 3: Verify agent clicked through listings
    // =================================================================
    const clickCount = countToolCalls(traceFiles, "click_element");
    console.log(`[job-board] Total click_element calls: ${clickCount}`);
    expect(clickCount, "Agent must click into job listings").toBeGreaterThanOrEqual(8);

    // =================================================================
    // Final checks
    // =================================================================
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

    console.log(`\n[job-board] === PASS ===`);
    console.log(`[job-board]   Visited: ${viewedJobs.length}/10 jobs`);
    console.log(`[job-board]   Relevant matches identified: ${matchedJobs.length}/4`);
    console.log(`[job-board]   Click actions: ${clickCount}`);
  }, 720_000);
});
