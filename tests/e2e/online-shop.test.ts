/**
 * E2E: Online Shopping — add item, apply coupon, complete checkout.
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
  assertNodeIsolation,
  assertNoGhostSession,
  getActiveTabId,
  getMonitoredEvents,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 30, testLabel: "online-shop" });

describe.skipIf(!h.apiKey)("E2E: Online Shopping", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("online-shop"));
  afterAll(() => h.afterAllHook());

  it("agent adds item to cart, applies coupon, and completes checkout", async () => {
    await navigateAndWait(h.page, getFixtureUrl("shop"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "You are on a shopping page. Complete these steps IN ORDER. Do NOT navigate away or open new tabs.",
      "",
      "Step 1: In the Air Zoom Pegasus 41 product card, click its 'Add to cart' button. Do NOT click the header 'Open Cart' button. The cart drawer should appear automatically after the correct Add to cart click.",
      "",
      "Step 2: In the cart drawer, FIRST type SAVE10 into the promo code input field in the Promo Code section, then click the Apply button. After that, select the Express ($15) shipping radio option in the cart drawer.",
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
          (
            document.getElementById("order-error") as HTMLElement | null
          )?.textContent?.trim() || "",
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

    const pegasus = order.items.find((item: any) => item.id === "pegasus-41");
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

    // Regression guard: exactly 1 order (no double execution from node bleed)
    const orderCount = await h.page.evaluate(
      () => (window as any).previousOrders?.length ?? 0,
    );
    expect(orderCount, "Node isolation: expected exactly 1 order").toBe(1);

    // Lane retry guard: only 1 trace = no timeout-triggered worker restarts.
    // Prevents the Amazon Pampers bug where done() lost the race against the
    // lane timeout, causing the orchestrator to restart and add items again.
    const { traceFiles } = await h.printTraceSummary(workspaceId);
    expect(
      traceFiles.length,
      "Lane retry guard: expected 1 trace (no worker restarts)",
    ).toBe(1);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 380_000);

  it("agent adds two items to cart, no coupon, standard shipping", async () => {
    await navigateAndWait(h.page, getFixtureUrl("shop"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "You are on a shopping page. Complete these steps IN ORDER. Do NOT navigate away or open new tabs.",
      "",
      "Step 1: Add the Novablast 4 shoes to cart using the 'Add to cart' button on its product card.",
      "",
      "Step 2: Add the CloudStrike 8 shoes to cart using the 'Add to cart' button on its product card.",
      "",
      "Step 3: In the cart drawer, keep the shipping as Standard (Free). Do NOT apply any coupon.",
      "",
      "Step 4: In the checkout section, type Jordan Smith into the Full name field. Type jordan.smith@test.com into the Email address field. Then click Place Order.",
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
      480_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        orderError:
          (
            document.getElementById("order-error") as HTMLElement | null
          )?.textContent?.trim() || "",
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
    expect(order.shippingMethod).toBe("standard");
    expect(order.coupon).toBeNull();
    expect(order.items.length).toBe(2);

    const novablast = order.items.find(
      (item: any) => item.id === "novablast-4",
    );
    const cloudstrike = order.items.find(
      (item: any) => item.id === "cloudstrike-8",
    );
    expect(novablast).toBeDefined();
    expect(cloudstrike).toBeDefined();
    expect(order.total).toBe(305); // $140 + $165 = $305

    console.log(`\n[e2e] PASS — Order ${order.orderId}`);
    console.log(
      `[e2e]   Items: ${order.items.length} (Novablast 4, CloudStrike 8)`,
    );
    console.log(
      `[e2e]   Coupon: ${order.coupon || "none"}, Shipping: ${order.shippingMethod}`,
    );
    console.log(`[e2e]   Total: $${order.total}`);

    // Regression guard: exactly 1 order (no double execution from node bleed)
    const orderCount = await h.page.evaluate(
      () => (window as any).previousOrders?.length ?? 0,
    );
    expect(orderCount, "Node isolation: expected exactly 1 order").toBe(1);

    // Structural node isolation check (multi-item = likely multi-node orchestration)
    const { traceFiles } = await h.printTraceSummary();
    const allEvents = await getMonitoredEvents(h.ctx.serviceWorker, 200);
    const wsEvents = allEvents.filter(
      (e: any) => e.workspaceId == null || e.workspaceId === workspaceId,
    );
    assertNodeIsolation(wsEvents, traceFiles);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 540_000);

  it("agent adds accessory, applies coupon, express shipping", async () => {
    await navigateAndWait(h.page, getFixtureUrl("shop"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "You are on a shopping page. Complete these steps IN ORDER. Do NOT navigate away or open new tabs.",
      "",
      "Step 1: Add the Endurance GPS Watch to cart using the 'Add to cart' button on its product card.",
      "",
      "Step 2: In the cart drawer, apply the promo code SAVE10.",
      "",
      "Step 3: Select Express shipping ($15).",
      "",
      "Step 4: In the checkout section, type Casey Lee into the Full name field. Type casey.lee@test.com into the Email address field. Then click Place Order.",
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
          (
            document.getElementById("order-error") as HTMLElement | null
          )?.textContent?.trim() || "",
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
    expect(order.email).toBe("casey.lee@test.com");

    const watch = order.items.find(
      (item: any) => item.id === "endurance-watch",
    );
    expect(watch).toBeDefined();
    expect(order.total).toBe(221.1); // $229 - 10% + $15 shipping = $221.10

    console.log(`\n[e2e] PASS — Order ${order.orderId}`);
    console.log(`[e2e]   Items: ${order.items.length}, Watch: ${watch.name}`);
    console.log(
      `[e2e]   Coupon: ${order.coupon}, Shipping: ${order.shippingMethod}`,
    );
    console.log(`[e2e]   Total: $${order.total}`);

    // Regression guard: exactly 1 order (no double execution from node bleed)
    const orderCount = await h.page.evaluate(
      () => (window as any).previousOrders?.length ?? 0,
    );
    expect(orderCount, "Node isolation: expected exactly 1 order").toBe(1);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 380_000);

  it("agent adds item, changes quantity to 3, applies coupon, standard shipping", async () => {
    await navigateAndWait(h.page, getFixtureUrl("shop"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "You are on a shopping page. Complete these steps IN ORDER. Do NOT navigate away or open new tabs.",
      "",
      "Step 1: Add the Trabuco Max 3 shoes to cart using the 'Add to cart' button.",
      "",
      "Step 2: In the cart drawer, change the quantity of the Trabuco Max 3 to 3 using the quantity controls (+ button).",
      "",
      "Step 3: Apply the promo code SAVE10.",
      "",
      "Step 4: Keep shipping as Standard (Free).",
      "",
      "Step 5: In checkout, type Sam Walker into Full name. Type sam@test.com into Email. Click Place Order.",
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
          (
            document.getElementById("order-error") as HTMLElement | null
          )?.textContent?.trim() || "",
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
    expect(order.shippingMethod).toBe("standard");
    expect(order.coupon).toBe("SAVE10");

    const trabuco = order.items.find((item: any) => item.id === "trabuco-max");
    expect(trabuco).toBeDefined();
    expect(trabuco.qty).toBe(3);
    expect(order.total).toBe(459); // $170 * 3 = $510 - 10% = $459

    console.log(`\n[e2e] PASS — Order ${order.orderId}`);
    console.log(
      `[e2e]   Items: ${order.items.length}, Qty: ${trabuco.qty}, Product: ${trabuco.name}`,
    );
    console.log(
      `[e2e]   Coupon: ${order.coupon}, Shipping: ${order.shippingMethod}`,
    );
    console.log(`[e2e]   Total: $${order.total}`);

    // Regression guard: exactly 1 order (no double execution from node bleed)
    const orderCount = await h.page.evaluate(
      () => (window as any).previousOrders?.length ?? 0,
    );
    expect(orderCount, "Node isolation: expected exactly 1 order").toBe(1);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 380_000);

  it("agent adds apparel item, no coupon, express shipping", async () => {
    await navigateAndWait(h.page, getFixtureUrl("shop"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "You are on a shopping page. Complete these steps IN ORDER. Do NOT navigate away or open new tabs.",
      "",
      "Step 1: Add the Tempo 2-in-1 Shorts to cart using the 'Add to cart' button on its product card.",
      "",
      "Step 2: In the cart drawer, select Express shipping ($15).",
      "",
      "Step 3: Do NOT apply any coupon code.",
      "",
      "Step 4: In checkout, type Riley Jones into Full name. Type riley@test.com into Email. Click Place Order.",
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
          (
            document.getElementById("order-error") as HTMLElement | null
          )?.textContent?.trim() || "",
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
    expect(order.coupon).toBeNull();

    const shorts = order.items.find((item: any) => item.id === "tempo-shorts");
    expect(shorts).toBeDefined();
    expect(order.total).toBe(73); // $58 + $15 shipping = $73

    console.log(`\n[e2e] PASS — Order ${order.orderId}`);
    console.log(
      `[e2e]   Items: ${order.items.length}, Product: ${shorts.name}`,
    );
    console.log(
      `[e2e]   Coupon: ${order.coupon || "none"}, Shipping: ${order.shippingMethod}`,
    );
    console.log(`[e2e]   Total: $${order.total}`);

    // Regression guard: exactly 1 order (no double execution from node bleed)
    const orderCount = await h.page.evaluate(
      () => (window as any).previousOrders?.length ?? 0,
    );
    expect(orderCount, "Node isolation: expected exactly 1 order").toBe(1);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 380_000);

  it("agent handles natural two-item order with coupon and express shipping", async () => {
    await navigateAndWait(h.page, getFixtureUrl("shop"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "I'd like to order the Pegasus 41 shoes and the Novablast 4 shoes. " +
      "Use coupon SAVE10 for the discount. Ship express please. " +
      "Name: Alex Morgan, email: alex.morgan@example.com.";

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
      480_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        orderError:
          (
            document.getElementById("order-error") as HTMLElement | null
          )?.textContent?.trim() || "",
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
    expect(order.name).toBe("Alex Morgan");
    expect(order.email).toBe("alex.morgan@example.com");

    const pegasus = order.items.find((item: any) => item.id === "pegasus-41");
    const novablast = order.items.find(
      (item: any) => item.id === "novablast-4",
    );
    expect(pegasus).toBeDefined();
    expect(novablast).toBeDefined();
    expect(order.items.length).toBe(2);
    // Pegasus $149 + Novablast $140 = $289, -10% = $260.10, +$15 express = $275.10
    expect(order.total).toBeCloseTo(275.1, 1);

    console.log(`\n[e2e] PASS — Order ${order.orderId}`);
    console.log(
      `[e2e]   Name: ${order.name}, Email: ${order.email}`,
    );
    console.log(
      `[e2e]   Items: ${pegasus.name}, ${novablast.name}`,
    );
    console.log(
      `[e2e]   Coupon: ${order.coupon}, Shipping: ${order.shippingMethod}`,
    );
    console.log(`[e2e]   Total: $${order.total}`);

    // Regression guard: exactly 1 order (no double execution from node bleed)
    const orderCount = await h.page.evaluate(
      () => (window as any).previousOrders?.length ?? 0,
    );
    expect(orderCount, "Node isolation: expected exactly 1 order").toBe(1);

    // Structural node isolation check (multi-item = likely multi-node orchestration)
    const { traceFiles } = await h.printTraceSummary();
    const allEvents = await getMonitoredEvents(h.ctx.serviceWorker, 200);
    const wsEvents = allEvents.filter(
      (e: any) => e.workspaceId == null || e.workspaceId === workspaceId,
    );
    assertNodeIsolation(wsEvents, traceFiles);

    // Verify no ghost session starts after order completion
    console.log("[e2e] Watching for ghost sessions (12s quiet period)...");
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
    console.log("[e2e] No ghost session detected — OK");
  }, 540_000);

});
