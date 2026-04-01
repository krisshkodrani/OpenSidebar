/**
 * E2E: Online Shopping boundary regression.
 *
 * Validates:
 * 1. Step advancement without done() rejection churn
 * 2. Objective-level plan progression (TASK_PROGRESS events)
 * 3. Node isolation (no single executor completes multiple nodes)
 * 4. Order count guard (exactly 1 order placed)
 *
 * Run: npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/online-shop-boundaries.test.ts
 */

import { readFileSync } from "fs";
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

const h = createE2EHarness({
  maxTurns: 30,
  testLabel: "online-shop-boundaries",
});

type RawTraceTurn = {
  llmResponse?: {
    toolCalls?: Array<{
      function?: {
        name?: string;
      };
    }>;
  };
  toolExecutions?: Array<{
    toolName?: string;
  }>;
  events?: Array<{
    type?: string;
    data?: Record<string, unknown>;
  }>;
};

function readRawTraceTurns(filePath: string): RawTraceTurn[] {
  return readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RawTraceTurn);
}

/**
 * Log objective progression from TASK_PROGRESS events.
 * Shows each status transition with timestamps.
 */
function logObjectiveProgression(events: any[]): void {
  const progressEvents = events.filter(
    (e: any) => e.type === "TASK_PROGRESS" && Array.isArray(e.subtasks),
  );

  if (progressEvents.length === 0) {
    console.log("[e2e:boundaries] No TASK_PROGRESS events with subtasks captured");
    return;
  }

  console.log(`\n[e2e:boundaries] === Objective Progression (${progressEvents.length} updates) ===`);

  let prevStatuses: string[] = [];
  for (const evt of progressEvents) {
    const subtasks = evt.subtasks as Array<{ description?: string; status?: string; result?: string }>;
    const statuses = subtasks.map((s) => s.status ?? "unknown");
    const ts = new Date(evt.timestamp).toISOString().slice(11, 23);

    // Detect which objectives changed since last update
    const changes: string[] = [];
    for (let i = 0; i < statuses.length; i++) {
      if (prevStatuses[i] !== statuses[i]) {
        const desc = (subtasks[i]?.description ?? `Node ${i}`).slice(0, 60);
        changes.push(`  [${i}] ${prevStatuses[i] ?? "—"} → ${statuses[i]}: "${desc}"`);
      }
    }

    if (changes.length > 0) {
      console.log(`[e2e:boundaries] ${ts} | currentIndex=${evt.currentIndex}`);
      for (const c of changes) console.log(`[e2e:boundaries] ${c}`);
    }

    prevStatuses = statuses;
  }

  // Log final state
  const lastEvt = progressEvents[progressEvents.length - 1];
  const finalSubtasks = lastEvt.subtasks as Array<{ description?: string; status?: string; result?: string }>;
  console.log(`\n[e2e:boundaries] === Final Objective State ===`);
  for (let i = 0; i < finalSubtasks.length; i++) {
    const s = finalSubtasks[i];
    const result = s.result ? ` → "${String(s.result).slice(0, 80)}"` : "";
    console.log(`[e2e:boundaries]   [${i}] ${s.status}: "${(s.description ?? "").slice(0, 60)}"${result}`);
  }
}

/**
 * Log node completion events from traces.
 */
function logTraceNodeEvents(rawTurns: RawTraceTurn[]): void {
  const nodeEvents = rawTurns
    .flatMap((turn) => turn.events ?? [])
    .filter((event) =>
      event.type === "node_completed" ||
      event.type === "node_started" ||
      event.type === "node_failed" ||
      event.type === "plan_decomposed",
    );

  if (nodeEvents.length === 0) {
    console.log("[e2e:boundaries] No node lifecycle trace events found");
    return;
  }

  console.log(`\n[e2e:boundaries] === Trace Node Events (${nodeEvents.length}) ===`);
  for (const evt of nodeEvents) {
    const data = evt.data ?? {};
    if (evt.type === "plan_decomposed") {
      console.log(`[e2e:boundaries]   PLAN: ${(data as any).nodeCount ?? "?"} nodes, difficulty=${(data as any).difficulty ?? "?"}`);
    } else if (evt.type === "node_started") {
      console.log(`[e2e:boundaries]   START: node=${(data as any).nodeId ?? "?"}, retries=${(data as any).retries ?? 0}`);
    } else if (evt.type === "node_completed") {
      console.log(`[e2e:boundaries]   DONE:  node=${(data as any).nodeId ?? "?"}, outcome=${(data as any).outcome ?? "?"}, summary="${String((data as any).summary ?? "").slice(0, 80)}"`);
    } else if (evt.type === "node_failed") {
      console.log(`[e2e:boundaries]   FAIL:  node=${(data as any).nodeId ?? "?"}, error="${String((data as any).error ?? "").slice(0, 80)}"`);
    }
  }
}

