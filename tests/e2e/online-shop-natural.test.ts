/**
 * E2E: Online Shopping (natural prompt) — same checkout flow, human-like instruction.
 *
 * Compares agent performance with a minimal, natural user prompt vs
 * the detailed step-by-step prompt in online-shop.test.ts.
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/online-shop-natural.test.ts
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

const h = createE2EHarness({ maxTurns: 50, testLabel: "online-shop-natural" });

describe.skipIf(!h.apiKey)("E2E: Online Shopping (natural prompt)", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("online-shop-natural"));
  afterAll(() => h.afterAllHook());

  it("agent completes checkout from a natural user prompt", async () => {
    await navigateAndWait(h.page, getFixtureUrl("shop"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt =
      "Buy the Air Zoom Pegasus 41, apply coupon SAVE10, choose express shipping, and checkout as Alex Morgan (alex.morgan@example.com).";

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
        "[e2e:natural] FAILURE DIAGNOSTICS:",
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

    console.log(`\n[e2e:natural] PASS — Order ${order.orderId}`);
    console.log(
      `[e2e:natural]   Items: ${order.items.length}, Pegasus: ${pegasus.name}`,
    );
    console.log(
      `[e2e:natural]   Coupon: ${order.coupon}, Shipping: ${order.shippingMethod}`,
    );
    console.log(`[e2e:natural]   Total: $${order.total}`);

    // Regression guard: exactly 1 order (no double execution from node bleed)
    const orderCount = await h.page.evaluate(
      () => (window as any).previousOrders?.length ?? 0,
    );
    expect(orderCount, "Node isolation: expected exactly 1 order").toBe(1);

    // Structural node isolation check
    const { traceFiles } = await h.printTraceSummary();
    const allEvents = await getMonitoredEvents(h.ctx.serviceWorker, 200);
    const wsEvents = allEvents.filter(
      (e: any) => e.workspaceId == null || e.workspaceId === workspaceId,
    );
    assertNodeIsolation(wsEvents, traceFiles);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 360_000);
});
