/**
 * E2E: Delayed Content — network idle detection test.
 *
 * Tests that the agent waits for AJAX content to load before reading the page.
 * The fixture page has a "Load Data" button that triggers a simulated API call
 * with a 500ms delay. After the delay, a secret code appears. The agent must:
 * 1. Click "Load Data"
 * 2. Wait for the content to appear (network idle detection)
 * 3. Read and report the secret code
 *
 * This test validates that the DOM_READY_PROBE correctly waits for both
 * DOM mutations AND network requests to settle before capturing snapshots.
 *
 * Run: npm run test:e2e
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
import {
  findAllNewTraceFiles,
  readTrace,
} from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 15, testLabel: "delayed-content" });

/** Extract done() summary from trace turns. */
function extractDoneSummary(traceFiles: string[]): string | null {
  for (const f of traceFiles) {
    const turns = readTrace(f);
    for (const turn of turns) {
      const doneCall = turn.toolCalls.find((tc) => tc.name === "done");
      if (doneCall?.args?.summary) return String(doneCall.args.summary);
    }
  }
  return null;
}

describe.skipIf(!h.apiKey)("E2E: Delayed Content", () => {
  beforeAll(async () => { await h.beforeAllHook(); }, 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("delayed-content"));
  afterAll(() => h.afterAllHook());

  it("clicks Load Data and reads the secret code after AJAX completes", async () => {
    await navigateAndWait(h.page, getFixtureUrl("delayed-content"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "Click the 'Load Data' button, wait for the data to load,",
      "then read the secret code that appears and report it in done().",
      "The code appears after a short delay — do NOT report before it loads.",
    ].join(" ");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);
    const outcome = await waitForTaskCompletion(h.ctx, 120_000, workspaceId);

    const { traceFiles } = await h.printTraceSummary();

    if (!outcome.ok) {
      console.log(
        "[e2e] FAILURE:",
        JSON.stringify(
          { reason: outcome.reason, events: outcome.events.slice(-10) },
          null,
          2,
        ),
      );
    }
    expect(outcome.ok, outcome.reason).toBe(true);

    // The agent must have read the secret code
    const summary = extractDoneSummary(traceFiles);
    console.log("[e2e] Done summary:", summary?.slice(0, 200));
    expect(summary, "Agent must call done() with a summary").toBeTruthy();

    // The summary must contain the actual secret code
    const hasCode = summary?.includes("SECRET-CODE-7X9Q2") ||
                    summary?.includes("7X9Q2");
    expect(hasCode, "Agent must report the secret code SECRET-CODE-7X9Q2").toBe(true);

    console.log("[e2e] PASS — Secret code correctly read after AJAX delay");
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 180_000);
});
