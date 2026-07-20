/**
 * E2E: Lane topology benefit regression.
 *
 * Runs the same simple read-only task across topology modes. The assertion is
 * intentionally about topology trace shape, not exact latency.
 *
 * Since LP-17 P6, the planner gate (qualifiesForDirectSingleNode) short-
 * circuits the planner for single-node-shaped queries in EVERY topology mode,
 * so this query must produce zero planner_llm_call events across all three
 * runs — the topology label still has to flow through to plan_decomposed.
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
import { basename } from "node:path";
import { createE2EHarness } from "./helpers/harness";
import { getFixtureUrl } from "./helpers/fixture-server";
import {
  extractDoneSummary,
  findAllNewTraceFiles,
  filterTraceFilesByWorkspace,
  readRunTraceEventsForTraceFile,
  readTrace,
} from "./helpers/diagnostics";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  updateUserSettings,
  waitForTaskCompletion,
} from "./helpers/utils";

const h = createE2EHarness({ maxTurns: 6, testLabel: "lane-topology" });

type ModeResult = {
  mode: "full" | "standard" | "simple";
  ok: boolean;
  summary: string;
  turnCount: number;
  durationMs: number;
  runEvents: ReturnType<typeof readRunTraceEventsForTraceFile>;
  traceFiles: string[];
};

function expectAcceptedVerification(
  entries: ReturnType<typeof readRunTraceEventsForTraceFile>,
  mode: "full" | "standard" | "simple",
) {
  expect(entries.length, `${mode} should record node verification`).toBeGreaterThan(
    0,
  );
  const first = entries[0];
  expect(first.data?.decision, `${mode} verification decision`).toBe("accept");
  expect(
    typeof first.data?.confidence,
    `${mode} verification confidence type`,
  ).toBe("number");
  expect(
    first.data?.failureType ?? null,
    `${mode} should not record a failure type`,
  ).toBeNull();
}

async function runSimplePageTask(
  mode: "full" | "standard" | "simple",
): Promise<ModeResult> {
  await updateUserSettings(h.ctx, { laneTopologyMode: mode });
  await navigateAndWait(h.page, getFixtureUrl("summarize"));
  await h.page.bringToFront();
  const tabId = await getActiveTabId(h.ctx.serviceWorker);
  expect(tabId).toBeGreaterThan(0);

  const start = Date.now();
  const workspaceId = await sendUserChat(
    h.ctx,
    "Tell me the title of this page.",
    tabId,
  );

  const outcome = await waitForTaskCompletion(h.ctx, 120_000, workspaceId);
  const durationMs = Date.now() - start;
  expect(outcome.ok, JSON.stringify(outcome.events.slice(-10), null, 2)).toBe(
    true,
  );

  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const traceFiles = filterTraceFilesByWorkspace(
    findAllNewTraceFiles(h.tracesBefore),
    workspaceId,
  );
  expect(traceFiles.length).toBeGreaterThan(0);
  const turns = traceFiles.flatMap((filePath) => readTrace(filePath));
  const runEvents = traceFiles.flatMap((filePath) =>
    readRunTraceEventsForTraceFile(filePath),
  );
  const summary = extractDoneSummary(traceFiles);

  await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);

  return {
    mode,
    ok: outcome.ok,
    summary,
    turnCount: turns.length,
    durationMs,
    runEvents,
    traceFiles,
  };
}

describe.skipIf(!h.apiKey)("E2E: Lane topology", () => {
  beforeAll(() => h.beforeAllHook(), 60_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("lane-topology"));
  afterAll(() => h.afterAllHook());

  it("applies full, standard, and simple topology policies for a simple read-only page task", async () => {
    const full = await runSimplePageTask("full");
    h.tracesBefore = new Set([
      ...h.tracesBefore,
      ...full.traceFiles.map((filePath) => basename(filePath)),
    ]);
    await updateUserSettings(h.ctx, { laneTopologyMode: "full" });

    const standard = await runSimplePageTask("standard");
    h.tracesBefore = new Set([
      ...h.tracesBefore,
      ...standard.traceFiles.map((filePath) => basename(filePath)),
    ]);
    await updateUserSettings(h.ctx, { laneTopologyMode: "full" });

    const simple = await runSimplePageTask("simple");

    const simplePlan = simple.runEvents.find(
      (entry) => entry.type === "plan_decomposed",
    );
    const standardPlan = standard.runEvents.find(
      (entry) => entry.type === "plan_decomposed",
    );
    const fullPlan = full.runEvents.find(
      (entry) => entry.type === "plan_decomposed",
    );
    const simplePlannerCalls = simple.runEvents.filter(
      (entry) => entry.type === "planner_llm_call",
    ).length;
    const standardPlannerCalls = standard.runEvents.filter(
      (entry) => entry.type === "planner_llm_call",
    ).length;
    const fullPlannerCalls = full.runEvents.filter(
      (entry) => entry.type === "planner_llm_call",
    ).length;
    const simpleNodeVerified = simple.runEvents.filter(
      (entry) => entry.type === "node_verified",
    );
    const standardNodeVerified = standard.runEvents.filter(
      (entry) => entry.type === "node_verified",
    );
    const fullNodeVerified = full.runEvents.filter(
      (entry) => entry.type === "node_verified",
    );

    // The LP-17 planner gate must fire for this single-node-shaped query in
    // every topology mode: planner skipped, one node, zero planner calls.
    expect(fullPlan?.data).toMatchObject({
      laneTopologyMode: "full",
      plannerSkipped: true,
      nodeCount: 1,
    });
    expect(standardPlan?.data).toMatchObject({
      laneTopologyMode: "standard",
      plannerSkipped: true,
      nodeCount: 1,
    });
    expect(simplePlan?.data).toMatchObject({
      laneTopologyMode: "simple",
      plannerSkipped: true,
      nodeCount: 1,
    });
    expect(simplePlannerCalls).toBe(0);
    expect(standardPlannerCalls).toBe(0);
    expect(fullPlannerCalls).toBe(0);
    expectAcceptedVerification(simpleNodeVerified, "simple");
    expectAcceptedVerification(standardNodeVerified, "standard");
    expectAcceptedVerification(fullNodeVerified, "full");
    expect(simple.summary.toLowerCase()).toContain("transformer");

    console.log(
      `[e2e:lane-topology] full: turns=${full.turnCount}, plannerCalls=${fullPlannerCalls}, durationMs=${full.durationMs}`,
    );
    console.log(
      `[e2e:lane-topology] standard: turns=${standard.turnCount}, plannerCalls=${standardPlannerCalls}, durationMs=${standard.durationMs}`,
    );
    console.log(
      `[e2e:lane-topology] simple: turns=${simple.turnCount}, plannerCalls=${simplePlannerCalls}, durationMs=${simple.durationMs}`,
    );
  }, 300_000);
});
