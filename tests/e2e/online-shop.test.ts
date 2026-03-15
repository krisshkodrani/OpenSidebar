/**
 * E2E: Online Shopping — add item, apply coupon, complete checkout.
 *
 * Real agent operating in a real browser. No sidebar, no mocks.
 * Launches Chrome with the extension, sends a task, and watches the agent
 * click, type, and navigate the page. Trace persists to traces/.
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

describe.skipIf(!API_KEY)("E2E: Online Shopping", () => {
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
          maxTurns: 30,
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
    "agent adds item to cart, applies coupon, and completes checkout",
    async () => {
      await navigateAndWait(page, getFixtureUrl("online-shop-pro.html"));
      await page.bringToFront();
      const tabId = await getActiveTabId(ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      const prompt = [
        "You are on a shopping page. Complete these steps IN ORDER. Do NOT navigate away or open new tabs.",
        "",
        "Step 1: In the Air Zoom Pegasus 41 product card, click its 'Add to cart' button. Do NOT click the header 'Open Cart' button. The cart drawer should appear automatically after the correct Add to cart click.",
        "",
        "Step 2: In the cart drawer, FIRST type SAVE10 into the promo code input field (it has placeholder 'SAVE10'), then click the Apply button. After that, select the Express ($15) shipping radio option in the cart drawer.",
        "",
        "Step 3: Keep the cart drawer open. In the cart drawer checkout section, type Alex Morgan into the input with placeholder 'Full name'. Type alex.morgan@example.com into the input with placeholder 'Email address'. Then click the Place Order button in the cart drawer.",
      ].join("\n");

      const workspaceId = await sendUserChat(ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        page,
        ctx.serviceWorker,
        async () => {
          const order = await page.evaluate(
            () => (window as any).lastOrder ?? null,
          );
          return order || null;
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
          orderError:
            (document.getElementById("order-error") as HTMLElement | null)
              ?.textContent?.trim() || "",
          cartVisible: !document
            .getElementById("cart-drawer")
            ?.classList.contains("hidden"),
        }));
        console.log(
          "[e2e] FAILURE DIAGNOSTICS:",
          JSON.stringify(
            { reason: outcome.reason, ui, events: outcome.events },
            null,
            2,
          ),
        );
      }
      expect(outcome.ok, outcome.reason).toBe(true);

      // Verify business outcome
      const order = outcome.result as any;
      expect(order).toBeTruthy();
      expect(order.shippingMethod).toBe("express");
      expect(order.coupon).toBe("SAVE10");
      expect(order.email).toBe("alex.morgan@example.com");

      const pegasus = order.items.find(
        (item: any) => item.id === "pegasus-41",
      );
      expect(pegasus).toBeDefined();
      expect(order.total).toBeGreaterThan(0);

      console.log(`\n[e2e] PASS — Order ${order.orderId}`);
      console.log(
        `[e2e]   Items: ${order.items.length}, Pegasus: ${pegasus.name}`,
      );
      console.log(
        `[e2e]   Coupon: ${order.coupon}, Shipping: ${order.shippingMethod}`,
      );
      console.log(`[e2e]   Total: $${order.total}`);
    },
    360_000,
  );
});
