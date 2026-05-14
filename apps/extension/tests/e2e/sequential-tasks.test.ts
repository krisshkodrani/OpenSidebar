/**
 * E2E: Sequential Tasks — shopping checkout followed by page summarization.
 *
 * Tests that the agent correctly manages context across consecutive tasks:
 * completes a checkout on /shop, then navigates to /summarize and
 * summarizes the Transformer Architecture article.
 *
 * Run: pnpm exec vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/sequential-tasks.test.ts
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
  clearMonitoredEvents,
  getActiveTabId,
  getMonitoredEvents,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  extractDoneSummary,
  findAllNewTraceFiles,
  readTrace,
  formatTraceSummary,
  snapshotTraceFiles,
} from "./helpers/diagnostics";

const h = createE2EHarness({ maxTurns: 30, testLabel: "sequential-tasks" });

describe.skipIf(!h.apiKey)("E2E: Sequential Tasks", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("sequential-tasks"));
  afterAll(() => h.afterAllHook());

  it("completes checkout then navigates and summarizes a different page", async () => {
    // =========================================================
    // TASK 1: Shopping checkout
    // =========================================================
    console.log("\n[e2e:seq] === TASK 1: Shopping Checkout ===");
    await navigateAndWait(h.page, getFixtureUrl("shop"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const shopPrompt =
      "Buy the Air Zoom Pegasus 41, apply coupon SAVE10, choose express shipping, " +
      "and checkout as Alex Morgan (alex.morgan@example.com).";

    const workspaceId1 = await sendUserChat(h.ctx, shopPrompt, tabId);

    const shopOutcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const order = await h.page.evaluate(
          () => (window as any).lastOrder ?? null,
        );
        return order || null;
      },
      300_000,
      workspaceId1,
    );

    await h.printTraceSummary();

    if (!shopOutcome.ok) {
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
        "[e2e:seq] TASK 1 FAILURE:",
        JSON.stringify(
          { reason: shopOutcome.reason, ui, events: shopOutcome.events.slice(-10) },
          null,
          2,
        ),
      );
    }
    expect(shopOutcome.ok, `Task 1 failed: ${shopOutcome.reason}`).toBe(true);

    const order = shopOutcome.result as any;
    expect(order).toBeTruthy();
    expect(order.shippingMethod).toBe("express");
    expect(order.coupon).toBe("SAVE10");
    expect(order.email).toBe("alex.morgan@example.com");

    const pegasus = order.items.find((item: any) => item.id === "pegasus-41");
    expect(pegasus).toBeDefined();

    console.log(`[e2e:seq] Task 1 PASS — Order ${order.orderId}`);
    console.log(`[e2e:seq]   Coupon: ${order.coupon}, Shipping: ${order.shippingMethod}, Total: $${order.total}`);

    // Verify exactly 1 order (node isolation)
    const orderCount = await h.page.evaluate(
      () => (window as any).previousOrders?.length ?? 0,
    );
    expect(orderCount, "Node isolation: expected exactly 1 order").toBe(1);

    // =========================================================
    // TRANSITION: Wait for idle, clear events, navigate
    // =========================================================
    console.log("\n[e2e:seq] === TRANSITION: Navigating to /summarize ===");

    // Wait for agent to fully settle
    await new Promise((r) => setTimeout(r, 8_000));
    await clearMonitoredEvents(h.ctx.serviceWorker);

    // Snapshot traces so Task 2 traces are isolated
    const tracesAfterTask1 = snapshotTraceFiles();

    // Navigate to the summarize page
    await navigateAndWait(h.page, getFixtureUrl("summarize"));
    await h.page.bringToFront();

    // Verify the page actually loaded the summarize content
    const pageTitle = await h.page.title();
    console.log(`[e2e:seq] Page title after navigation: "${pageTitle}"`);

    const tabId2 = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId2).toBeGreaterThan(0);

    // =========================================================
    // TASK 2: Summarize the page (fresh workspace for clean state)
    // =========================================================
    console.log("\n[e2e:seq] === TASK 2: Summarize Page ===");

    const summarizePrompt =
      "Summarize this page in a few sentences.";

    // Fresh workspace for Task 2 — ensures clean event state
    const workspaceId2 = await sendUserChat(h.ctx, summarizePrompt, tabId2);

    const sumOutcome = await waitForTaskCompletion(
      h.ctx,
      120_000,
      workspaceId2,
    );

    // Print only Task 2 traces
    await new Promise((r) => setTimeout(r, 2_000));
    const task2Traces = findAllNewTraceFiles(tracesAfterTask1);
    for (const f of task2Traces) {
      const turns = readTrace(f);
      console.log(formatTraceSummary(turns));
      console.log(`[sequential-tasks] Task 2 Trace: ${f}`);
    }

    if (!sumOutcome.ok) {
      console.log(
        "[e2e:seq] TASK 2 FAILURE:",
        JSON.stringify(
          { reason: sumOutcome.reason, events: sumOutcome.events.slice(-10) },
          null,
          2,
        ),
      );
    }
    expect(sumOutcome.ok, `Task 2 failed: ${sumOutcome.reason}`).toBe(true);
    const summary = extractDoneSummary(task2Traces).toLowerCase();
    const coveredConcepts = [
      /attention/.test(summary),
      /encoder|decoder/.test(summary),
      /position/.test(summary),
      /parallel|efficien/.test(summary),
    ].filter(Boolean).length;
    expect(summary, "Task 2 must produce a summarization answer").toBeTruthy();
    expect(
      coveredConcepts,
      `Task 2 summary should cover the summarize page content. Got: ${summary}`,
    ).toBeGreaterThanOrEqual(2);

    console.log(`[e2e:seq] Task 2 PASS — Summarize completed`);
    console.log(`[e2e:seq]   Task 2 traces: ${task2Traces.length}`);

    // =========================================================
    // Validate Task 2 context: agent saw the summarize page
    // =========================================================
    const task2Events = await getMonitoredEvents(h.ctx.serviceWorker, 200);
    const ws2Events = task2Events.filter(
      (e: any) => e.workspaceId == null || e.workspaceId === workspaceId2,
    );

    // Log task 2 objective progression
    const progressEvents = ws2Events.filter(
      (e: any) => e.type === "TASK_PROGRESS" && Array.isArray(e.subtasks),
    );
    if (progressEvents.length > 0) {
      const last = progressEvents[progressEvents.length - 1];
      const subtasks = last.subtasks as Array<{ description?: string; status?: string }>;
      console.log(`[e2e:seq] Task 2 plan: ${subtasks.length} node(s)`);
      for (const s of subtasks) {
        console.log(`[e2e:seq]   ${s.status}: "${(s.description ?? "").slice(0, 60)}"`);
      }
    }

    // Verify Task 2 trace was on /summarize, not /shop
    if (task2Traces.length > 0) {
      const firstTurns = readTrace(task2Traces[0]);
      const traceUrl = (firstTurns[0] as any)?.url || "";
      console.log(`[e2e:seq] Task 2 trace URL: ${traceUrl}`);
      expect(
        traceUrl,
        "Task 2 should execute on /summarize page, not /shop",
      ).toContain("/summarize");
    }

    // =========================================================
    // Final: no ghost session after both tasks
    // =========================================================
    console.log("\n[e2e:seq] === POST-CHECK: Ghost session detection ===");
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId2);
    console.log("[e2e:seq] No ghost session — OK");

    console.log("\n[e2e:seq] === SEQUENTIAL TASKS PASSED ===");
  }, 480_000);
});
