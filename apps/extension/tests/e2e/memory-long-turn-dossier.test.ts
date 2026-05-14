/**
 * E2E: Long-turn dossier memory.
 *
 * This is intentionally gated behind E2E_SUITE_FLAGS=memory-long because it
 * runs a longer multi-turn workflow. It verifies that facts collected over
 * several turns can still be used to edit a draft on a different page.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createE2EHarness } from "./helpers/harness";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  settleWorkspaceBetweenTurns,
  waitForOutcome,
  waitForTaskCompletion,
} from "./helpers/utils";
import { isE2ESuiteFlagEnabled } from "./helpers/e2e-config";

const h = createE2EHarness({ maxTurns: 18, testLabel: "memory-long-dossier" });
const TURN_TIMEOUT = 180_000;
const enableLongMemoryE2E = isE2ESuiteFlagEnabled("memory-long");

function draftIncludesRequiredFacts(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /orbit-?7321/i.test(text) &&
    normalized.includes("priya shah") &&
    normalized.includes("billing migration") &&
    normalized.includes("bluefin") &&
    /91\.6/.test(text) &&
    /\b27\b/.test(text)
  );
}

describe.skipIf(!h.apiKey || !enableLongMemoryE2E)(
  "E2E: Long-turn dossier memory",
  () => {
    beforeAll(() => h.beforeAllHook(), 60_000);
    beforeEach(() => h.beforeEachHook());
    afterEach(() => h.afterEachHook("memory-long-turn-dossier"));
    afterAll(() => h.afterAllHook());

    it("uses facts collected across several turns to draft and refine an email", async () => {
      const workspaceId = `e2e-memory-long-${crypto.randomUUID()}`;

      await navigateAndWait(h.page, getFixtureUrl("memory-lab"));
      await h.page.bringToFront();
      const tabId = await getActiveTabId(h.ctx.serviceWorker);
      expect(tabId).toBeGreaterThan(0);

      await sendUserChat(
        h.ctx,
        "Read the dossier facts. Tell me the activation code, launch owner, quarterly revenue, and retention rate.",
        tabId,
        workspaceId,
      );
      const turn1 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
      expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);
      await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

      await sendUserChat(
        h.ctx,
        "Now read the risk and support details. Tell me the primary risk, support queue size, and escalation window.",
        tabId,
        workspaceId,
      );
      const turn2 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
      expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);
      await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

      await sendUserChat(
        h.ctx,
        "Read the research notes and identify the Northstar segment and whether it is stable.",
        tabId,
        workspaceId,
      );
      const turn3 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
      expect(turn3.ok, `Turn 3 failed: ${turn3.reason}`).toBe(true);
      await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

      await navigateAndWait(h.page, getFixtureUrl("email-compose"));
      await h.page.bringToFront();

      await sendUserChat(
        h.ctx,
        "Draft a concise launch memo in the reply box using the dossier details you collected. Include the activation code, launch owner, primary risk, Northstar segment, retention rate, and support queue size. Do not send it.",
        tabId,
        workspaceId,
      );

      const turn4 = await waitForOutcome(
        h.page,
        h.ctx.serviceWorker,
        async () => {
          const result = await h.page.evaluate(() => (window as any).emailResult ?? null);
          if (!result?.composed || result.sent) return null;
          return draftIncludesRequiredFacts(result.message) ? result : null;
        },
        TURN_TIMEOUT,
        workspaceId,
      );
      expect(turn4.ok, `Turn 4 failed: ${turn4.reason}`).toBe(true);
      await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

      const previousDraft = String(turn4.result?.message ?? "");
      await sendUserChat(
        h.ctx,
        "Refine the draft into three short paragraphs while preserving every factual detail. Keep it unsent.",
        tabId,
        workspaceId,
      );

      const turn5 = await waitForOutcome(
        h.page,
        h.ctx.serviceWorker,
        async () => {
          const result = await h.page.evaluate(() => (window as any).emailResult ?? null);
          if (!result?.composed || result.sent) return null;
          if (result.message === previousDraft) return null;
          return draftIncludesRequiredFacts(result.message) ? result : null;
        },
        TURN_TIMEOUT,
        workspaceId,
      );
      expect(turn5.ok, `Turn 5 failed: ${turn5.reason}`).toBe(true);
      expect(turn5.result!.sent, "The draft should remain unsent").toBe(false);

      await h.printTraceSummary(workspaceId);
      await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
    }, 780_000);
  },
);
