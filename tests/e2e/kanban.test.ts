/**
 * E2E: Kanban — drag task cards between columns.
 *
 * Tests: drag_and_drop tool
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
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 20, testLabel: "kanban" });

describe.skipIf(!h.apiKey)("E2E: Kanban", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("kanban"));
  afterAll(() => h.afterAllHook());

  it("agent drags a task card from To Do to In Progress", async () => {
    await navigateAndWait(h.page, getFixtureUrl("kanban"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "This is a Kanban board with three columns: To Do, In Progress, and Done.",
      "",
      "Drag the task card 'Design Homepage' from the 'To Do' column and drop it onto the 'In Progress' column.",
      "",
      "Use drag_and_drop to move the card. The source is the 'Design Homepage' card and the target is the 'In Progress' column area.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).kanbanResult ?? null,
        );
        if (result && result.moves?.length >= 1) return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        moveLog: document.getElementById("move-log")?.textContent || "",
        kanbanResult: (window as any).kanbanResult,
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

    const result = outcome.result as any;
    expect(result.moves.length).toBeGreaterThanOrEqual(1);
    expect(result.moves[0].card).toBe("Design Homepage");
    expect(result.moves[0].to).toBe("in-progress");

    console.log(`\n[e2e] PASS — Task dragged to In Progress`);
    console.log(`[e2e]   Moves: ${JSON.stringify(result.moves)}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
