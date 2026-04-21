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

    const prompt =
      "Add the Air Zoom Pegasus 41 to cart, apply coupon SAVE10, choose express shipping, and checkout as Alex Morgan (alex.morgan@example.com).";

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

    // Regression guard: no executor/node bleed across a multi-node checkout.
    // The planner may legitimately decompose the checkout into multiple nodes,
    // so raw trace count is no longer a reliable proxy for worker restarts.
    const { traceFiles } = await h.printTraceSummary(workspaceId);
    const allEvents = await getMonitoredEvents(h.ctx.serviceWorker, 200);
    const wsEvents = allEvents.filter(
      (e: any) => e.workspaceId == null || e.workspaceId === workspaceId,
    );
    assertNodeIsolation(wsEvents, traceFiles);

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
