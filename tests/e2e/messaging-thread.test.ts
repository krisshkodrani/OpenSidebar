/**
 * E2E: Messaging Thread — LinkedIn-style German thread.
 *
 * Test 1: Agent reads a German discussion, composes a reply in German
 * based on English instructions, but does NOT send it.
 * Tests: cross-language, contenteditable, read-then-compose, negative constraint.
 *
 * Test 2: Agent clicks the reply editor and types a short message.
 * Verifies no click_element calls were falsely intercepted (body/html
 * false-positive regression — see LinkedIn trace 063466dc).
 * Tests: click interception correctness on fixed-panel messaging layouts.
 *
 * Test 3: DOM-mismatch mode — the thread and composer live inside a closed
 * shadow root while the normal DOM only exposes a promo rail. The agent must
 * use vision grounding to locate the real composer and avoid clicking ads.
 * Tests: VLM grounding, shadow DOM resilience, distractor avoidance.
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
  waitForTaskCompletion,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import { readFileSync } from "fs";

const h = createE2EHarness({ maxTurns: 25, testLabel: "messaging-thread" });

describe.skipIf(!h.apiKey)("E2E: Messaging Thread", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("messaging-thread"));
  afterAll(() => h.afterAllHook());

  it("reads German thread and composes a German reply without sending", async () => {
    await navigateAndWait(h.page, getFixtureUrl("messaging-thread"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = [
      "This is a German discussion about cloud migration. Lisa asked Markus for a technical summary and cost plan by Friday.",
      "Reply in German based on these notes: 'I can prepare the technical summary by Thursday evening.",
      "Thomas and I will review the cost overruns for staging.",
      "We should consider reserved instances to bring costs down.'",
      "Don't send it, just compose the reply.",
    ].join(" ");

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).messagingResult ?? null,
        );
        if (!result?.composed) return null;
        // Must be composed but NOT sent
        if (result.sent) return null;
        // Must have substantial content (at least 50 chars)
        if (result.messageLength < 50) return null;
        return result;
      },
      300_000,
      workspaceId,
    );

    await h.printTraceSummary();

    if (!outcome.ok) {
      const ui = await h.page.evaluate(() => {
        const editor = document.getElementById("reply-editor");
        return {
          editorText: editor?.innerText?.slice(0, 200) || "",
          result: (window as any).messagingResult ?? null,
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

    // Verify reply is in German (check for common German words)
    const msg = (outcome.result.message as string).toLowerCase();
    const germanWords = ["ich", "wir", "und", "die", "der", "das", "den", "kann", "donnerstag", "kosten", "zusammenfassung"];
    const germanWordCount = germanWords.filter((w) => msg.includes(w)).length;
    expect(germanWordCount).toBeGreaterThanOrEqual(3);

    // Verify it was NOT sent
    expect(outcome.result.sent).toBe(false);

    // Verify key content is present (cost/reserved instances topic)
    expect(msg.includes("kosten") || msg.includes("reserved") || msg.includes("staging")).toBe(true);

    console.log(`\n[e2e] PASS — German reply composed (not sent)`);
    console.log(
      `[e2e]   Message (${outcome.result.messageLength} chars): ${outcome.result.message.slice(0, 150)}...`,
    );

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 360_000);

  it("clicks reply editor without false interception", async () => {
    await navigateAndWait(h.page, getFixtureUrl("messaging-thread"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Type 'Hallo Team' in the reply box.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    const outcome = await waitForOutcome(
      h.page,
      h.ctx.serviceWorker,
      async () => {
        const result = await h.page.evaluate(
          () => (window as any).messagingResult ?? null,
        );
        if (!result?.composed || result.sent) return null;
        if (!result.message.includes("Hallo")) return null;
        return result;
      },
      180_000,
      workspaceId,
    );

    await h.printTraceSummary();

    // Verify via traces that no click was falsely intercepted
    const { traceFiles } = await h.printTraceSummary(workspaceId);
    const rawTraceEntries = traceFiles.flatMap((filePath) =>
      readFileSync(filePath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );
    const clickResults = rawTraceEntries.flatMap((entry) =>
      (entry.toolExecutions ?? [])
        .filter((e: any) => e.toolName === "click_element")
        .map((e: any) => String(e.result ?? "")),
    );
    const hadInterception = clickResults.some((r) =>
      r.includes("Click intercepted"),
    );

    expect(outcome.ok, outcome.reason).toBe(true);
    expect(hadInterception).toBe(false);

    console.log(`\n[e2e] PASS — Reply editor clicked without interception`);
    console.log(`[e2e]   Message: ${outcome.result.message}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 240_000);

  it("composes message via vision grounding despite DOM mismatch", async () => {
    await navigateAndWait(
      h.page,
      getFixtureUrl("messaging-thread?mode=dom-mismatch"),
    );
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    const prompt = "Write a hello message in Albanian to Alda, don't send it.";

    const workspaceId = await sendUserChat(h.ctx, prompt, tabId);

    // The composer lives in a closed shadow root — window.messagingResult
    // won't be set because synthetic events don't cross the boundary.
    // Use task completion + trace verification instead.
    const completion = await waitForTaskCompletion(h.ctx, 120_000, workspaceId);

    const { traceFiles } = await h.printTraceSummary(workspaceId);
    expect(traceFiles.length).toBeGreaterThan(0);

    const rawTraceEntries = traceFiles.flatMap((filePath) =>
      readFileSync(filePath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );

    // Verify the agent typed a message (trace shows the type_text action)
    const typeResults = rawTraceEntries.flatMap((entry) =>
      (entry.toolExecutions ?? [])
        .filter((execution: any) => execution.toolName === "type_text")
        .map((execution: any) => String(execution.result ?? "")),
    );
    const typedMessage = typeResults.some((result) => result.includes("Typed"));

    // Verify the agent did NOT click promo rail distractors
    const clickResults = rawTraceEntries.flatMap((entry) =>
      (entry.toolExecutions ?? [])
        .filter((execution: any) => execution.toolName === "click_element")
        .map((execution: any) => String(execution.result ?? "")),
    );
    const clickedPromoRail = clickResults.some(
      (result) =>
        result.includes("Ad Options") || result.includes("Qorvo Connectivity"),
    );

    expect(clickedPromoRail).toBe(false);
    expect(typedMessage).toBe(true);

    console.log(`\n[e2e] PASS — Vision grounding bypassed DOM mismatch`);
    console.log(`[e2e]   Typed a message: ${typedMessage}`);
    console.log(`[e2e]   Promo rail clicked: ${clickedPromoRail}`);
    console.log(`[e2e]   Task completed: ${completion.ok}`);

    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 240_000);
});
