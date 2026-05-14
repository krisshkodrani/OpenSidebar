/**
 * E2E: Memory recall from a prior page.
 *
 * The agent first reads exact facts from the Memory Lab dashboard. After the
 * user moves to an unrelated page, the agent must answer from the prior
 * conversational context instead of relying on the current page.
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
import { extractDoneSummary } from "./helpers/diagnostics";
import {
  collectNewWorkspaceTraceFiles,
  collectTraceToolNames,
  missingExpectedFacts,
  snapshotTraceBaseline,
} from "./helpers/memory";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  settleWorkspaceBetweenTurns,
  waitForTaskCompletion,
} from "./helpers/utils";

const h = createE2EHarness({ maxTurns: 12, testLabel: "memory-recall" });
const TURN_TIMEOUT = 160_000;

const DOSSIER_EXPECTATIONS = [
  { label: "activation code", patterns: [/ORBIT-?7321/i] },
  { label: "quarterly revenue", patterns: [/\$?84,?210\b/i] },
  { label: "SLA breach count", patterns: [/\bSLA\b[\s\S]{0,60}\b4\b/i, /\b4\b[\s\S]{0,60}\bSLA\b/i] },
];

describe.skipIf(!h.apiKey)("E2E: Memory recall from prior page", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("memory-recall-dashboard"));
  afterAll(() => h.afterAllHook());

  it("recalls exact dashboard facts after navigating away", async () => {
    const workspaceId = `e2e-memory-recall-${crypto.randomUUID()}`;

    await navigateAndWait(h.page, getFixtureUrl("memory-lab"));
    await h.page.bringToFront();
    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    expect(tabId).toBeGreaterThan(0);

    await sendUserChat(
      h.ctx,
      "Read the Memory Lab dashboard and tell me the activation code, quarterly revenue, and current SLA breach count.",
      tabId,
      workspaceId,
    );

    const turn1 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
    expect(turn1.ok, `Turn 1 failed: ${turn1.reason}`).toBe(true);

    const turn1Traces = collectNewWorkspaceTraceFiles(h.tracesBefore, workspaceId);
    const turn1Answer = extractDoneSummary(turn1Traces);
    const turn1Missing = missingExpectedFacts(turn1Answer, DOSSIER_EXPECTATIONS);
    expect(
      turn1Missing,
      `Turn 1 missed expected facts. Answer: ${turn1Answer}`,
    ).toEqual([]);

    await settleWorkspaceBetweenTurns(h.ctx.serviceWorker, workspaceId);

    await navigateAndWait(h.page, getFixtureUrl("email-compose"));
    await h.page.bringToFront();
    const turn2Baseline = snapshotTraceBaseline();

    await sendUserChat(
      h.ctx,
      "Without going back to the dashboard, remind me of the activation code, quarterly revenue, and SLA breach count you just found.",
      tabId,
      workspaceId,
    );

    const turn2 = await waitForTaskCompletion(h.ctx, TURN_TIMEOUT, workspaceId);
    expect(turn2.ok, `Turn 2 failed: ${turn2.reason}`).toBe(true);

    const turn2Traces = collectNewWorkspaceTraceFiles(turn2Baseline, workspaceId);
    const turn2Answer = extractDoneSummary(turn2Traces);
    const turn2Missing = missingExpectedFacts(turn2Answer, DOSSIER_EXPECTATIONS);
    expect(
      turn2Missing,
      `Turn 2 did not recall the prior facts. Answer: ${turn2Answer}`,
    ).toEqual([]);

    const turn2ToolNames = collectTraceToolNames(turn2Traces);
    expect(
      turn2ToolNames.filter((name) =>
        ["click_element", "type_text", "select_option", "set_checkbox"].includes(name),
      ),
      `Recall-only answer should not mutate the unrelated page. Tools: ${turn2ToolNames.join(", ")}`,
    ).toEqual([]);

    await h.printTraceSummary(workspaceId);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 420_000);
});
