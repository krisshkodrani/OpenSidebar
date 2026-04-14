/**
 * E2E: Continuation — Cart Swap (undo + redirect).
 *
 * Tests that the agent can undo a prior action and change course
 * when the user realizes they picked the wrong item.
 *
 * Turn 1: Add Novablast 4 to cart
 * Turn 2: Remove it, add Pegasus 41 instead
 * Turn 3: Checkout with coupon + standard shipping
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/continuation-cart-swap.test.ts
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
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  settleWorkspaceBetweenTurns,
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 20, testLabel: "cart-swap" });

const TURN_TIMEOUT = 200_000;

describe.skipIf(!h.apiKey)("E2E: Continuation — Cart Swap", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("cart-swap"));
  afterAll(() => h.afterAllHook());

  it("swaps a wrong cart item and completes checkout", async () => {
    await navigateAndWait(h.page, getFixtureUrl("shop"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const workspaceId = `e2e-cart-swap-${crypto.randomUUID()}`;

    // =================================================================
    // TURN 1: Add the wrong item
    // =================================================================
    console.log("\n[cart-swap] === TURN 1: Add Novablast 4 ===");

    await sendUserChat(
      h.ctx,
      "Add the Novablast 4 to the cart.",
      tabId,
      workspaceId,
    );

    const turn1 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const state = await h.page.evaluate(
          () => (window as any).__shopState ?? null,
        );
        if (!state?.cart?.length) return null;
        const hasNova = state.cart.some(
          (item: any) => item.id === "novablast-4",
        );
        return hasNova ? state : null;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn1.ok) {
      const cart = await h.page.evaluate(
        () => (window as any).__shopState?.cart ?? [],
      );
      console.log("[cart-swap] TURN 1 FAIL:", { reason: turn1.reason, cart });
    }
    expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);

    console.log("[cart-swap] Turn 1 PASS — Novablast in cart");

    // =================================================================
    // TRANSITION
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

    // =================================================================
    // TURN 2: Remove wrong item, add correct one
    // =================================================================
    console.log("\n[cart-swap] === TURN 2: Swap to Pegasus 41 ===");

    await sendUserChat(
      h.ctx,
      "Wrong shoe — remove the Novablast from the cart and add the Pegasus 41 instead.",
      tabId,
      workspaceId,
    );

    const turn2 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const state = await h.page.evaluate(
          () => (window as any).__shopState ?? null,
        );
        if (!state?.cart?.length) return null;
        const hasPegasus = state.cart.some(
          (item: any) => item.id === "pegasus-41",
        );
        const hasNova = state.cart.some(
          (item: any) => item.id === "novablast-4",
        );
        // Pegasus must be in, Novablast must be out
        return hasPegasus && !hasNova ? state : null;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn2.ok) {
      const cart = await h.page.evaluate(
        () => (window as any).__shopState?.cart ?? [],
      );
      console.log("[cart-swap] TURN 2 FAIL:", {
        reason: turn2.reason,
        cart: cart.map((c: any) => c.id),
      });
    }
    expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);

    console.log("[cart-swap] Turn 2 PASS — Cart swapped to Pegasus");

    // =================================================================
    // TRANSITION
    // =================================================================
    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

    // =================================================================
    // TURN 3: Checkout
    // =================================================================
    console.log("\n[cart-swap] === TURN 3: Checkout ===");

    await sendUserChat(
      h.ctx,
      "Apply coupon SAVE10, choose standard shipping, and checkout as alex@example.com.",
      tabId,
      workspaceId,
    );

    const turn3 = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const order = await h.page.evaluate(
          () => (window as any).lastOrder ?? null,
        );
        if (!order) return null;
        return order;
      },
      TURN_TIMEOUT,
      workspaceId,
    );

    if (!turn3.ok) {
      const state = await h.page.evaluate(
        () => (window as any).__shopState ?? null,
      );
      console.log("[cart-swap] TURN 3 FAIL:", {
        reason: turn3.reason,
        coupon: state?.coupon,
        shipping: state?.shippingMethod,
        cart: state?.cart?.map((c: any) => c.id),
      });
    }
    expect(turn3.ok, `Turn 3 failed: ${turn3.reason}`).toBe(true);

    const order = turn3.result as any;
    expect(order.coupon).toBe("SAVE10");
    expect(order.shippingMethod).toBe("standard");
    expect(order.email).toBe("alex@example.com");

    // Must be Pegasus, not Novablast
    const pegasus = order.items.find((i: any) => i.id === "pegasus-41");
    const nova = order.items.find((i: any) => i.id === "novablast-4");
    expect(pegasus, "Order should contain Pegasus 41").toBeDefined();
    expect(nova, "Order should NOT contain Novablast 4").toBeUndefined();

    // Exactly 1 order placed
    const orderCount = await h.page.evaluate(
      () => (window as any).previousOrders?.length ?? 0,
    );
    expect(orderCount, "Node isolation: expected exactly 1 order").toBe(1);

    console.log(`[cart-swap] Turn 3 PASS — Order ${order.orderId}`);
    console.log(`[cart-swap]   Item: ${pegasus.name}, Coupon: ${order.coupon}, Total: $${order.total}`);

    // =================================================================
    // Final checks
    // =================================================================
    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

    console.log("\n[cart-swap] === ALL 3 TURNS PASSED ===");
  }, 660_000);
});
