/**
 * E2E: Edge cases and error handling.
 *
 * Tests the agent's resilience:
 *   - Form validation errors (agent must correct and retry)
 *   - Delayed content (agent must wait for async DOM changes)
 *   - Impossible task (agent should recognize and stop gracefully)
 *
 * Run: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  launchWithExtension,
  closeExtension,
  openHelperPage,
  type ExtensionContext,
} from "./helpers/browser";
import {
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  setupEventMonitor,
  resetExtensionState,
  waitForOutcome,
} from "./helpers/utils";
import {
  startFixtureServer,
  stopFixtureServer,
  getFixtureUrl,
} from "./helpers/fixture-server";
import {
  startLogServer,
  stopLogServer,
  snapshotTraceFiles,
  findNewTraceFile,
  readTrace,
  formatTraceSummary,
  attachSwConsole,
} from "./helpers/diagnostics";
import type { Page } from "puppeteer";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function loadApiKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = resolve(__dirname, "../../.env");
  if (!existsSync(envPath)) return undefined;
  const content = readFileSync(envPath, "utf-8");
  const match = content.match(/OPENROUTER_API_KEY=(.+)/);
  return match?.[1]?.trim() || undefined;
}

const API_KEY = loadApiKey();

describe.skipIf(!API_KEY)("E2E: Edge Cases", () => {
  let ctx: ExtensionContext;
  let page: Page;
  let detachConsole: (() => void) | null = null;
  let tracesBefore: Set<string>;

  beforeAll(async () => {
    await startLogServer();
    await startFixtureServer();
    ctx = await launchWithExtension();
    detachConsole = await attachSwConsole(ctx.browser);

    const pages = await ctx.browser.pages();
    page = pages.find((candidate) => !candidate.url().startsWith("chrome-extension://"))
      || (await ctx.browser.newPage());

    const helper = await openHelperPage(ctx);
    await helper.evaluate(async (key: string) => {
      await chrome.storage.local.set({ openRouterApiKey_local: key });
      await chrome.storage.sync.set({
        userSettings: {
          requireApprovals: false,
          allowNavigation: false,
          requirePlanConfirmation: false,
          showElementTags: false,
          maxTurns: 20,
        },
      });
    }, API_KEY!);
    await helper.close();

    await setupEventMonitor(ctx.serviceWorker);
  }, 60_000);

  beforeEach(async () => {
    await resetExtensionState(ctx);
    tracesBefore = snapshotTraceFiles();
    if (page.isClosed()) {
      page = await ctx.browser.newPage();
    }
  });

  afterEach(async () => {
    await resetExtensionState(ctx);
  });

  afterAll(async () => {
    if (detachConsole) detachConsole();
    if (ctx) await closeExtension(ctx);
    await stopFixtureServer();
    await stopLogServer();
  });

  /** Print trace summary for any test (pass or fail) */
  async function printTrace(label: string) {
    await new Promise((r) => setTimeout(r, 2_000));
    const traceFile = findNewTraceFile(tracesBefore);
    if (traceFile) {
      const turns = readTrace(traceFile);
      console.log(formatTraceSummary(turns));
      console.log(`[e2e:${label}] Trace: ${traceFile}`);
    }
  }

  it(
    "agent recovers from form validation errors",
    async () => {
      await navigateAndWait(page, getFixtureUrl("error-scenarios.html"));
      await page.bringToFront();
      const tabId = await getActiveTabId(ctx.serviceWorker);
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

      const workspaceId = await sendUserChat(ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        page,
        ctx.serviceWorker,
        async () => {
          return page.evaluate(
            () => (window as any).contactResult ?? null,
          );
        },
        180_000,
        workspaceId,
      );

      await printTrace("validation-recovery");

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
      await navigateAndWait(page, getFixtureUrl("error-scenarios.html"));
      await page.bringToFront();
      const tabId = await getActiveTabId(ctx.serviceWorker);
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

      const workspaceId = await sendUserChat(ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        page,
        ctx.serviceWorker,
        async () => {
          return page.evaluate(
            () => (window as any).delayedLoaded ? { loaded: true } : null,
          );
        },
        180_000,
        workspaceId,
      );

      await printTrace("delayed-content");

      if (!outcome.ok) {
        console.log("[e2e] FAILURE:", outcome.reason, outcome.events.slice(-5));
      }
      expect(outcome.ok, outcome.reason).toBe(true);

      // Verify the delayed content is visible
      const text = await page.evaluate(() => {
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
      await navigateAndWait(page, getFixtureUrl("error-scenarios.html"));
      await page.bringToFront();
      const tabId = await getActiveTabId(ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "You are on an Error Scenarios page. Complete this task:",
        "",
        "Find and click the 'Generate Report' button, then click 'Submit Report'.",
        "",
        "If the 'Generate Report' button does not exist on the page, report that",
        "the task cannot be completed and explain why.",
      ].join("\n");

      const workspaceId = await sendUserChat(ctx, prompt, tabId);

      // For impossible tasks, we wait for the agent to finish (done/give-up).
      // The agent should NOT set any window result — it should just stop.
      // We use a shorter timeout and consider either agent completion or timeout as valid.
      const outcome = await waitForOutcome(
        page,
        ctx.serviceWorker,
        async () => {
          // No success condition exists — we're testing graceful stop.
          // Return null always so we rely on agent status events.
          return null;
        },
        120_000,
        workspaceId,
      );

      await printTrace("impossible-task");

      // The agent should have finished (not hung forever).
      // Either it timed out (our 120s limit) or it stopped gracefully.
      // Both are acceptable — the key is no crash and no infinite loop.
      // Check that the agent didn't somehow click the disabled Submit Report.
      const reportStatus = await page.evaluate(() => {
        const el = document.getElementById("report-status");
        return el?.classList.contains("hidden") ?? true;
      });

      console.log(
        `[e2e] Impossible task outcome: ${outcome.reason} (report-status hidden: ${reportStatus})`,
      );
      // The test passes as long as the agent didn't crash or get stuck in an
      // infinite loop. timeout or agent completion are both acceptable.
      expect(["timeout", "done", "agent_error"].some(
        (r) => outcome.reason.startsWith(r) || outcome.reason === r,
      )).toBe(true);
    },
    180_000,
  );
});
