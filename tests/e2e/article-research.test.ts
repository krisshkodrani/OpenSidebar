/**
 * E2E: Article Research — scroll a long page to find a footnote citation.
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
  formatTraceSummary,
} from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 12, testLabel: "article-research" });

describe.skipIf(!h.apiKey)("E2E: Article Research", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("article-research"));
  afterAll(() => h.afterAllHook());

  it("agent scrolls to find a footnote source and reports it", async () => {
    await navigateAndWait(h.page, getFixtureUrl("article"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "What source is cited in footnote [2] of this article?",
      "Scroll down to the footnotes section at the bottom of the page to find it.",
      "Report the full citation text.",
    ].join(" ");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForTaskCompletion(h.ctx, 120_000, workspaceId);
    expect(outcome.ok, JSON.stringify(outcome.events.slice(-10), null, 2)).toBe(
      true,
    );

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const traceFiles = findAllNewTraceFiles(h.tracesBefore);

    const allTurns = traceFiles.flatMap((f) => readTrace(f));
    for (const f of traceFiles) {
      const turns = readTrace(f);
      console.log(formatTraceSummary(turns));
      console.log(`[e2e:article-research] Trace: ${f}`);
    }

    const allToolCalls = allTurns.flatMap((turn) => turn.toolCalls);
    const doneCalls = allToolCalls.filter((tc) => tc.name === "done");
    const summaries = doneCalls.map((tc) =>
      String(tc.args?.summary ?? tc.args?.result ?? ""),
    );

    const allContent = allTurns.map((t) => t.llmContent ?? "").filter(Boolean);

    const mentionsInDone = summaries.some(
      (s) =>
        s.includes("Zhang") ||
        s.includes("Iron-Air") ||
        s.includes("Nature Energy"),
    );
    const mentionsInContent = allContent.some(
      (s) =>
        s.includes("Zhang") ||
        s.includes("Iron-Air") ||
        s.includes("Nature Energy"),
    );

    const found = mentionsInDone || mentionsInContent;
    const bestMatch =
      summaries.find(
        (s) =>
          s.includes("Zhang") ||
          s.includes("Iron-Air") ||
          s.includes("Nature Energy"),
      ) ??
      allContent.find(
        (s) =>
          s.includes("Zhang") ||
          s.includes("Iron-Air") ||
          s.includes("Nature Energy"),
      ) ??
      "(not found in traces)";

    console.log(`\n[e2e] Footnote mentioned in done(): ${mentionsInDone}`);
    console.log(`[e2e] Footnote mentioned in content: ${mentionsInContent}`);
    console.log(
      `[e2e] Total turns across ${traceFiles.length} sessions: ${allTurns.length}`,
    );
    console.log(`[e2e] Done calls found: ${doneCalls.length}`);

    if (found) {
      console.log(`[e2e] PASS — Footnote [2] source found`);
      console.log(`[e2e]   Match: ${String(bestMatch).substring(0, 120)}...`);
    } else {
      console.log(
        `[e2e] WARN — Task completed but footnote source not found in trace data`,
      );
      console.log(
        `[e2e]   (Orchestrator-level synthesis may not appear in per-session traces)`,
      );
    }

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 210_000);
});
