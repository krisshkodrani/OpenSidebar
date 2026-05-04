/**
 * E2E: Context Menu — right-click document, select Rename from context menu,
 * type new name, confirm.
 *
 * Tests: right_click tool, custom context menus
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

const h = createE2EHarness({ maxTurns: 25, testLabel: "context-menu" });

describe.skipIf(!h.apiKey)("E2E: Context Menu", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("context-menu"));
  afterAll(() => h.afterAllHook());

  it("agent right-clicks a document, selects Rename, and types a new name", async () => {
    await navigateAndWait(h.page, getFixtureUrl("context-menu"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Rename the document 'Q3 Report.pdf' to 'Q3 Financial Report 2026.pdf'.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).contextMenuResult ?? null,
        );
        if (result && result.renamed) return result;
        return null;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        renameConfirmation: document.getElementById("rename-confirmation")?.textContent || "",
        contextMenu: document.getElementById("custom-context-menu")?.textContent || "",
        contextMenuResult: (window as any).contextMenuResult,
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
    expect(result.renamed).toBe(true);
    expect(result.oldName).toBe("Q3 Report.pdf");
    expect(result.newName).toBe("Q3 Financial Report 2026.pdf");

    console.log(`\n[e2e] PASS — Document renamed`);
    console.log(`[e2e]   Old: ${result.oldName}`);
    console.log(`[e2e]   New: ${result.newName}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
