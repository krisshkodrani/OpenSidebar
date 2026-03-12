/**
 * E2E: Navigation Challenge — click button 3 times, enter revealed code, submit.
 *
 * Tests the agent's ability to:
 *   1. Follow multi-step sequential instructions
 *   2. Read dynamically revealed content
 *   3. Enter data and submit
 *   4. Verify completion state
 *
 * Run: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

describe.skipIf(!API_KEY)("E2E: Navigation Challenge", () => {
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
    page = pages[0] || (await ctx.browser.newPage());

    const helper = await openHelperPage(ctx);
    await helper.evaluate(async (key: string) => {
      await chrome.storage.local.set({ openRouterApiKey_local: key });
      await chrome.storage.sync.set({
        userSettings: {
          requireApprovals: false,
          allowNavigation: false,
          requirePlanConfirmation: false,
          showElementTags: false,
          maxTurns: 30,
        },
      });
    }, API_KEY!);
    await helper.close();

    await setupEventMonitor(ctx.serviceWorker);
    tracesBefore = snapshotTraceFiles();
  }, 60_000);

  afterAll(async () => {
    if (detachConsole) detachConsole();
    if (ctx) await closeExtension(ctx);
    await stopFixtureServer();
    await stopLogServer();
  });

  it(
    "agent clicks Advance 3 times, reads code, enters it, and submits",
    async () => {
      await navigateAndWait(page, getFixtureUrl("navigation-challenge.html"));
      await page.bringToFront();
      const tabId = await getActiveTabId(ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "You are on a Navigation Challenge page. Complete these steps:",
        "",
        "1. Click the 'Advance' button 3 times. Each click increments the step counter.",
        "2. After the 3rd click, a secret code will be revealed on the page. Read it carefully.",
        "3. Type that exact code into the input field (placeholder 'Enter the secret code').",
        "4. Click the 'Submit Code' button.",
        "5. Verify the page shows 'Challenge Complete!' to confirm success.",
      ].join("\n");

      await sendUserChat(ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        page,
        ctx.serviceWorker,
        async () => {
          return page.evaluate(() => (window as any).challengeResult ?? null);
        },
        300_000,
      );

      // Print trace summary
      await new Promise((r) => setTimeout(r, 2_000));
      const traceFile = findNewTraceFile(tracesBefore);
      if (traceFile) {
        const turns = readTrace(traceFile);
        console.log(formatTraceSummary(turns));
        console.log(`[e2e] Trace file: ${traceFile}`);
      } else {
        console.log("[e2e] No trace file found");
      }

      if (!outcome.ok) {
        console.log(
          "[e2e] FAILURE DIAGNOSTICS:",
          JSON.stringify(
            { reason: outcome.reason, result: outcome.result, events: outcome.events },
            null,
            2,
          ),
        );
      }
      expect(outcome.ok, outcome.reason).toBe(true);

      // Verify business outcome
      const result = outcome.result as any;
      expect(result.completed).toBe(true);
      expect(result.code).toBe("ALPHA-7492");

      // Verify DOM state
      const banner = await page.evaluate(() => {
        const el = document.getElementById("success-banner");
        return el ? el.textContent?.trim() : null;
      });
      expect(banner).toContain("Challenge Complete");

      console.log(`\n[e2e] PASS — Navigation Challenge completed`);
      console.log(`[e2e]   Code: ${result.code}`);
    },
    360_000,
  );
});
