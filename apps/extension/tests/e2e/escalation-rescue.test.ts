/**
 * E2E: Escalation rescue (RFC LP-2) — fault-injection fixtures that force a
 * stuck phase, then assert the rescue pipeline: an escalation trigger fires
 * (canonical escalation_triggered trace event) and the run converges after
 * the fixture unlocks, or fails fast / reports honestly when the task is
 * impossible — always under the turn budget, never by timeout.
 *
 * Run: pnpm run test:e2e (focus suite: escalation-rescue)
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
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "./helpers/utils";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  extractDoneSummary,
  traceFilesContainText,
} from "./helpers/diagnostics";

interface FixtureState {
  solved: boolean;
  interactions: number;
  unlocked: boolean;
}

const h = createE2EHarness({ maxTurns: 24, testLabel: "escalation-rescue" });

async function readFixtureState(): Promise<FixtureState | null> {
  return h.page.evaluate(
    () => (window as unknown as { fixtureState?: FixtureState }).fixtureState ?? null,
  );
}

async function runFixtureTask(
  route: string,
  prompt: string,
  probe: () => Promise<unknown>,
): Promise<{
  outcome: Awaited<ReturnType<typeof waitForOutcome>>;
  traceFiles: string[];
}> {
  await navigateAndWait(h.page, getFixtureUrl(route));
  await h.page.bringToFront();
  const tabId = await getActiveTabId(h.ctx.serviceWorker);
  expect(tabId).toBeGreaterThan(0);

  const workspaceId = await sendUserChat(h.ctx, prompt, tabId);
  const outcome = await waitForOutcome(
    h.page,
    h.ctx.serviceWorker,
    probe,
    300_000,
    workspaceId,
  );
  const { traceFiles } = await h.printTraceSummary();
  return { outcome, traceFiles };
}

describe.skipIf(!h.apiKey)("E2E: Escalation rescue", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("escalation-rescue"));
  afterAll(() => h.afterAllHook());

  it("disabled submit: escalates during the locked phase, then completes the signup", async () => {
    const { outcome, traceFiles } = await runFixtureTask(
      "stuckness/disabled-submit.html",
      "Sign me up for the beta program on this page as Jane Doe, jane@example.com.",
      async () => {
        const state = await readFixtureState();
        return state?.solved ? state : null;
      },
    );

    if (!outcome.ok) {
      console.log("[e2e] FAILURE DIAGNOSTICS:", outcome.reason);
    }
    expect(outcome.ok, outcome.reason).toBe(true);
    expect((outcome.result as FixtureState).solved).toBe(true);
    expect(
      traceFilesContainText(traceFiles, "escalation_triggered"),
      "expected an escalation_triggered trace event during the locked phase",
    ).toBe(true);
  }, 380_000);

  it("looping pagination: escalates while pages cycle, then finds the refunded order", async () => {
    const { outcome, traceFiles } = await runFixtureTask(
      "stuckness/looping-pagination.html",
      "Find the order with status Refunded in the order history on this page and report its order ID.",
      async () => {
        const state = await readFixtureState();
        return state?.solved ? state : null;
      },
    );

    if (!outcome.ok) {
      console.log("[e2e] FAILURE DIAGNOSTICS:", outcome.reason);
    }
    expect(outcome.ok, outcome.reason).toBe(true);
    expect(extractDoneSummary(traceFiles)).toContain("ORD-7741");
    expect(
      traceFilesContainText(traceFiles, "escalation_triggered"),
      "expected an escalation_triggered trace event during the locked phase",
    ).toBe(true);
  }, 380_000);

  it("false affordances: escalates on do-nothing tiles, then opens settings", async () => {
    const { outcome, traceFiles } = await runFixtureTask(
      "stuckness/false-affordance.html",
      "Open the settings panel on this page and report the API endpoint URL shown there.",
      async () => {
        const state = await readFixtureState();
        return state?.solved ? state : null;
      },
    );

    if (!outcome.ok) {
      console.log("[e2e] FAILURE DIAGNOSTICS:", outcome.reason);
    }
    expect(outcome.ok, outcome.reason).toBe(true);
    expect(extractDoneSummary(traceFiles)).toContain(
      "api.vortex.example",
    );
    expect(
      traceFilesContainText(traceFiles, "escalation_triggered"),
      "expected an escalation_triggered trace event during the locked phase",
    ).toBe(true);
  }, 380_000);

  it("dead-end navigation: escalates, then ends under budget instead of burning turns", async () => {
    const { outcome, traceFiles } = await runFixtureTask(
      "stuckness/dead-end-nav.html",
      "Find the support contact email for enterprise customers on this page and report it.",
      // The task is impossible; there is no page state to win. A truthy
      // sentinel makes waitForOutcome return on any terminal agent state
      // (honest completion, fail-fast partial, or failure) instead of
      // polling out the full window.
      async () => ({ observed: true }),
    );

    // Any terminal state is acceptable except a harness timeout: an honest
    // "no such email" completion, a failed-fast partial handoff, or a failed
    // task. Timing out means the run burned the whole wait without
    // terminating — the exact behavior this RFC removes.
    expect(
      outcome.reason,
      "run must terminate (honest failure or fail-fast), not time out",
    ).not.toMatch(/timed?[ _-]?out/i);
    expect(
      traceFilesContainText(traceFiles, "escalation_triggered"),
      "expected an escalation_triggered trace event on the dead-end page",
    ).toBe(true);
    expect(
      traceFilesContainText(traceFiles, "escalation_outcome"),
      "expected an escalation_outcome trace event resolving the rescue window",
    ).toBe(true);
  }, 380_000);
});
