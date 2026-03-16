/**
 * E2E: Summarize — read-only comprehension of a static page.
 *
 * Run: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getActiveTabId, navigateAndWait, sendUserChat, waitForTaskCompletion } from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { findNewTraceFile, readTrace, formatTraceSummary } from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 6, testLabel: "summarize" });

describe.skipIf(!h.apiKey)("E2E: Summarize", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("summarize"));
  afterAll(() => h.afterAllHook());

  it(
    "summarizes a static text page in at most two turns using read-only tools",
    async () => {
      await navigateAndWait(h.page, getFixtureUrl("summarize-page.html"));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "Summarize this page in 2-3 sentences.",
        "Mention the product purpose, one capability, and one concrete fact.",
      ].join(" ");

      const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

      const outcome = await waitForTaskCompletion(h.ctx, 90_000, workspaceId);
      expect(outcome.ok, JSON.stringify(outcome.events.slice(-10), null, 2)).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const traceFile = findNewTraceFile(h.tracesBefore);
      expect(traceFile).toBeTruthy();

      const turns = readTrace(traceFile!);
      console.log(formatTraceSummary(turns));
      console.log(`[e2e:summarize] Trace: ${traceFile}`);

      expect(turns.length).toBeLessThanOrEqual(2);

      const toolCalls = turns.flatMap((turn) => turn.toolCalls.map((tool) => tool.name));
      expect(toolCalls.at(-1)).toBe("done");
      expect(toolCalls.every((name) => ["done", "read_page"].includes(name))).toBe(true);

      const forbiddenActionTools = toolCalls.filter((name) =>
        ["click_element", "type_text", "navigate", "scroll_page"].includes(name),
      );
      expect(forbiddenActionTools).toEqual([]);
    },
    120_000,
  );
});
