/**
 * E2E: Support Ticket — Zendesk/Jira-style ticket triage.
 * Agent reads the ticket, changes status to "In Progress",
 * and adds an internal comment summarizing the issue.
 *
 * Tests: read comprehension, dropdown interaction, textarea, multi-action.
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

const h = createE2EHarness({ maxTurns: 20, testLabel: "support-ticket" });

describe.skipIf(!h.apiKey)("E2E: Support Ticket", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("support-ticket"));
  afterAll(() => h.afterAllHook());

  it("reads ticket, changes status, and adds internal comment", async () => {
    await navigateAndWait(h.page, getFixtureUrl("support-ticket"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "This is a support ticket system. Read ticket TICKET-4271 about a CSV export timeout issue.",
      "",
      "Do two things:",
      "1. Change the Status dropdown from 'Open' to 'In Progress'",
      "2. Add an internal comment that briefly summarizes the issue and notes the next steps",
      "   (e.g., investigate the export timeout, check if it's related to the report size or server config)",
      "",
      "Make sure the internal note checkbox stays checked.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).ticketResult ?? null,
        );
        if (!result) return null;
        // Need both status changed AND comment added
        if (!result.statusChanged || result.commentsAdded < 1) return null;
        return result;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        result: (window as any).ticketResult ?? null,
        statusValue:
          (document.getElementById("status-select") as HTMLSelectElement)
            ?.value || "",
        commentValue:
          (document.getElementById("comment-input") as HTMLTextAreaElement)
            ?.value || "",
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

    // Verify status changed to "In Progress"
    expect(outcome.result.currentStatus).toBe("In Progress");

    // Verify comment was added
    expect(outcome.result.commentsAdded).toBeGreaterThanOrEqual(1);

    // Verify comment mentions the core issue
    const comment = (outcome.result.lastComment as string).toLowerCase();
    expect(
      comment.includes("csv") ||
        comment.includes("export") ||
        comment.includes("timeout") ||
        comment.includes("report"),
    ).toBe(true);

    // Verify it was an internal note
    expect(outcome.result.lastCommentInternal).toBe(true);

    console.log(`\n[e2e] PASS — Ticket triaged`);
    console.log(`[e2e]   Status: ${outcome.result.currentStatus}`);
    console.log(
      `[e2e]   Comment: ${(outcome.result.lastComment as string).slice(0, 120)}...`,
    );

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
