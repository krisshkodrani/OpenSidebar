/**
 * E2E: Email Compose — Gmail-style email reply.
 * Agent reads an email about a strategy meeting, drafts a polite
 * decline reply, but does NOT send it.
 *
 * Tests: contenteditable, read-then-compose, tone instruction, negative constraint.
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

const h = createE2EHarness({ maxTurns: 20, testLabel: "email-compose" });

describe.skipIf(!h.apiKey)("E2E: Email Compose", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("email-compose"));
  afterAll(() => h.afterAllHook());

  it("reads email and drafts a professional decline without sending", async () => {
    await navigateAndWait(h.page, getFixtureUrl("email-compose"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "This is an email client. Read the open email from David Park about the Q3 strategy meeting.",
      "",
      "Draft a reply in the reply editor. The reply should:",
      "- Politely decline attendance for both proposed times (Thursday and Friday)",
      "- Explain that you have a conflict with a client demo on Thursday and a team offsite on Friday",
      "- Suggest Monday at 2 PM as an alternative",
      "- Keep it professional and concise (3-4 sentences)",
      "",
      "IMPORTANT: Type the reply but do NOT click Send. Just compose it in the reply box.",
    ].join("\n");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).emailResult ?? null,
        );
        if (!result?.composed) return null;
        if (result.sent) return null;
        if (result.messageLength < 40) return null;
        return result;
      },
      240_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => {
        const editor = document.getElementById("reply-editor");
        return {
          editorText: editor?.innerText?.slice(0, 200) || "",
          result: (window as any).emailResult ?? null,
        };
      });
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

    const msg = (outcome.result.message as string).toLowerCase();

    // Verify it was NOT sent
    expect(outcome.result.sent).toBe(false);

    // Verify key content
    expect(msg.includes("monday") || msg.includes("alternative")).toBe(true);
    expect(
      msg.includes("conflict") ||
        msg.includes("unable") ||
        msg.includes("unfortunately") ||
        msg.includes("can't make") ||
        msg.includes("cannot attend"),
    ).toBe(true);

    console.log(`\n[e2e] PASS — Email reply drafted (not sent)`);
    console.log(
      `[e2e]   Reply (${outcome.result.messageLength} chars): ${outcome.result.message.slice(0, 150)}...`,
    );

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 320_000);
});
