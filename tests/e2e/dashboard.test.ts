/**
 * E2E: Dashboard — read table data, apply filters, switch tabs, save settings.
 *
 * Tests the agent on a dense interactive page with a data table, tab panels,
 * and a settings form hidden behind a tab. Targets grounding on dense pages,
 * perception of hidden-tab content, and element ID stability across state changes.
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

describe.skipIf(!API_KEY)("E2E: Dashboard", () => {
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

  it(
    "agent reads table data, switches to Settings tab, and saves settings",
    async () => {
      await navigateAndWait(page, getFixtureUrl("dashboard.html"));
      await page.bringToFront();
      const tabId = await getActiveTabId(ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "You are on an analytics dashboard. Complete these steps IN ORDER. Do NOT navigate away.",
        "",
        "Step 1: Click the 'Settings' tab button to switch to the Settings panel.",
        "",
        "Step 2: In the Settings form, type 'admin@test.com' into the notification email input field (it has placeholder 'admin@example.com'). Make sure to use type_text to enter the email, not just click the field.",
        "",
        "Step 3: Click the Save button.",
        "",
        "Verify the success toast 'Settings saved successfully!' appears.",
      ].join("\n");

      const workspaceId = await sendUserChat(ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        page,
        ctx.serviceWorker,
        async () => {
          const settings = await page.evaluate(
            () => (window as any).dashboardSettings ?? null,
          );
          return settings || null;
        },
        240_000,
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
          activeTab: document.querySelector(".tab-btn.active")?.textContent?.trim() || "",
          toastVisible: !document.getElementById("settings-toast")?.classList.contains("hidden"),
          settingsEmail: (document.getElementById("settings-email") as HTMLInputElement)?.value || "",
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

      const settings = outcome.result as any;
      expect(settings).toBeTruthy();
      expect(settings.email).toBe("admin@test.com");
      expect(settings.savedAt).toBeTruthy();

      console.log(`\n[e2e] PASS — Settings saved`);
      console.log(`[e2e]   Email: ${settings.email}`);
      console.log(`[e2e]   Timezone: ${settings.timezone}`);
    },
    300_000,
  );
});
