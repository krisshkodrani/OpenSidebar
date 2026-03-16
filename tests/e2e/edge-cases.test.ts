/**
 * E2E: Edge cases and error handling.
 *
 * Tests: form validation recovery, delayed content, impossible task graceful stop.
 *
 * Run: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getActiveTabId, navigateAndWait, sendUserChat, waitForOutcome } from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 20, testLabel: "edge-cases" });

describe.skipIf(!h.apiKey)("E2E: Edge Cases", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("edge-cases"));
  afterAll(() => h.afterAllHook());

  it(
    "agent recovers from form validation errors",
    async () => {
      await navigateAndWait(h.page, getFixtureUrl("error-scenarios.html"));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "You are on an Error Scenarios page. Complete this task:",
        "",
        "Fill in the Contact Form section:",
        "- Email: test@example.com",
        "- Message: Hello, this is a test message for the contact form.",
        "Then click 'Send Message'.",
        "Verify the page shows 'Message sent successfully!'.",
      ].join("\n");

      const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        h.page,
        h.ctx.serviceWorker,
        async () => {
          return h.page.evaluate(
            () => (window as any).contactResult ?? null,
          );
        },
        180_000,
        workspaceId,
      );

      await h.printTraceSummary();

      if (!outcome.ok) {
        console.log("[e2e] FAILURE:", outcome.reason, outcome.events.slice(-5));
      }
      expect(outcome.ok, outcome.reason).toBe(true);

      const result = outcome.result as any;
      expect(result.sent).toBe(true);
      expect(result.email).toBe("test@example.com");
      expect(result.message.length).toBeGreaterThanOrEqual(10);

      console.log(`[e2e] PASS — Contact form submitted: ${result.email}`);
    },
    240_000,
  );

  it(
    "agent handles delayed content that appears after button click",
    async () => {
      await navigateAndWait(h.page, getFixtureUrl("error-scenarios.html"));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "You are on an Error Scenarios page. Complete this task:",
        "",
        "1. Find the 'Delayed Content' section.",
        "2. In that section, click the 'Load Content' button. Do NOT just inspect or summarize the section before clicking the button.",
        "3. Wait for the delayed text to appear after the click.",
        "4. Do NOT call done until the loaded text is visible and begins with 'Loaded:'.",
        "5. Read the loaded text and report exactly what it says.",
      ].join("\n");

      const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        h.page,
        h.ctx.serviceWorker,
        async () => {
          return h.page.evaluate(
            () => (window as any).delayedLoaded ? { loaded: true } : null,
          );
        },
        180_000,
        workspaceId,
      );

      await h.printTraceSummary();

      if (!outcome.ok) {
        console.log("[e2e] FAILURE:", outcome.reason, outcome.events.slice(-5));
      }
      expect(outcome.ok, outcome.reason).toBe(true);

      const text = await h.page.evaluate(() => {
        const el = document.getElementById("delayed-text");
        return el?.textContent?.trim() ?? null;
      });
      expect(text).toContain("The answer is 42");

      console.log(`[e2e] PASS — Delayed content loaded: "${text}"`);
    },
    240_000,
  );

  it(
    "agent stops gracefully when task is impossible",
    async () => {
      await navigateAndWait(h.page, getFixtureUrl("error-scenarios.html"));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "You are on an Error Scenarios page. Complete this task:",
        "",
        "Find and click the 'Generate Report' button, then click 'Submit Report'.",
        "",
        "If the 'Generate Report' button does not exist on the page, report that",
        "the task cannot be completed and explain why.",
      ].join("\n");

      const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        h.page,
        h.ctx.serviceWorker,
        async () => null,
        120_000,
        workspaceId,
      );

      await h.printTraceSummary();

      const reportStatus = await h.page.evaluate(() => {
        const el = document.getElementById("report-status");
        return el?.classList.contains("hidden") ?? true;
      });

      console.log(
        `[e2e] Impossible task outcome: ${outcome.reason} (report-status hidden: ${reportStatus})`,
      );
      expect(["timeout", "done", "agent_error"].some(
        (r) => outcome.reason.startsWith(r) || outcome.reason === r,
      )).toBe(true);
    },
    180_000,
  );
});