describe.skipIf(!h.apiKey)("E2E: Online Shopping Boundaries", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("online-shop-boundaries"));
  afterAll(() => h.afterAllHook());

  it("advances shopping steps without done() rejection churn", async () => {
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
      async () =>
        (await h.page.evaluate(() => (window as any).lastOrder ?? null)) ||
        null,
      300_000,
      workspaceId,
    );

    expect(outcome.ok, outcome.reason).toBe(true);

    // --- Trace-level checks ---
    const { traceFiles } = await h.printTraceSummary();
    expect(traceFiles.length).toBeGreaterThan(0);

    const rawTurns = traceFiles.flatMap((filePath) =>
      readRawTraceTurns(filePath),
    );
    const doneRejectedCount = rawTurns
      .flatMap((turn) => turn.events ?? [])
      .filter((event) => event.type === "done_rejected").length;
    const doneCalls = rawTurns
      .flatMap((turn) => turn.llmResponse?.toolCalls ?? [])
      .filter((call) => call.function?.name === "done").length;
    const toolExecutions = rawTurns.flatMap((turn) =>
      (turn.toolExecutions ?? []).map((entry) => entry.toolName ?? ""),
    );

    expect(doneCalls).toBeGreaterThan(0);
    expect(doneRejectedCount).toBeLessThanOrEqual(3);
    expect(toolExecutions).toContain("click_element");
    expect(toolExecutions).toContain("type_text");

    // --- Objective progression logging ---
    const allEvents = await getMonitoredEvents(h.ctx.serviceWorker, 200);
    const wsEvents = allEvents.filter(
      (e: any) => e.workspaceId == null || e.workspaceId === workspaceId,
    );

    logObjectiveProgression(wsEvents);
    logTraceNodeEvents(rawTurns);

    // --- Objective completion validation ---
    const progressEvents = wsEvents.filter(
      (e: any) => e.type === "TASK_PROGRESS" && Array.isArray(e.subtasks),
    );

    // If orchestrator decomposed into multiple nodes, validate ordering
    if (progressEvents.length > 0) {
      const lastProgress = progressEvents[progressEvents.length - 1];
      const subtasks = lastProgress.subtasks as Array<{ status?: string }>;
      const completedCount = subtasks.filter((s) => s.status === "completed").length;
      const failedCount = subtasks.filter((s) => s.status === "failed").length;

      console.log(
        `[e2e:boundaries] Plan result: ${completedCount} completed, ${failedCount} failed, ${subtasks.length} total`,
      );

      // All objectives should complete (no failures for success tests)
      expect(failedCount, "No objectives should fail in a successful checkout").toBe(0);
    }

    // --- TASK_COMPLETION final check ---
    const completionEvents = wsEvents.filter(
      (e: any) => e.type === "TASK_COMPLETION",
    );
    if (completionEvents.length > 0) {
      const last = completionEvents[completionEvents.length - 1];
      console.log(
        `[e2e:boundaries] TASK_COMPLETION: status=${last.status}`,
      );
      if (last.subtaskResults) {
        for (const r of last.subtaskResults as Array<{ description?: string; status?: string; result?: string }>) {
          console.log(
            `[e2e:boundaries]   ${r.status}: "${(r.description ?? "").slice(0, 60)}" → "${(r.result ?? "").slice(0, 80)}"`,
          );
        }
      }
    }

    // --- Node isolation: exactly 1 order, no executor bleed ---
    const orderCount = await h.page.evaluate(
      () => (window as any).previousOrders?.length ?? 0,
    );
    expect(orderCount, "Node isolation: expected exactly 1 order").toBe(1);

    assertNodeIsolation(wsEvents, traceFiles);

    await assertNoGhostSession(h.ctx.serviceWorker, 10_000, workspaceId);
  }, 360_000);
});
