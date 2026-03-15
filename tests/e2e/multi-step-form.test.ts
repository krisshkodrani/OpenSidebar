/**
 * E2E: Multi-Step Form — complete a 3-step wizard with conditional fields.
 *
 * Tests plan tracking across wizard steps, conditional field detection,
 * client-side validation recovery, and done-rejection alignment.
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
  resetExtensionState,
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

describe.skipIf(!API_KEY)("E2E: Multi-Step Form", () => {
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
          maxTurns: 25,
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

  it(
    "agent completes a 3-step wizard with conditional fields",
    async () => {
      await navigateAndWait(page, getFixtureUrl("multi-step-form.html"));
      await page.bringToFront();
      const tabId = await getActiveTabId(ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "You are on a multi-step form wizard. Complete ALL steps IN ORDER. Do NOT navigate away.",
        "",
        "Step 1 (Personal Info): Type 'Jane Smith' in the name field, 'jane@example.com' in the email field, '555-0123' in the phone field. Then click Next.",
        "",
        "Step 2 (Preferences): Select 'Enterprise' from the category dropdown. A 'Company Name' field should appear — type 'Acme Corp' into it. Select the 'Premium ($2,000+)' budget radio option. Type 'Priority support needed' in the special requirements field. Then click Next.",
        "",
        "Step 3 (Review & Submit): Check the confirmation checkbox ('I confirm the above information is correct'), then click Submit.",
        "",
        "Wait for the confirmation panel with a reference number to appear.",
      ].join("\n");

      const workspaceId = await sendUserChat(ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        page,
        ctx.serviceWorker,
        async () => {
          const result = await page.evaluate(
            () => (window as any).formResult ?? null,
          );
          return result || null;
        },
        300_000,
        workspaceId,
      );

      // Always print trace summary
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
        const ui = await page.evaluate(() => ({
          step1Visible: (document.getElementById("step-1") as HTMLElement)?.style.display !== "none",
          step2Visible: (document.getElementById("step-2") as HTMLElement)?.style.display !== "none",
          step3Visible: (document.getElementById("step-3") as HTMLElement)?.style.display !== "none",
          confirmVisible: !document.getElementById("confirmation-panel")?.classList.contains("hidden"),
          errors: Array.from(document.querySelectorAll("[id^=error-]"))
            .filter((el) => el.textContent?.trim())
            .map((el) => `${el.id}: ${el.textContent?.trim()}`),
        }));
        console.log(
          "[e2e] FAILURE DIAGNOSTICS:",
          JSON.stringify(
            { reason: outcome.reason, ui, events: outcome.events.slice(-10) },
            null,
            2,
          ),
        );
      }
      expect(outcome.ok, outcome.reason).toBe(true);

      // Verify form result
      const result = outcome.result as any;
      expect(result).toBeTruthy();
      expect(result.name).toBe("Jane Smith");
      expect(result.email).toBe("jane@example.com");
      expect(result.category).toBe("Enterprise");
      expect(result.company).toBe("Acme Corp");
      expect(result.budget).toMatch(/premium/i);
      expect(result.refNumber).toMatch(/^REF-/);

      // Verify confirmation panel is visible
      const confirmVisible = await page.evaluate(() =>
        !document.getElementById("confirmation-panel")?.classList.contains("hidden"),
      );
      expect(confirmVisible).toBe(true);

      console.log(`\n[e2e] PASS — Form submitted: ${result.refNumber}`);
      console.log(`[e2e]   Name: ${result.name}, Email: ${result.email}`);
      console.log(`[e2e]   Category: ${result.category}, Company: ${result.company}`);
      console.log(`[e2e]   Budget: ${result.budget}`);
    },
    360_000,
  );
});
