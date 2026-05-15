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
  assertNoWorkerTraceOverlap,
  assertWorkerTraceOverlap,
  extractDoneSummary,
  extractRunIdFromTraceFile,
  filterTraceFilesByWorkspace,
  findAllNewTraceFiles,
  readRunTraceEventsForTraceFile,
  snapshotTraceFiles,
} from "./helpers/diagnostics";
import {
  assertNoGhostSession,
  getActiveTabId,
  navigateAndWait,
  sendUserChat,
  stopAgent,
  updateUserSettings,
  waitForTaskCompletion,
} from "./helpers/utils";

const h = createE2EHarness({ maxTurns: 14, testLabel: "parallel-work" });

function readUniqueRunEvents(traceFiles: string[]) {
  const seenRunIds = new Set<string>();
  return traceFiles.flatMap((filePath) => {
    const runId = extractRunIdFromTraceFile(filePath);
    if (!runId || seenRunIds.has(runId)) return [];
    seenRunIds.add(runId);
    return readRunTraceEventsForTraceFile(filePath);
  });
}

async function collectRunEvents(workspaceId: string) {
  const { traceFiles } = await h.printTraceSummary(workspaceId);
  expect(traceFiles.length).toBeGreaterThan(0);
  return {
    traceFiles,
    runEvents: readUniqueRunEvents(traceFiles),
  };
}

async function waitForRunTraceEvents(
  workspaceId: string,
  traceFilesBefore: Set<string>,
  predicate: (events: ReturnType<typeof readRunTraceEventsForTraceFile>) => boolean,
  timeoutMs: number,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const traceFiles = filterTraceFilesByWorkspace(
      findAllNewTraceFiles(traceFilesBefore),
      workspaceId,
    );
    const runEvents = readUniqueRunEvents(traceFiles);
    if (runEvents.length > 0 && predicate(runEvents)) return runEvents;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for run trace events");
}

function summarizeNodeOutputs(runEvents: ReturnType<typeof readRunTraceEventsForTraceFile>) {
  return runEvents
    .filter((event) => event.type === "node_completed")
    .map((event) =>
      typeof event.data?.summary === "string" ? event.data.summary : "",
    )
    .join("\n");
}

describe.skipIf(!h.apiKey)("E2E: Parallel Work", () => {
  beforeAll(() => h.beforeAllHook(), 120_000);
  beforeEach(() => h.beforeEachHook());
  afterEach(() => h.afterEachHook("parallel-work"));
  afterAll(() => h.afterAllHook());

  it("overlaps independent read-only report workers in a real browser run", async () => {
    await updateUserSettings(h.ctx, {
      laneTopologyMode: "full",
      allowNavigation: true,
      requireApprovals: false,
    });
    await navigateAndWait(h.page, getFixtureUrl("parallel-work"));
    await h.page.bringToFront();

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    const alphaUrl = getFixtureUrl("parallel-work?view=alpha");
    const betaUrl = getFixtureUrl("parallel-work?view=beta");
    const workspaceId = await sendUserChat(
      h.ctx,
      `Read these two read-only report pages and summarize each page's headline metric and owner: ${alphaUrl} and ${betaUrl}.`,
      tabId,
    );

    const outcome = await waitForTaskCompletion(h.ctx, 180_000, workspaceId);
    expect(outcome.ok, JSON.stringify(outcome.events.slice(-12), null, 2)).toBe(
      true,
    );

    const { traceFiles, runEvents } = await collectRunEvents(workspaceId);
    const summary = [
      extractDoneSummary(traceFiles),
      summarizeNodeOutputs(runEvents),
    ]
      .join("\n")
      .toLowerCase();
    expect(summary).toContain("184");
    expect(summary).toContain("mira");
    expect(summary).toContain("37");
    expect(summary).toContain("devon");

    const workerStarts = runEvents.filter(
      (event) => event.type === "worker_started",
    );
    expect(workerStarts.length).toBeGreaterThanOrEqual(2);
    assertWorkerTraceOverlap(runEvents);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 240_000);

  it("serializes apparent parallel mutations against one shared form", async () => {
    await updateUserSettings(h.ctx, {
      laneTopologyMode: "full",
      allowNavigation: true,
      requireApprovals: false,
    });
    const formUrl = getFixtureUrl("parallel-work?view=shared-form");
    await navigateAndWait(h.page, formUrl);
    await h.page.bringToFront();

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    const workspaceId = await sendUserChat(
      h.ctx,
      `On the shared form page ${formUrl}, do these as separate updates on the same form: set Primary label to Mercury, set Secondary label to Atlas, then submit the shared form.`,
      tabId,
    );

    const outcome = await waitForTaskCompletion(h.ctx, 180_000, workspaceId);
    expect(outcome.ok, JSON.stringify(outcome.events.slice(-12), null, 2)).toBe(
      true,
    );

    const formState = await h.page.evaluate(
      () => (window as any).__parallelWorkFormState ?? null,
    );
    expect(formState).toMatchObject({
      primary: "Mercury",
      secondary: "Atlas",
      submitted: true,
    });

    const { runEvents } = await collectRunEvents(workspaceId);
    const workerStarts = runEvents.filter(
      (event) => event.type === "worker_started",
    );
    expect(workerStarts.length).toBeGreaterThanOrEqual(2);
    assertNoWorkerTraceOverlap(runEvents);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 240_000);

  it("stops active multi-node parallel work without leaving ghost state", async () => {
    await updateUserSettings(h.ctx, {
      laneTopologyMode: "full",
      allowNavigation: true,
      requireApprovals: false,
    });
    await navigateAndWait(h.page, getFixtureUrl("parallel-work"));
    await h.page.bringToFront();

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    const alphaUrl = getFixtureUrl("parallel-work?view=alpha");
    const betaUrl = getFixtureUrl("parallel-work?view=beta");
    const traceFilesBefore = snapshotTraceFiles();
    const workspaceId = await sendUserChat(
      h.ctx,
      `Read these two read-only report pages and summarize each page's headline metric and owner: ${alphaUrl} and ${betaUrl}.`,
      tabId,
    );

    await waitForRunTraceEvents(
      workspaceId,
      traceFilesBefore,
      (events) =>
        events.filter((event) => event.type === "worker_started").length >= 2 &&
        !events.some((event) => event.type === "task_completed"),
      120_000,
    );

    await stopAgent(h.ctx, workspaceId);
    const outcome = await waitForTaskCompletion(h.ctx, 180_000, workspaceId);
    expect(outcome.ok, JSON.stringify(outcome.events.slice(-12), null, 2)).toBe(
      false,
    );
    expect(
      outcome.events.some(
        (event) =>
          event.type === "AGENT_STATUS" &&
          String(event.detail ?? "").includes("Stopping at next safe point"),
      ),
    ).toBe(true);

    const { runEvents } = await collectRunEvents(workspaceId);
    expect(
      runEvents.some(
        (event) =>
          event.type === "worker_cancelled" &&
          event.data?.reason === "task_stop_requested",
      ),
    ).toBe(true);
    await assertNoGhostSession(h.ctx.serviceWorker, 2_000, workspaceId);
  }, 300_000);
});
