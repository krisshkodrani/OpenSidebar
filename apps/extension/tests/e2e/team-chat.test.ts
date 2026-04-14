/**
 * E2E: Team Chat — Slack-style messaging. Read discussion, type a
 * well-formatted reply from rough user notes, and send it.
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
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";

const h = createE2EHarness({ maxTurns: 20, testLabel: "team-chat" });

describe.skipIf(!h.apiKey)("E2E: Team Chat", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("team-chat"));
  afterAll(() => h.afterAllHook());

  it("reads discussion and sends a professionally formatted reply", async () => {
    await navigateAndWait(h.page, getFixtureUrl("team-chat"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "This is a team chat. Sarah is asking about the release date and who handles the changelog.",
      "Reply to the thread based on these notes but rewrite it as a clear, professional message:",
      "",
      "'release is set for thursday, i will handle the changelog wednesday evening,",
      "carol needs to wrap up the onboarding flow first but she said wednesday at the latest,",
      "dave can cut the release branch once carol merges'",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).chatResult ?? null,
        );
        if (!result?.sent) return null;
        return result;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => ({
        inputValue:
          (document.getElementById("chat-input") as HTMLTextAreaElement)
            ?.value || "",
        messageCount: document.querySelectorAll("#chat-messages > div").length,
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

    // Verify the sent message contains the key information (case-insensitive)
    const msg = (outcome.result.message as string).toLowerCase();
    expect(msg).toContain("thursday");
    expect(msg).toMatch(/changelog/i);
    // Should mention onboarding or Carol
    expect(msg.includes("onboarding") || msg.includes("carol")).toBe(true);

    console.log(`\n[e2e] PASS — Reply sent`);
    console.log(
      `[e2e]   Message (${outcome.result.message.length} chars): ${outcome.result.message.slice(0, 120)}...`,
    );

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
