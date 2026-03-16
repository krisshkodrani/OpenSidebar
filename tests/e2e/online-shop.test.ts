/**
 * E2E: Online Shopping — add item, apply coupon, complete checkout.
 *
 * Run: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getActiveTabId, navigateAndWait, sendUserChat, waitForOutcome } from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 30, testLabel: "online-shop" });

describe.skipIf(!h.apiKey)("E2E: Online Shopping", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("online-shop"));
  afterAll(() => h.afterAllHook());

  it(
    "agent adds item to cart, applies coupon, and completes checkout",
    async () => {
      await navigateAndWait(h.page, getFixtureUrl("online-shop-pro.html"));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
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

      const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

      const outcome = await waitForOutcome(
        h.page,
        h.ctx.serviceWorker,
        async () => {
          const order = await h.page.evaluate(
            () => (window as any).lastOrder ?? null,
          );
          return order || null;
        },
        300_000,
        workspaceId,
      );

      await h.printTraceSummary();

      if (!outcome.ok) {
        const ui = await h.page.evaluate(() => ({
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
